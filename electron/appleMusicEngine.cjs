/**
 * Apple Music 页面引擎。
 *
 * Apple Music 的接口要「开发者令牌 + 用户令牌」，两个都只在官方网页播放器（music.apple.com）的页面里：
 * 页面自带的 MusicKit 会替我们带上令牌去访问 api.music.apple.com。所以这里不碰任何令牌，
 * 而是开一个独立持久分区的 WebContentsView 加载官方页面，用户在页面里用 Apple ID 登录，
 * 之后由主进程在页面里执行一段固定的读取函数，只把精简后的结果带回来。
 *
 * 视图从不挂到窗口上（和汽水签名引擎一样）；只有登录时才交给内嵌弹窗（sheetHost.open({ view })）显示。
 * 安全约定：developerToken / musicUserToken / 任何请求头都不许出页面、写日志、落盘——
 * 页面里的函数按白名单挑字段，主进程这边再按白名单过一遍。
 *
 * 不直接 require electron：WebContentsView / session / sheetHost 由调用方传入，便于离线单测。
 */

const HOME_URL = 'https://music.apple.com/';
const PARTITION = 'persist:applemusic-login';

/** 页面就绪（MusicKit 实例存在）最长等待。 */
const READY_TIMEOUT_MS = 25000;
const READY_POLL_MS = 500;
/** 单个请求在页面里执行的最长时间。 */
const REQUEST_TIMEOUT_MS = 15000;
/** 登录弹窗期间多久查一次 isAuthorized。 */
const LOGIN_POLL_MS = 1500;
/** 点「登录」时先等页面就绪多久，好判断「其实已经登录了」；等不到就直接开弹窗。 */
const LOGIN_PROBE_MS = 5000;

/** 能请求的接口路径：只读，只有用户资料库（me）和公开目录（catalog）。 */
const PATH_RE = /^\/v1\/(me|catalog)\/[A-Za-z0-9/._-]+$/;
const QUERY_KEY_RE = /^[A-Za-z0-9_.-]{1,40}$/;

/** 导航白名单：Apple 自己的域名（music / authorize.music / account / appleid / idmsa 都在 *.apple.com 之下）。 */
function isAllowedNavigation(url) {
  try {
    const u = new URL(String(url));
    if (u.protocol !== 'https:' || u.username || u.password) return false;
    if (u.port && u.port !== '443') return false;
    return u.hostname === 'apple.com' || u.hostname.endsWith('.apple.com');
  } catch {
    return false;
  }
}

function validPath(path) {
  return typeof path === 'string' && PATH_RE.test(path) && !path.includes('..') && !path.includes('//');
}

/** 去掉 UA 里的 Electron / 应用名片段（Apple 的页面见到 Electron 可能走不同分支）。 */
function cleanUserAgent(ua) {
  return String(ua || '')
    .replace(/\s(?:Electron|electron)\/\S+/g, '')
    // 应用名片段（如 music-nebula/0.1.0）：浏览器 UA 里该有的几个标准片段保留，其余「名字/版本」都去掉
    .replace(/\s(?!(?:AppleWebKit|Chrome|Safari|Version|Mobile)\/)[A-Za-z][\w.-]*\/\d\S*/g, '')
    .trim();
}

/**
 * 在 Apple 页面里执行的读取函数（toString 之后整段送进页面，所以必须自包含，不能引用外面的任何东西）。
 * 参数只有 path / query；返回精简后的结果，绝不返回令牌、请求头或整段响应。
 */
