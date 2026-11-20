const { app, BrowserWindow, WebContentsView, session, ipcMain, shell, dialog, protocol } = require('electron');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const http = require('http');
const { pathToFileURL } = require('url');
const { createSheetHost } = require('./embeddedSheet.cjs');
const { createAppleMusicEngine } = require('./appleMusicEngine.cjs');

// 后端统一出口（esbuild 打包产物，见 package.json build:main）
const {
  registerIpcHandlers,
  CookieStore,
  setCookieDataDir,
  HttpClient,
  createAdapters,
  SongResolver,
  LyricService,
  AmllLyrics,
  AppleMusicLyrics,
  NeteaseLogin,
  QqLogin,
  KugouLogin,
  QishuiLogin,
  KuwoLogin,
  BodianLogin,
  YtmusicLogin,
  revokeYtmusicToken,
  AppleMusicLogin,
  QqRightsService,
  QqRenewService,
  qqSession,
  createQishuiLoginAdapter,
  createKuwoLoginAdapter,
  createAppleMusicLoginAdapter,
  AudioProxy,
  LyricCache,
  LyricOverrides,
  WallpaperLibrary,
  createFallbackPriorityProvider,
  probeAudioUrl,
  clearProbeCache,
  primeNcmApi,
  normalizeCookieHeader,
  validatePlatformCookie,
  SPOTIFY_CLIENT_ID,
  SPOTIFY_REDIRECT_PORT,
  SPOTIFY_SCOPES,
} = require('../dist-main/index.cjs');

// wallpaper:// 自定义协议（壁纸预览/媒体服务，支持 Range）
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'wallpaper',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
]);

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const DEV_URL = process.env.VITE_DEV_SERVER_URL;
/** 主窗口引用（供子窗口回传背景设置）。 */
let mainWindow = null;
/** 内嵌页面宿主：第三方登录页 / 验证页都显示在主窗口自己的弹窗里，不另开带系统标题栏的窗口。 */
const sheetHost = createSheetHost({ WebContentsView, ipcMain, getMainWindow: () => mainWindow });

/** 用户在系统浏览器里完成授权的最长等待时间。 */
const SPOTIFY_AUTH_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * Spotify OAuth（PKCE）：本地回调端口收 code → 换 token 存 CookieStore。
 * 授权页在用户的默认系统浏览器里打开（Google 等第三方登录拒绝在 Electron 窗口 / 视图里登录，
 * 而且系统浏览器通常已经登录过 Spotify）；回调页在浏览器里显示结果，超时 10 分钟自动放弃。
 */
