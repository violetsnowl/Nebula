/**
 * 内嵌页面宿主：把第三方页面（QQ / 酷我官方登录页、汽水二次验证页）
 * 放进主窗口自己的弹窗里，而不是另开带系统标题栏和默认菜单栏的窗口。
 *
 * 分工：渲染进程画弹窗外壳（LoginSheet），这里用 WebContentsView 把页面叠在外壳正文区上方；
 * 外壳测量正文区后经 IPC 报告位置（nebula:sheet:bounds），视图收到位置才挂上去，之后随窗口缩放跟随。
 * 同一时间只有一个页面；再开一个会把前一个以 'superseded' 收掉。
 *
 * 不依赖 Electron 模块本身（WebContentsView / ipcMain 都由调用方传入），便于不启动 Electron 做单元测试。
 */

/** 外壳正文区圆角（与渲染进程 .lgs-body 一致）。 */
const BODY_RADIUS = 14;

function isHttpUrl(url) {
  return /^https?:\/\//i.test(String(url || ''));
}

/**
 * @param {object} deps
 * @param {new (opts: object) => any} deps.WebContentsView
 * @param {{ on: Function }} deps.ipcMain
 * @param {() => any} deps.getMainWindow
 */
function createSheetHost({ WebContentsView, ipcMain, getMainWindow }) {
  let seq = 0;
  /** 当前打开的页面（至多一个）。 */
  let current = null;

  const liveWindow = () => {
    const win = getMainWindow();
    return win && !win.isDestroyed() ? win : null;
  };

  function open(opts) {
    const { platform, title, partition, url, userAgent, hint, placeholder } = opts;
    const win = liveWindow();
    const id = ++seq;
    if (!win) {
      // 没有主窗口就没法显示：直接告诉调用方「没打开」
      return { id, view: null, close() {}, closed: Promise.resolve('unavailable'), shown: Promise.resolve() };
    }
    if (current) current.close('superseded');

    // 接管已有视图（汽水签名引擎的页面不能销毁，关闭时只摘下来）；否则新建一个带独立分区的视图
    const adopted = !!(opts.view || opts.webContents);
    let view;
    if (opts.view) view = opts.view;
    else if (opts.webContents) view = new WebContentsView({ webContents: opts.webContents });
    else {
      view = new WebContentsView({
        webPreferences: { partition, contextIsolation: true, nodeIntegration: false, sandbox: true },
      });
    }
    const wc = view.webContents;
    try {
      view.setBorderRadius?.(BODY_RADIUS);
    } catch {
      /* 旧版本没有圆角 API：直角也能用 */
    }
    if (!adopted) {
      // 页面没画出来之前透出外壳里的占位文字
      try {
        view.setBackgroundColor?.('#00000000');
      } catch {
        /* ignore */
      }
      if (userAgent) wc.setUserAgent(userAgent);
      // 登录页里的 target=_blank / window.open：http(s) 在同一个视图里打开，不另开窗口
      wc.setWindowOpenHandler(({ url: target }) => {
        if (isHttpUrl(target)) void wc.loadURL(target).catch(() => {});
        return { action: 'deny' };
      });
    }

    let attached = false;
    let finished = false;
    let resolveClosed;
    const closed = new Promise((r) => {
      resolveClosed = r;
    });
    // 页面挂到弹窗里（或弹窗在此之前就结束了）时 resolve：汽水验证要等页面显示出来再开始
    let resolveShown;
    const shown = new Promise((r) => {
      resolveShown = r;
    });

    const onWindowClosed = () => finalize('window-closed', false);
    const onNavigate = () => finalize('reset', false);
    win.on?.('closed', onWindowClosed);
    // 渲染进程刷新 / 跳转后外壳没了，视图不能孤零零留在窗口上
    win.webContents?.on?.('did-navigate', onNavigate);

    function detach() {
      if (!attached) return;
      attached = false;
      try {
        if (!win.isDestroyed()) win.contentView.removeChildView(view);
      } catch {
        /* 窗口已销毁 */
      }
    }

    function finalize(reason, notifyRenderer) {
      if (finished) return;
      finished = true;
      if (current === sheet) current = null;
      win.removeListener?.('closed', onWindowClosed);
      win.webContents?.removeListener?.('did-navigate', onNavigate);
      detach();
      // 自己创建的页面用完销毁；接管来的页面（汽水签名引擎）只摘下来，后面还要继续用
      if (!adopted) {
        try {
          wc.close();
        } catch {
          /* 已销毁 */
        }
      }
      if (notifyRenderer && !win.isDestroyed() && !win.webContents.isDestroyed()) {
        win.webContents.send('nebula:sheet:closed', { id });
      }
      resolveShown();
      resolveClosed(reason);
    }

    const sheet = {
      id,
      view,
      closed,
      shown,
      adopted,
      /**
       * 程序主动关（登录成功）：通知外壳收起。用户自己关的由渲染进程发起、被新页面顶替的紧接着会收到新的 open，
       * 这两种都不回发 closed。
       */
      close: (reason = 'done') => finalize(reason, reason !== 'user' && reason !== 'superseded'),
      /** 渲染进程报告外壳正文区位置（CSS 像素 = DIP）；首次到达时才把视图挂上。 */
      setBounds(b) {
        if (finished) return;
        const x = Math.round(Number(b.x));
        const y = Math.round(Number(b.y));
        const width = Math.round(Number(b.width));
        const height = Math.round(Number(b.height));
        if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return;
        view.setBounds({ x, y, width, height });
        if (!attached) {
          attached = true;
          win.contentView.addChildView(view);
          resolveShown();
        }
      },
      isAttached: () => attached,
    };
    current = sheet;

    if (url && !opts.view && !opts.webContents) void wc.loadURL(url).catch(() => {});
    win.webContents.send('nebula:sheet:open', { id, platform, title, hint, placeholder });
    return sheet;
  }

  ipcMain.on('nebula:sheet:bounds', (event, payload) => {
    if (!current || !payload || payload.id !== current.id) return;
    const win = liveWindow();
    if (event?.sender && win && event.sender !== win.webContents) return;
    current.setBounds(payload);
  });
  ipcMain.on('nebula:sheet:close', (event, payload) => {
    if (!current || !payload || payload.id !== current.id) return;
    const win = liveWindow();
    if (event?.sender && win && event.sender !== win.webContents) return;
    current.close('user');
  });

  return { open, getCurrent: () => current };
}

module.exports = { createSheetHost, BODY_RADIUS };