async function readInPage(req) {
  const PATH = /^\/v1\/(me|catalog)\/[A-Za-z0-9/._-]+$/;
  const KEY = /^[A-Za-z0-9_.-]{1,40}$/;
  try {
    const path = req && req.path;
    if (typeof path !== 'string' || !PATH.test(path) || path.indexOf('..') >= 0 || path.indexOf('//') >= 0) return { invalid: true };
    const query = {};
    if (req.query && typeof req.query === 'object') {
      for (const k of Object.keys(req.query)) {
        const v = req.query[k];
        if (!KEY.test(k) || (typeof v !== 'string' && typeof v !== 'number') || String(v).length > 200) return { invalid: true };
        query[k] = v;
      }
    }
    const mk = window.MusicKit && window.MusicKit.getInstance();
    if (!mk || !mk.api) return { notReady: true };
    const v3 = mk.api.v3;
    let call = null;
    if (v3 && typeof v3.music === 'function') call = (p, q) => v3.music(p, q);
    else if (typeof mk.api.music === 'function') call = (p, q) => mk.api.music(p, q);
    if (!call) return { notReady: true };

    let res = null;
    let thrown = null;
    try {
      res = await call(path, query);
    } catch (e) {
      thrown = e || {};
    }
    // 响应可能是 { data: 响应体, status }；4xx 也可能不抛异常而是 resolve，响应体里带 errors；也可能直接抛
    let body;
    let status = 0;
    if (thrown) {
      body = thrown.data || (thrown.response && thrown.response.data) || {};
      status = Number(thrown.status || (thrown.response && thrown.response.status)) || 0;
    } else {
      body = res && res.data !== undefined ? res.data : res;
      status = Number(res && res.status) || 0;
    }
    if (!body || typeof body !== 'object') body = {};

    const errors = Array.isArray(body.errors)
      ? body.errors.slice(0, 5).map((e) => ({
          code: e && e.code != null ? String(e.code).slice(0, 40) : '',
          status: e && e.status != null ? String(e.status).slice(0, 10) : '',
        }))
      : [];
    if (!status && errors.length) status = Number(errors[0].status) || 0;
    if (!status && !thrown) status = 200;
    if (thrown && !errors.length) errors.push({ code: 'request-failed', status: status ? String(status) : '' });

    const str = (v, max) => (typeof v === 'string' ? v.slice(0, max || 500) : '');
    const thin = (item) => {
      if (!item || typeof item !== 'object') return null;
      const out = { id: str(item.id, 200), type: str(item.type, 60), href: str(item.href, 500) };
      const a = item.attributes;
      if (a && typeof a === 'object') {
        const at = {};
        for (const k of ['name', 'artistName', 'albumName', 'curatorName', 'isrc', 'lastModifiedDate']) {
          if (typeof a[k] === 'string') at[k] = a[k].slice(0, 500);
        }
        for (const k of ['durationInMillis', 'trackCount']) if (typeof a[k] === 'number' && isFinite(a[k])) at[k] = a[k];
        for (const k of ['canEdit', 'isPublic']) if (typeof a[k] === 'boolean') at[k] = a[k];
        if (a.artwork && typeof a.artwork === 'object' && typeof a.artwork.url === 'string') at.artwork = { url: a.artwork.url.slice(0, 500) };
        if (a.playParams && typeof a.playParams === 'object') {
          const pp = {};
          for (const k of ['id', 'kind', 'catalogId']) if (typeof a.playParams[k] === 'string') pp[k] = a.playParams[k].slice(0, 200);
          if (typeof a.playParams.isLibrary === 'boolean') pp.isLibrary = a.playParams.isLibrary;
          at.playParams = pp;
        }
        if (Array.isArray(a.tags)) at.tags = a.tags.filter((t) => typeof t === 'string').slice(0, 20);
        if (a.description && typeof a.description === 'object' && typeof a.description.standard === 'string') {
          at.description = { standard: a.description.standard.slice(0, 2000) };
        }
        out.attributes = at;
      }
      const cat = item.relationships && item.relationships.catalog && item.relationships.catalog.data;
      if (Array.isArray(cat) && cat[0] && typeof cat[0].id === 'string') {
        // 只留目录曲目的 id 和 isrc（资料库曲目自己没有 isrc，要 include=catalog 才能从这里拿到）
        const entry = { id: cat[0].id.slice(0, 200) };
        if (cat[0].attributes && typeof cat[0].attributes.isrc === 'string') entry.attributes = { isrc: cat[0].attributes.isrc.slice(0, 40) };
        out.relationships = { catalog: { data: [entry] } };
      }
      return out;
    };

    const result = { status };
    if (Array.isArray(body.data)) result.data = body.data.slice(0, 300).map(thin).filter(Boolean);
    if (typeof body.next === 'string' && body.next.length <= 500) result.next = body.next;
    const meta = body.meta && typeof body.meta === 'object' ? body.meta : null;
    if (meta && typeof meta.total === 'number' && isFinite(meta.total)) result.total = meta.total;
    if (meta && meta.subscription && typeof meta.subscription.active === 'boolean') {
      result.meta = { subscription: { active: meta.subscription.active } };
    }
    if (errors.length) result.errors = errors;
    return result;
  } catch (e) {
    return { status: 0, errors: [{ code: 'request-failed', status: '' }] };
  }
}