function createSpotifyOAuth(cookies) {
  let busy = false;
  return {
    status: () => !!cookies.get('spotify')?.cookies,
    start: () =>
      new Promise((resolve, reject) => {
        if (busy) return resolve(false);
        busy = true;
        const verifier = crypto.randomBytes(32).toString('base64url');
        const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
        // 桌面客户端 ID 只接受登记过的回调：http://127.0.0.1:5588/login
        const port = SPOTIFY_REDIRECT_PORT;
        const redirectUri = `http://127.0.0.1:${port}/login`;
        let exchanging = false;
        let settled = false;
        let timer = null;
        const finish = (ok, err) => {
          if (settled) return;
          settled = true;
          busy = false;
          clearTimeout(timer);
          server.close();
          // 浏览器的保持连接不再占着：回结果页的响应发完后（1 秒）强制收掉剩余连接
          server.closeIdleConnections?.();
          setTimeout(() => server.closeAllConnections?.(), 1000).unref?.();
          if (err) reject(err);
          else resolve(ok);
        };
        const page = (text) =>
          `<!doctype html><meta charset="utf-8"><title>Spotify 登录</title><p style="font-family:sans-serif;padding:24px">${text}</p>`;
        const server = http.createServer(async (req, res) => {
          const url = new URL(req.url, `http://127.0.0.1:${port}`);
          if (url.pathname !== '/login') {
            res.writeHead(404);
            res.end();
            return;
          }
          const code = url.searchParams.get('code');
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          if (!code || exchanging) {
            res.end(page(code ? '正在完成 Spotify 登录，请稍候…' : '授权未完成，请回到 Music Nebula 重试。'));
            if (!code) finish(false);
            return;
          }
          exchanging = true;
          // 令牌换回来以后才回结果页，浏览器里看到的和应用里的结果一致。
          try {
            const tokenRes = await fetch('https://accounts.spotify.com/api/token', {
              method: 'POST',
              headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
              body: new URLSearchParams({
                grant_type: 'authorization_code',
                code,
                redirect_uri: redirectUri,
                client_id: SPOTIFY_CLIENT_ID,
                code_verifier: verifier,
              }).toString(),
            });
            const tok = await tokenRes.json();
            if (tok.access_token) {
              cookies.set('spotify', tok.access_token, tok.refresh_token ?? '', 'Spotify');
              res.end(page('Spotify 已授权，可以回到 Music Nebula 了。'));
              finish(true);
            } else {
              console.warn('[Spotify] 换取令牌失败：', tok.error || tokenRes.status);
              res.end(page('授权未完成，请回到 Music Nebula 重试。'));
              finish(false);
            }
          } catch (err) {
            console.warn('[Spotify] 换取令牌请求失败：', err instanceof Error ? err.message : '');
            res.end(page('授权未完成，请回到 Music Nebula 重试。'));
            finish(false);
          }
        });
        server.on('error', (err) => {
          console.warn('[Spotify] 本地回调端口不可用：', err && err.code);
          finish(false);
        });
        server.listen(port, '127.0.0.1', () => {
          const authUrl =
            `https://accounts.spotify.com/authorize?client_id=${SPOTIFY_CLIENT_ID}` +
            `&response_type=code&redirect_uri=${encodeURIComponent(redirectUri)}` +
            `&scope=${encodeURIComponent(SPOTIFY_SCOPES)}` +
            `&code_challenge_method=S256&code_challenge=${challenge}`;
          timer = setTimeout(() => finish(false, new Error('授权超时，请重试')), SPOTIFY_AUTH_TIMEOUT_MS);
          Promise.resolve(shell.openExternal(authUrl)).catch((err) => {
            console.warn('[Spotify] 打开系统浏览器失败：', err instanceof Error ? err.message : '');
            finish(false);
          });
        });
      }),
  };
}

/**
 * QQ 音乐官方登录：旧版 ptqrshow 二维码接口已被 403 封禁（网易云 QR 不受影响），
 * 改用官方登录页（独立 partition）扫码，登录后自动读取该 partition 的 Cookie
 * 做 normalize + 校验（uin + 播放票据），成功即落库并关闭窗口。
 */
function createQqLoginWindow(cookies) {
  return new Promise(async (resolve) => {
    const partition = 'persist:qq-music-login';
    const ses = session.fromPartition(partition);
    // 关键修复：每次打开登录窗口前清空该分区的登录态，
    // 避免残留旧账号 Cookie 导致“自动登回旧账号”、无法换号登录。
    try {
      await ses.clearStorageData({ storages: ['cookies', 'localstorage'] });
    } catch (err) {
      console.warn("[QQ登录] 清理旧登录态失败:");
    }
    const sheet = sheetHost.open({
      platform: 'qq',
      title: '登录 QQ 音乐',
      partition,
      url: 'https://y.qq.com/',
    });

    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearInterval(timer);
      resolve(result);
    };

    // 每 2s 读取一次 partition Cookie，出现 uin + 播放票据即视为登录成功
    const timer = setInterval(async () => {
      try {
        const list = await ses.cookies.get({});
        const raw = list.map((c) => `${c.name}=${c.value}`).join('; ');
        const normalized = normalizeCookieHeader(raw);
        const v = validatePlatformCookie('qq', normalized);
        if (v.ok) {
          cookies.set('qq', normalized, undefined, 'QQ 音乐');
          finish({ ok: true, message: 'QQ 音乐登录成功' });
          sheet.close('done');
        }
      } catch {
        /* keep polling */
      }
    }, 2000);

    // 成功路径已先 finish，之后的关闭事件不会再把它改成取消
    sheet.closed.then(() => finish({ ok: false, error: '登录窗口已关闭' }));
  });
}

function createKugouLoginWindow(cookies, kugouLogin) {
  return new Promise(async (resolve) => {
    const partition = 'persist:kugou-login';
    const ses = session.fromPartition(partition);
    try {
      await ses.clearStorageData({ storages: ['cookies', 'localstorage'] });
    } catch (err) {
      console.warn("[酷狗登录] 清理旧登录态失败:");
    }
    const win = new BrowserWindow({
      width: 1000,
      height: 800,
      backgroundColor: '#0b0c16',
      webPreferences: {
        partition,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    win.setTitle('酷狗音乐登录（官方页面）');
    win.loadURL('https://www.kugou.com/');

    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearInterval(timer);
      resolve(result);
    };

    // 方式1：监听 Set-Cookie 响应头，直接捕获登录 cookie
    const capturedCookies = new Map();
    ses.webRequest.onHeadersReceived({ urls: ['*://*.kugou.com/*'] }, (details, callback) => {
      const headers = details.responseHeaders || {};
      const setCookie = headers['set-cookie'] || headers['Set-Cookie'];
      if (setCookie && Array.isArray(setCookie)) {
        for (const sc of setCookie) {
          const name = sc.split('=')[0].trim();
          const value = sc.split('=')[1] ? sc.split('=')[1].split(';')[0].trim() : '';
          if (name && value) {
            capturedCookies.set(name, value);
          }
        }
        // 检查是否捕获到关键字段
        const hasKugooID = capturedCookies.has('KugooID');
        const hasT = capturedCookies.has('t');
        const hasKuGoo = capturedCookies.has('KuGoo');
        console.log("[酷狗登录] Set-Cookie 捕获:");

        if (hasKuGoo || (hasKugooID && hasT)) {
          console.log("[酷狗登录] 通过 Set-Cookie 检测到登录态!");
          doLoginSuccess();
        }
      }
      callback({ cancel: false, responseHeaders: details.responseHeaders });
    });

    // 方式2：定时轮询 cookie store（备用）
    let pollCount = 0;
    const timer = setInterval(async () => {
      try {
        pollCount++;
        const list = await ses.cookies.get({});
        if (pollCount % 5 === 0) {
          console.log("[main.cjs] 接口状态变化");
        }

        // 合并两种来源的 cookie
        const allNames = new Set([...list.map(c => c.name), ...capturedCookies.keys()]);

        if (allNames.has('KuGoo') || (allNames.has('KugooID') && allNames.has('t'))) {
          console.log("[酷狗登录] 通过轮询检测到登录态!");
          doLoginSuccess();
        }
      } catch (err) {
        console.warn("[酷狗登录] 轮询异常:");
      }
    }, 1500);

    async function doLoginSuccess() {
      // warmup 导航触发 token 签发
      try {
        await win.loadURL('https://www.kugou.com/newuc/user/uc/type=edit');
      } catch { /* ignore */ }
      await new Promise((r) => setTimeout(r, 2000));

      // 收集所有 cookie（session + captured 合并，captured 优先覆盖）
      const list = await ses.cookies.get({});
      const merged = new Map();
      for (const c of list) merged.set(c.name, c.value);
      for (const [k, v] of capturedCookies) merged.set(k, v);
      const finalRaw = Array.from(merged.entries())
        .map(([k, v]) => `${k}=${v}`).join('; ');



      console.log("[酷狗登录] 保存 cookie 字段:");
      console.log("[酷狗登录] finalRaw 长度:");
      console.log("[酷狗登录] 包含 KugooID:");
      cookies.set('kugou', finalRaw, undefined, '酷狗音乐');
      if (!win.isDestroyed()) win.close();
      finish({ ok: true, message: '酷狗音乐登录成功' });
    }

    win.on('closed', () => finish({ ok: false, error: '登录窗口已关闭' }));
  });
}

/**
 * 酷我官方登录：打开官网并自动弹出登录框（账号密码 / 短信 / QQ / 微信均可），
 * 轮询独立 partition 的 Cookie，userid + sid/websid 齐全即落库并关闭窗口。
 */
function createKuwoLoginWindow(cookies) {
  return new Promise(async (resolve) => {
    const partition = 'persist:kuwo-login';
    const ses = session.fromPartition(partition);
    // 每次打开前清空该分区的登录态，避免残留旧账号导致自动登回旧号。
    try {
      await ses.clearStorageData({ storages: ['cookies', 'localstorage'] });
    } catch (err) {
      console.warn('[酷我登录] 清理旧登录态失败:');
    }
    const sheet = sheetHost.open({
      platform: 'kuwo',
      title: '登录 酷我音乐',
      partition,
      url: 'https://www.kuwo.cn/?login=open',
    });

    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearInterval(timer);
      resolve(result);
    };

    // 每 2s 读取一次 partition Cookie，userid + sid/websid 齐全即视为登录成功
    const timer = setInterval(async () => {
      try {
        const list = await ses.cookies.get({});
        const raw = list.map((c) => `${c.name}=${c.value}`).join('; ');
        const normalized = normalizeCookieHeader(raw);
        const v = validatePlatformCookie('kuwo', normalized);
        if (v.ok) {
          cookies.set('kuwo', normalized, undefined, '酷我音乐');
          finish({ ok: true, message: '酷我音乐登录成功' });
          sheet.close('done');
        }
      } catch {
        /* keep polling */
      }
    }, 2000);

    sheet.closed.then(() => finish({ ok: false, error: '登录窗口已关闭' }));
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    backgroundColor: '#0a0b15',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  mainWindow = win;
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null;
  });

  if (DEV_URL) {
    win.loadURL(DEV_URL);
  } else {
    const indexHtml = path.join(__dirname, '../dist/index.html');
    if (fs.existsSync(indexHtml)) {
      win.loadFile(indexHtml);
    } else {
      win.loadURL(
        'data:text/html;charset=utf-8,' +
          encodeURIComponent(
            '<div style="font-family:sans-serif;background:#0a0b15;color:#fff;height:100vh;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:12px">' +
              '<h2>未找到构建产物 dist/index.html</h2>' +
              '<p>请先运行 <code>pnpm build:desktop</code> 后再启动 electron .</p>' +
              '</div>',
          ),
      );
    }
  }

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

/**
 * 全局请求拦截：
 * 1) onBeforeSendHeaders —— 对音乐平台域名注入 Referer/Origin/UA，解决 <audio> 防盗链 403；
 * 2) onHeadersReceived —— 放开跨域响应头，防止音频被 CORS 拦截。
 */
function setupRequestInterception() {
  const ses = session.defaultSession;
  const inject = (urls, headers) => {
    ses.webRequest.onBeforeSendHeaders({ urls }, (details, callback) => {
      details.requestHeaders = { ...details.requestHeaders, ...headers };
      callback({ requestHeaders: details.requestHeaders });
    });
  };

  inject(['*://*.music.163.com/*', '*://music.163.com/*', '*://*.music.126.net/*'], {
    Referer: 'https://music.163.com/',
    Origin: 'https://music.163.com',
    'User-Agent': UA,
  });

  inject(['*://*.qq.com/*', '*://y.qq.com/*', '*://*.gtimg.cn/*', '*://*.qpic.cn/*'], {
    Referer: 'https://y.qq.com/',
    Origin: 'https://y.qq.com',
    'User-Agent': UA,
  });

  inject(['*://*.kugou.com/*', '*://*.kugou.com.cn/*', '*://*.kugou.net/*'], {
    Referer: 'https://www.kugou.com/',
    Origin: 'https://www.kugou.com',
    'User-Agent': UA,
  });

  inject(['*://*.kuwo.cn/*', '*://kuwo.cn/*'], {
    Referer: 'https://www.kuwo.cn/',
    'User-Agent': UA,
  });

  ses.webRequest.onHeadersReceived(
    { urls: ['*://*.music.163.com/*', '*://*.music.126.net/*', '*://*.qq.com/*', '*://*.gtimg.cn/*', '*://*.kugou.com/*', '*://*.kugou.com.cn/*', '*://*.kuwo.cn/*', '*://*.douyinpic.com/*', '*://*.mzstatic.com/*'] },
    (details, callback) => {
      const responseHeaders = { ...details.responseHeaders };
      responseHeaders['Access-Control-Allow-Origin'] = ['*'];
      responseHeaders['Access-Control-Allow-Credentials'] = ['true'];
      callback({ responseHeaders });
    },
  );
}

/**
 * 本地音乐导入：系统原生文件夹选择器 → 递归扫描 mp3/flac/m4a/aac/ogg/wav →
 * music-metadata 提取 ID3/FLAC/M4A 元数据（歌名/歌手/专辑/内置封面/时长）→ 返回标准 Track 列表。
 */
async function handleOpenLocalDirectory() {
  const win = BrowserWindow.getFocusedWindow();
  const result = await dialog.showOpenDialog(win, {
    title: '选择本地音乐文件夹',
    properties: ['openDirectory'],
  });
  if (result.canceled || !result.filePaths.length) {
    return { ok: true, data: { tracks: [], canceled: true } };
  }
  const root = result.filePaths[0];
  const files = [];
  const walk = (dir, depth) => {
    if (depth > 3 || files.length >= 500) return;
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const en of entries) {
      const p = path.join(dir, en.name);
      if (en.isDirectory()) {
        walk(p, depth + 1);
      } else if (/\.(mp3|flac|m4a|aac|ogg|wav)$/i.test(en.name)) {
        files.push(p);
        if (files.length >= 500) return;
      }
    }
  };
  walk(root, 0);
  files.sort((a, b) => a.localeCompare(b));
  if (!files.length) {
    return { ok: true, data: { tracks: [], canceled: false } };
  }

  let mm;
  try {
    mm = await import('music-metadata');
  } catch (err) {
    return { ok: false, error: `music-metadata 加载失败: ${err instanceof Error ? err.message : String(err)}` };
  }

  const tracks = [];
  for (const f of files) {
    try {
      const meta = await mm.parseFile(f, { duration: true });
      const pic = meta.common.picture?.[0];
      const cover = pic?.data?.length
        ? `data:${pic.format || 'image/jpeg'};base64,${pic.data.toString('base64')}`
        : '';
      tracks.push({
        id: `local:${f}`,
        title: meta.common.title || path.basename(f, path.extname(f)),
        artist: meta.common.artist || (meta.common.artists || []).join(', ') || '未知歌手',
        artists: meta.common.artists ?? [],
        album: meta.common.album ?? '',
        cover,
        duration: Math.round(meta.format.duration || 0),
        platform: 'local',
        sourceId: f,
        originalUrl: pathToFileURL(f).href,
        fallbackUrl: '',
      });
    } catch {
      /* 损坏/不支持的音频跳过 */
    }
  }
  return { ok: true, data: { tracks, canceled: false } };
}

app.whenReady().then(async () => {
  // Cookie/Token 安全落在应用用户数据目录，按平台隔离持久化
  setCookieDataDir(app.getPath('userData'));
  primeNcmApi();

  const cookies = new CookieStore();
  const http = new HttpClient(cookies);
  const audioProxy = new AudioProxy(cookies);
  await audioProxy.start();
  app.once('before-quit', () => audioProxy.dispose());
  const adapters = createAdapters(http, cookies);
  const resolver = new SongResolver(
    adapters,
    (m) => console.warn("[SongResolver]"),
    (url, platform, signal) =>
      probeAudioUrl(url, { platform, cookie: cookies.getHeader(platform), signal }).then((r) => r.ok),
  );
  // 歌词磁盘缓存 + 自定义覆盖（存 userData，跨重启保留）
  const lyricCache = new LyricCache(app.getPath('userData'));
  // 逐字歌词的额外来源：AMLL 社区库（只带歌曲 id，不带 Cookie）、Apple Music（没有登录标记时不碰页面引擎）
  const lyricService = new LyricService(adapters, lyricCache, {
    amll: new AmllLyrics(http),
    appleMusic: new AppleMusicLyrics(adapters.applemusic.client, cookies),
  }, new LyricOverrides(app.getPath('userData')));
  const wallpaperLibrary = new WallpaperLibrary();
  protocol.handle('wallpaper', (request) => wallpaperLibrary.handle(request));
  const login = new NeteaseLogin(http, cookies);
  const qqRights = new QqRightsService(http);
  // QQ 号登录自动续期：启动 20 秒后检查一次、之后每 6 小时；票据用满 2 天或确认过期时续（见 services/qqRenew.ts）
  const qqRenew = new QqRenewService(http, cookies);
  app.once('before-quit', qqRenew.start());
  const qqLogin = new QqLogin(http, cookies, qqRights, qqRenew);
  const kugouLogin = new KugouLogin(cookies, http);
  // 汽水二次验证（2046）的验证页借主窗口的内嵌弹窗显示：签名引擎页面是个从不挂载的视图，需要时才交给宿主挂上去
  const qishuiLogin = new QishuiLogin(cookies, {
    WebContentsView,
    session,
    present: (view, title) =>
      sheetHost.open({
        platform: 'qishui',
        title,
        view,
        hint: '完成安全验证后会自动继续登录',
        placeholder: '正在加载安全验证…',
      }),
  });
  const kuwoLogin = new KuwoLogin(cookies, http);
  const bodianLogin = new BodianLogin(cookies);
  // YouTube Music：设备码登录；与适配器共用同一个协议客户端，令牌续期全局只有一个在进行
  const ytmusicLogin = new YtmusicLogin(cookies, adapters.ytmusic.client);
  // Apple Music：官方页面引擎（独立分区的 WebContentsView，从不挂载，登录时才交给内嵌弹窗显示）；
  // 适配器经「桥」在页面里读数据，令牌不出页面。UA 去掉 Electron / 应用名，用本机 Chrome 版本号。
  const appleEngine = createAppleMusicEngine({
    WebContentsView,
    session,
    sheetHost,
    userAgent: `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${process.versions.chrome} Safari/537.36`,
  });
  adapters.applemusic.client.setBridge(appleEngine);
  app.once('before-quit', () => appleEngine.dispose());
  const applemusicLogin = new AppleMusicLogin(cookies, adapters.applemusic.client);

  // 启动探活：已存 cookie 自动校验登录态，失败仅标记未登录，不抛异常
  login.probeLogin();
  const loginAdapters = {
    netease: {
      platform: 'netease',
      name: '网易云音乐',
      kind: 'qr',
      createQr: () => login.createQr(),
      pollLogin: (unikey) => login.pollLogin(unikey),
      getAccount: () => login.getAccount(),
      getMyPlaylists: () => login.getMyPlaylists(),
    },
    qq: {
      platform: 'qq',
      name: 'QQ 音乐',
      kind: 'qr',
      createQr: () => qqLogin.createQr(),
      pollLogin: (unikey) => qqLogin.pollLogin(unikey),
      getAccount: () => qqLogin.getAccount(),
      getMyPlaylists: () => qqLogin.getMyPlaylists(),
    },
    kugou: {
      platform: 'kugou',
      name: '酷狗音乐',
      kind: 'qr',
      createQr: () => kugouLogin.createQr(),
      pollLogin: (unikey) => kugouLogin.pollLogin(unikey),
      getAccount: () => kugouLogin.getAccount(),
      getMyPlaylists: () => adapters.kugou.fetchMyPlaylists(),
    },
    qishui: createQishuiLoginAdapter(qishuiLogin, { getMyPlaylists: () => adapters.qishui.fetchMyPlaylists() }),
    kuwo: createKuwoLoginAdapter({ getAccount: () => kuwoLogin.getAccount(), getMyPlaylists: () => adapters.kuwo.fetchMyPlaylists() }),
    bodian: {
      platform: 'bodian',
      name: '波点音乐',
      kind: 'qr',
      createQr: () => bodianLogin.createQr(),
      pollLogin: (unikey) => bodianLogin.pollLogin(unikey),
      getAccount: () => bodianLogin.getAccount(),
      getMyPlaylists: () => adapters.bodian.fetchMyPlaylists(),
    },
    ytmusic: {
      platform: 'ytmusic',
      name: 'YouTube Music',
      kind: 'device',
      createQr: () => ytmusicLogin.createQr(),
      pollLogin: (unikey) => ytmusicLogin.pollLogin(unikey),
      getAccount: () => ytmusicLogin.getAccount(),
      getMyPlaylists: () => adapters.ytmusic.fetchMyPlaylists(),
    },
    applemusic: createAppleMusicLoginAdapter({ getAccount: () => applemusicLogin.getAccount(), getMyPlaylists: () => adapters.applemusic.fetchMyPlaylists() }),
    spotify: {
      platform: 'spotify',
      name: 'Spotify',
      kind: 'oauth',
      getAccount: async () => {
        const rec = cookies.get('spotify');
        if (!rec?.cookies) return null;
        const me = await adapters.spotify.fetchMe();
        if (me === 'expired') return { loggedIn: false, authStatus: 'expired', error: 'Spotify 登录已过期，请重新授权' };
        if (!me) return { loggedIn: true, authStatus: 'unknown', userId: 'spotify', nickname: 'Spotify 用户' };
        return { loggedIn: true, authStatus: 'valid', userId: me.id, nickname: me.nickname, avatarUrl: me.avatarUrl, isVip: me.premium, isSvip: false };
      },
      getMyPlaylists: () => adapters.spotify.getMyPlaylists(),
    },
  };
  // 多平台 VIP 路由：按已登录账号的 SVIP/VIP 状态决定音源兜底顺序（汽水仅作歌单来源）
  const fallbackPriority = createFallbackPriorityProvider(loginAdapters);
  resolver.setFallbackTargets(fallbackPriority);
  cookies.onChange(() => { resolver.invalidate(); fallbackPriority.invalidate(); clearProbeCache(); qqSession(http).clear(); qqRights.clear(); });

  registerIpcHandlers(ipcMain, {
    adapters,
    resolver,
    lyricService,
    cookies,
    login,
    loginAdapters,
    audioProxy,
    spotifyOAuth: createSpotifyOAuth(cookies),
    qqLoginWindow: () => createQqLoginWindow(cookies),
    kugouLoginWindow: () => createKugouLoginWindow(cookies, kugouLogin),
    kuwoLoginWindow: () => createKuwoLoginWindow(cookies),
    // Apple Music：在内嵌弹窗里打开官方页面；登录成功后只在 CookieStore 记一条不含凭据的标记（登录态在页面分区里）
    applemusicLoginWindow: async () => {
      const r = await appleEngine.login();
      if (r.ok) cookies.set('applemusic', 'page-session', '', 'Apple Music');
      return r.ok ? { ok: true, message: 'Apple Music 登录成功' } : r;
    },
    wallpaperLibrary,
    // 退出登录时同步清空 QQ / 酷我官方登录窗口独立分区的 Cookie，
    // 确保 CookieStore 与浏览器会话一并干净退出。
    onCookieClear: async (platform, previous) => {
      // YouTube Music：尽力撤销续期令牌（失败忽略、不记日志——令牌在请求地址里）
      if (platform === 'ytmusic' && previous?.token) void revokeYtmusicToken(previous.token);
      // Apple Music：退出时页面里取消授权并清空分区存储（登录态不在 CookieStore 里）
      if (platform === 'applemusic') {
        await appleEngine.logout();
        return;
      }
      const partitions = { qq: 'persist:qq-music-login', kuwo: 'persist:kuwo-login' };
      if (!partitions[platform]) return;
      try {
        await session.fromPartition(partitions[platform]).clearStorageData({
          storages: ['cookies', 'localstorage'],
        });
      } catch (err) {
        console.warn(`[${platform}登录] 退出时清理分区 Cookie 失败:`);
      }
    },
  });
  ipcMain.handle('nebula:open-local-directory', handleOpenLocalDirectory);
  ipcMain.handle('nebula:open-external', (_event, payload) => {
    const url = String(payload?.url ?? '');
    if (/^[a-z][a-z0-9+.-]*:/i.test(url) && !/^(javascript|data):/i.test(url)) {
      return shell.openExternal(url);
    }
    return false;
  });
  setupRequestInterception();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