const READY_CODE = '!!(window.MusicKit && window.MusicKit.getInstance())';
const AUTHORIZED_CODE =
  '(() => { try { const mk = window.MusicKit && window.MusicKit.getInstance(); return mk ? !!mk.isAuthorized : null; } catch (e) { return null; } })()';
const UNAUTHORIZE_CODE =
  '(async () => { try { const mk = window.MusicKit && window.MusicKit.getInstance(); if (mk && typeof mk.unauthorize === "function") await mk.unauthorize(); } catch (e) {} return true; })()';

function buildRequestCode(path, query) {
  return `(${readInPage.toString()})(${JSON.stringify({ path, query })})`;
}

/** 一次批量最多几个请求、页面里同时跑几个（Apple 的接口并发几个没问题，再多怕被限流）。 */
const BATCH_MAX = 60;
const BATCH_CONCURRENCY = 6;

/** 批量：在页面里用同一个读取函数并行跑多个请求（限并发），结果按顺序返回。 */
function buildBatchCode(reqs) {
  return `(async () => {
    const read = ${readInPage.toString()};
    const reqs = ${JSON.stringify(reqs)};
    const out = new Array(reqs.length);
    let next = 0;
    const worker = async () => { while (next < reqs.length) { const i = next++; out[i] = await read(reqs[i]); } };
    await Promise.all(Array.from({ length: Math.min(${BATCH_CONCURRENCY}, reqs.length) }, worker));
    return out;
  })()`;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 带超时的等待；超时抛错，计时器一定清掉。 */
function withTimeout(promise, ms, message) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

/**
 * @param {object} deps
 * @param {new (opts: object) => any} deps.WebContentsView
 * @param {{ fromPartition: (p: string) => any }} deps.session
 * @param {{ open: Function, getCurrent?: Function }} deps.sheetHost
 * @param {string} [deps.userAgent] 干净的 Chrome UA；不传就从视图默认 UA 里剔除 Electron 片段
 * @param {object} [deps.timing] 测试用：覆盖各个等待时间
 */
function createAppleMusicEngine({ WebContentsView, session, sheetHost, userAgent, timing = {} }) {
  const readyTimeoutMs = timing.readyTimeoutMs ?? READY_TIMEOUT_MS;
  const readyPollMs = timing.readyPollMs ?? READY_POLL_MS;
  const requestTimeoutMs = timing.requestTimeoutMs ?? REQUEST_TIMEOUT_MS;
  const loginPollMs = timing.loginPollMs ?? LOGIN_POLL_MS;
  const loginProbeMs = timing.loginProbeMs ?? LOGIN_PROBE_MS;

  let view = null;
  let disposed = false;
  /** 页面里的 MusicKit 已确认存在；页面跳转 / 渲染进程崩溃时作废。 */
  let readyFlag = false;
  /** 上一次加载首页失败（离线等）：下次用到时重新加载。 */
  let needsReload = false;
  let queue = Promise.resolve();
  let loginPromise = null;

  const alive = () => !disposed && view && !(view.webContents.isDestroyed && view.webContents.isDestroyed());

  function load() {
    needsReload = false;
    const wc = view.webContents;
    Promise.resolve()
      .then(() => wc.loadURL(HOME_URL))
      .catch(() => {
        needsReload = true;
      });
  }

  /** 懒创建视图：第一次用到时才有；从不 addChildView。 */
  function ensureView() {
    if (disposed) throw new Error('Apple Music 引擎已关闭');
    if (view && alive()) {
      if (needsReload) load();
      return view;
    }
    view = new WebContentsView({
      webPreferences: {
        partition: PARTITION,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false,
      },
    });
    const wc = view.webContents;
    readyFlag = false;
    try {
      view.setBackgroundColor?.('#00000000');
    } catch {
      /* ignore */
    }
    wc.setUserAgent(userAgent || cleanUserAgent(wc.getUserAgent ? wc.getUserAgent() : ''));

    // 导航只放行 Apple 自己的域名；兼容旧签名 (event, url) 与新签名 (details)
    const guard = (event, url) => {
      const target = (event && event.url) || url;
      if (!isAllowedNavigation(target)) event.preventDefault();
    };
    wc.on('will-navigate', guard);
    wc.on('will-redirect', guard);
    wc.setWindowOpenHandler(({ url }) => {
      // 登录页里的 target=_blank / window.open：白名单内的 https 在同一个视图里打开，其余一律不开
      if (isAllowedNavigation(url)) void Promise.resolve(wc.loadURL(url)).catch(() => {});
      return { action: 'deny' };
    });
    wc.on('did-start-loading', () => {
      readyFlag = false;
    });
    wc.on('render-process-gone', () => {
      readyFlag = false;
      needsReload = true;
    });
    load();
    return view;
  }

  async function probeReady() {
    if (!alive()) return false;
    try {
      return (await view.webContents.executeJavaScript(READY_CODE, true)) === true;
    } catch {
      return false; // 页面正在跳转 / 还没加载出来
    }
  }

  async function waitReady(maxMs = readyTimeoutMs) {
    if (readyFlag) return true;
    const deadline = Date.now() + maxMs;
    for (;;) {
      if (!alive()) return false;
      if (await probeReady()) {
        readyFlag = true;
        return true;
      }
      if (needsReload) ensureView();
      if (Date.now() + readyPollMs > deadline) return false;
      await sleep(readyPollMs);
    }
  }

  /** 请求串行：前一个（不管成败）结束后才开始下一个。 */
  function enqueue(task) {
    const run = queue.then(task);
    queue = run.then(
      () => {},
      () => {},
    );
    return run;
  }

  /** 只取已知字段（页面里已经精简过一次，这里再过一遍白名单）。 */
  function sanitize(raw) {
    const out = { status: Number(raw && raw.status) || 0 };
    if (Array.isArray(raw && raw.data)) out.data = raw.data;
    if (typeof raw?.next === 'string') out.next = raw.next;
    if (typeof raw?.total === 'number') out.total = raw.total;
    if (Array.isArray(raw?.errors)) out.errors = raw.errors.map((e) => ({ code: String(e?.code ?? ''), status: String(e?.status ?? '') }));
    if (raw?.meta?.subscription && typeof raw.meta.subscription.active === 'boolean') {
      out.meta = { subscription: { active: raw.meta.subscription.active } };
    }
    return out;
  }

  /** 校验并复制一个请求；不合法抛错。 */
  function checkRequest({ path, query } = {}) {
    if (!validPath(path)) throw new Error('Apple Music 请求路径不合法');
    const q = {};
    for (const [k, v] of Object.entries(query || {})) {
      if (!QUERY_KEY_RE.test(k) || (typeof v !== 'string' && typeof v !== 'number')) {
        throw new Error('Apple Music 请求参数不合法');
      }
      q[k] = v;
    }
    return { path, query: q };
  }

  /**
   * 批量读（例如每张歌单的曲目总数）：占队列里一个位置，页面里限并发并行跑，结果按顺序返回。
   * 页面没准备好返回 { notReady: true }；单个请求被页面拒绝的那一项是 null。
   */
  function callMany(reqs) {
    let list;
    try {
      if (!Array.isArray(reqs) || reqs.length > BATCH_MAX) throw new Error('Apple Music 批量请求数量不合法');
      list = reqs.map(checkRequest);
    } catch (err) {
      return Promise.reject(err);
    }
    if (!list.length) return Promise.resolve([]);
    return enqueue(async () => {
      ensureView();
      if (!(await waitReady())) return { notReady: true };
      const raws = await withTimeout(view.webContents.executeJavaScript(buildBatchCode(list), true), requestTimeoutMs, 'Apple Music 请求超时');
      if ((raws && raws.notReady) || (Array.isArray(raws) && raws.some((r) => r && r.notReady))) {
        readyFlag = false;
        return { notReady: true };
      }
      if (!Array.isArray(raws) || raws.length !== list.length) throw new Error('Apple Music 批量请求结果不完整');
      return raws.map((raw) => (!raw || raw.invalid ? null : sanitize(raw)));
    });
  }

  /** 读一个接口。页面没准备好返回 { notReady: true }；路径不合法、超时直接抛错。 */
  function call(req = {}) {
    let checked;
    try {
      checked = checkRequest(req);
    } catch (err) {
      return Promise.reject(err);
    }
    const { path, query: q } = checked;
    return enqueue(async () => {
      ensureView();
      if (!(await waitReady())) return { notReady: true };
      const raw = await withTimeout(view.webContents.executeJavaScript(buildRequestCode(path, q), true), requestTimeoutMs, 'Apple Music 请求超时');
      if (raw && raw.notReady) {
        readyFlag = false;
        return { notReady: true };
      }
      if (!raw || raw.invalid) throw new Error('Apple Music 请求被拒绝');
      return sanitize(raw);
    });
  }

  /** 页面里 mk.isAuthorized；视图不存在或页面没就绪返回 null。 */
  async function isAuthorized() {
    if (!alive()) return null;
    try {
      const v = await view.webContents.executeJavaScript(AUTHORIZED_CODE, true);
      return typeof v === 'boolean' ? v : null;
    } catch {
      return null;
    }
  }

  async function runLogin() {
    ensureView();
    // 先给页面一小会儿加载：已经是登录状态就不必弹窗
    if (await waitReady(loginProbeMs)) {
      if ((await isAuthorized()) === true) return { ok: true, message: 'Apple Music 已登录' };
    }
    if (!alive()) return { ok: false, error: 'Apple Music 引擎已关闭' };
    const sheet = sheetHost.open({
      platform: 'applemusic',
      title: '登录 Apple Music',
      view,
      hint: '点页面右上角的「登录」，用 Apple ID 登录；登录完成后会自动关闭',
      placeholder: '正在打开 Apple Music…',
    });
    return new Promise((resolve) => {
      let settled = false;
      let timer = null;
      let busy = false;
      const finish = (result) => {
        if (settled) return;
        settled = true;
        clearInterval(timer);
        resolve(result);
      };
      timer = setInterval(async () => {
        if (busy || settled) return;
        busy = true;
        try {
          if ((await isAuthorized()) === true && !settled) {
            finish({ ok: true, message: 'Apple Music 登录成功' });
            sheet.close('done');
          }
        } finally {
          busy = false;
        }
      }, loginPollMs);
      sheet.closed.then(async (reason) => {
        if (settled) return;
        if (reason === 'unavailable') return finish({ ok: false, error: '无法打开登录窗口（主窗口不可用）' });
        // 用户在最后一刻关掉弹窗：已经登上了就算成功
        if ((await isAuthorized()) === true) finish({ ok: true, message: 'Apple Music 登录成功' });
        else finish({ ok: false, error: '登录窗口已关闭' });
      });
    });
  }

  /** 弹登录页；同一时间只有一个在进行。 */
  function login() {
    if (loginPromise) return loginPromise;
    loginPromise = runLogin()
      .catch((err) => ({ ok: false, error: `打开 Apple Music 登录页失败：${err instanceof Error ? err.message : String(err)}` }))
      .finally(() => {
        loginPromise = null;
      });
    return loginPromise;
  }

  /** 退出：页面里尽力取消授权，再清空分区的全部存储，页面回到首页（未登录）。 */
  async function logout() {
    if (alive() && readyFlag) {
      try {
        await withTimeout(view.webContents.executeJavaScript(UNAUTHORIZE_CODE, true), 5000, 'unauthorize 超时');
      } catch {
        /* 尽力而为 */
      }
    }
    try {
      await session.fromPartition(PARTITION).clearStorageData({
        storages: ['cookies', 'localstorage', 'indexdb', 'serviceworkers', 'cachestorage', 'filesystem', 'websql'],
      });
    } catch {
      console.warn('[Apple Music] 退出时清理分区存储失败');
    }
    readyFlag = false;
    if (alive()) load();
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    try {
      const cur = sheetHost.getCurrent?.();
      if (cur && view && cur.view === view) cur.close('superseded');
    } catch {
      /* ignore */
    }
    if (view) {
      try {
        view.webContents.close();
      } catch {
        /* 已销毁 */
      }
    }
    view = null;
  }

  return { call, callMany, isAuthorized, login, logout, dispose };
}

module.exports = {
  createAppleMusicEngine,
  isAllowedNavigation,
  cleanUserAgent,
  readInPage,
  buildRequestCode,
  buildBatchCode,
  BATCH_MAX,
  HOME_URL,
  PARTITION,
  PATH_RE,
};
