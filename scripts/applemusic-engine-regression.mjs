// Apple Music 页面引擎（electron/appleMusicEngine.cjs）：不启动 Electron，用假的 WebContentsView / session / sheetHost 验证。
// 页面里的读取函数直接放进 node:vm 的假 window 里真实执行，所以「精简结果里没有令牌」是对真实代码的断言。
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const engineModule = require('../electron/appleMusicEngine.cjs');
const { createAppleMusicEngine, isAllowedNavigation, cleanUserAgent, readInPage, buildRequestCode, HOME_URL, PARTITION } = engineModule;

const say = (s) => process.stdout.write(s + '\n');
let passed = 0;
async function test(name, fn) { await fn(); passed++; say('通过 ' + name); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TIMING = { readyTimeoutMs: 120, readyPollMs: 10, requestTimeoutMs: 150, loginPollMs: 15, loginProbeMs: 60 };
const CLEAN_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36';

/** 页面里的 MusicKit 假实现；developerToken / musicUserToken 是合成的敏感值，任何输出里都不许出现。 */
function makeMusicKit(state) {
  const mk = {
    isAuthorized: state.authorized,
    developerToken: 'DEV-TOKEN-SECRET',
    musicUserToken: 'USER-TOKEN-SECRET',
    api: {},
  };
  const impl = async (path, query) => {
    state.running++;
    state.maxRunning = Math.max(state.maxRunning, state.running);
    state.apiCalls.push({ path, query: { ...query } });
    try { return await state.music(path, query); } finally { state.running--; }
  };
  if (state.v3) mk.api.v3 = { music: (...a) => { state.usedV3++; return impl(...a); } };
  else mk.api.music = (...a) => { state.usedLegacy++; return impl(...a); };
  return mk;
}

function makeEnv(opts = {}) {
  const state = {
    ready: true, authorized: false, v3: false, usedV3: 0, usedLegacy: 0, apiCalls: [], running: 0, maxRunning: 0,
    music: async () => ({ status: 200, data: { data: [] } }),
    requestCodes: 0, readyProbes: 0, unauthorizeRuns: 0, cleared: [], partitions: [], loads: [], uaSet: [], views: [],
    loadFails: 0, ...opts,
  };
  class FakeView {
    constructor(o) {
      this.opts = o; this.added = 0; this.bounds = 0; this.handlers = {}; this.openHandler = null; this.destroyed = false; this.closed = false;
      const self = this;
      this.webContents = {
        on: (n, fn) => { (self.handlers[n] ??= []).push(fn); },
        setUserAgent: (ua) => state.uaSet.push(ua),
        getUserAgent: () => 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) music-nebula/0.1.0 Chrome/150.0.0.0 Electron/43.0.0 Safari/537.36',
        setWindowOpenHandler: (fn) => { self.openHandler = fn; },
        loadURL: async (u) => { state.loads.push(u); if (state.loadFails > 0) { state.loadFails--; throw new Error('ERR_INTERNET_DISCONNECTED'); } },
        isDestroyed: () => self.destroyed,
        close: () => { self.closed = true; self.destroyed = true; },
        executeJavaScript: async (code) => {
          if (self.destroyed) throw new Error('destroyed');
          if (code.includes('readInPage')) {
            state.requestCodes++;
            if (!state.ready) return { notReady: true };
            return runInPage(code, state);
          }
          if (code.includes('unauthorize')) { state.unauthorizeRuns++; return true; }
          if (code.includes('isAuthorized')) return state.ready ? state.authorized : null;
          if (code.includes('MusicKit')) { state.readyProbes++; return state.ready; }
          throw new Error('意外的页面脚本');
        },
      };
      state.views.push(this);
    }
    setBackgroundColor() {}
    addChildView() { this.added++; }
    setBounds() { this.bounds++; }
  }
  const sheets = [];
  const sheetHost = {
    current: null,
    open(o) {
      let resolveClosed;
      const closed = new Promise((r) => { resolveClosed = r; });
      const sheet = { opts: o, view: o.view, closed, closeReason: null, close(reason = 'done') { if (this.closeReason) return; this.closeReason = reason; resolveClosed(reason); } };
      sheets.push(sheet);
      this.current = sheet;
      return sheet;
    },
    getCurrent() { return this.current; },
  };
  const session = {
    fromPartition: (p) => { state.partitions.push(p); return { clearStorageData: async (o) => { state.cleared.push(o); } }; },
  };
  const engine = createAppleMusicEngine({ WebContentsView: FakeView, session, sheetHost, userAgent: CLEAN_UA, timing: TIMING, ...(opts.engine ?? {}) });
  return { engine, state, sheetHost, sheets, FakeView };
}

/** 在假页面里执行代码，结果过一遍 JSON（模拟 Electron 的结构化克隆，也免得跨 vm 域的对象原型不同）。 */
async function runInPage(code, state) {
  const out = await vm.runInNewContext(code, {
    setTimeout,
    clearTimeout,
    window: { MusicKit: { getInstance: () => makeMusicKit(state) } },
  });
  return out === undefined ? undefined : JSON.parse(JSON.stringify(out));
}

/** 一条合成的资料库曲目响应，里面混着各种不该带出页面的东西。 */
const dirtyTrack = () => ({
  id: 'i.AAA', type: 'library-songs', href: '/v1/me/library/songs/i.AAA',
  attributes: {
    name: '歌', artistName: '手', albumName: '辑', durationInMillis: 123456, isrc: 'X1',
    artwork: { url: 'https://is1-ssl.mzstatic.com/x/{w}x{h}bb.{f}', width: 3000, height: 3000, bgColor: 'ffffff' },
    playParams: { id: 'i.AAA', kind: 'song', isLibrary: true, catalogId: '1001', developerToken: 'DEV-TOKEN-SECRET' },
    tags: ['favorited', 123], description: { standard: '简介', short: '短' }, trackCount: 3, canEdit: true, isPublic: false,
    lastModifiedDate: '2026-01-01T00:00:00Z', curatorName: '某人',
    musicUserToken: 'USER-TOKEN-SECRET', editorialNotes: { standard: '不要带出' }, url: 'https://x',
  },
  relationships: {
    catalog: { data: [{ id: '1001', type: 'songs', attributes: { isrc: 'USX000000001', name: '目录名', musicUserToken: 'USER-TOKEN-SECRET' } }] },
    albums: { data: [{ id: 'l.zzz' }] },
  },
  headers: { Authorization: 'Bearer DEV-TOKEN-SECRET', 'Music-User-Token': 'USER-TOKEN-SECRET' },
});

/* ---------- 视图生命周期 ---------- */
await test('懒创建：创建引擎不建视图；第一次调用才建，分区 / 隔离参数正确，设干净 UA，加载首页，从不挂载到窗口', async () => {
  const { engine, state } = makeEnv();
  assert.equal(state.views.length, 0);
  assert.equal(await engine.isAuthorized(), null, '视图还没建时 isAuthorized 是 null，也不会顺手建视图');
  assert.equal(state.views.length, 0);
  await engine.call({ path: '/v1/me/storefront' });
  await engine.call({ path: '/v1/me/storefront' });
  assert.equal(state.views.length, 1, '只建一个');
  const v = state.views[0];
  assert.deepEqual(v.opts, { webPreferences: { partition: 'persist:applemusic-login', contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false } });
  assert.equal(PARTITION, 'persist:applemusic-login');
  assert.deepEqual(state.uaSet, [CLEAN_UA]);
  assert.ok(!/Electron|music-nebula/.test(state.uaSet[0]));
  assert.deepEqual(state.loads, [HOME_URL]);
  assert.equal(HOME_URL, 'https://music.apple.com/');
  assert.equal(v.added, 0, '从不 addChildView');
  assert.equal(v.bounds, 0);
});

await test('UA：没传 userAgent 时从默认 UA 里剔除 Electron 和应用名片段', async () => {
  const dirty = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) music-nebula/0.1.0 Chrome/150.0.0.0 Electron/43.0.0 Safari/537.36';
  assert.equal(cleanUserAgent(dirty), CLEAN_UA);
  const { engine, state } = makeEnv({ engine: { userAgent: undefined } });
  await engine.call({ path: '/v1/me/storefront' });
  assert.equal(state.uaSet[0], CLEAN_UA);
});

/* ---------- 读取与精简 ---------- */
await test('读取：页面里精简——只留白名单字段，令牌 / 请求头 / 多余字段一个都不出页面', async () => {
  const { engine, state } = makeEnv();
  state.music = async () => ({
    status: 200,
    data: { data: [dirtyTrack()], next: '/v1/me/library/playlists/p.X/tracks?offset=100', meta: { total: 7, secret: 'x' }, token: 'USER-TOKEN-SECRET', errors: undefined },
    headers: { Authorization: 'Bearer DEV-TOKEN-SECRET' },
  });
  const r = await engine.call({ path: '/v1/me/library/playlists/p.X/tracks', query: { limit: 100, offset: 0, include: 'catalog' } });
  assert.deepEqual(Object.keys(r).sort(), ['data', 'next', 'status', 'total']);
  assert.equal(r.status, 200);
  assert.equal(r.total, 7);
  assert.equal(r.next, '/v1/me/library/playlists/p.X/tracks?offset=100');
  assert.deepEqual(r.data[0], {
    id: 'i.AAA', type: 'library-songs', href: '/v1/me/library/songs/i.AAA',
    attributes: {
      name: '歌', artistName: '手', albumName: '辑', durationInMillis: 123456, isrc: 'X1', curatorName: '某人', lastModifiedDate: '2026-01-01T00:00:00Z',
      artwork: { url: 'https://is1-ssl.mzstatic.com/x/{w}x{h}bb.{f}' },
      playParams: { id: 'i.AAA', kind: 'song', isLibrary: true, catalogId: '1001' },
      tags: ['favorited'], description: { standard: '简介' }, trackCount: 3, canEdit: true, isPublic: false,
    },
    relationships: { catalog: { data: [{ id: '1001', attributes: { isrc: 'USX000000001' } }] } },
  });
  const json = JSON.stringify(r);
  assert.ok(!/SECRET|developerToken|musicUserToken|Authorization|Bearer|Music-User-Token|editorialNotes/i.test(json), '输出里不应有任何令牌 / 请求头');
  assert.deepEqual(state.apiCalls[0], { path: '/v1/me/library/playlists/p.X/tracks', query: { limit: 100, offset: 0, include: 'catalog' } });
});

await test('读取：有 mk.api.v3 用 v3.music，没有就用 mk.api.music', async () => {
  const a = makeEnv();
  a.state.v3 = true;
  await a.engine.call({ path: '/v1/me/storefront' });
  assert.equal(a.state.usedV3, 1);
  assert.equal(a.state.usedLegacy, 0);
  const b = makeEnv();
  await b.engine.call({ path: '/v1/me/storefront' });
  assert.equal(b.state.usedLegacy, 1);
});

await test('错误：以 resolve 形式带 errors 的 4xx、直接抛出的 401、未知异常都能识别，errors 只留 code / status', async () => {
  const { engine, state } = makeEnv();
  state.music = async () => ({ status: 400, data: { errors: [{ code: '40015', status: '400', title: 'Bad', detail: 'privilege: CloudLibrary ' + 'USER-TOKEN-SECRET' }] } });
  const a = await engine.call({ path: '/v1/me/library/playlists' });
  assert.deepEqual(a, { status: 400, errors: [{ code: '40015', status: '400' }] });
  assert.ok(!JSON.stringify(a).includes('SECRET'));
  state.music = async () => ({ data: { errors: [{ code: '40015', status: '400' }] } });
  assert.equal((await engine.call({ path: '/v1/me/library/playlists' })).status, 400, '没有 status 时取 errors[0].status');
  state.music = async () => { throw Object.assign(new Error('Unauthorized'), { status: 401 }); };
  const b = await engine.call({ path: '/v1/me/storefront' });
  assert.equal(b.status, 401);
  assert.equal(b.errors[0].code, 'request-failed');
  state.music = async () => { throw new Error('boom'); };
  const c = await engine.call({ path: '/v1/me/storefront' });
  assert.equal(c.status, 0);
  assert.equal(c.errors[0].code, 'request-failed');
});

await test('订阅状态：meta.subscription.active 保留，其他 meta 字段丢掉', async () => {
  const { engine, state } = makeEnv();
  state.music = async () => ({ status: 200, data: { meta: { subscription: { active: true, storefront: 'cn', secret: 1 }, other: 1 } } });
  assert.deepEqual(await engine.call({ path: '/v1/me/account', query: { meta: 'subscription' } }), { status: 200, meta: { subscription: { active: true } } });
});

/* ---------- 路径 / 查询校验 ---------- */
await test('路径与查询校验：主进程拒绝，页面里的函数也拒绝（不会去调 MusicKit）', async () => {
  const { engine, state } = makeEnv();
  const badPaths = ['', '/v1/me/../x', '/v1/me/..', '/v2/me/x', 'v1/me/x', '/v1/foo/x', '/v1/me/a b', "/v1/me/a'b", '/v1/me/a"b', '/v1/me//x', '/v1/me/', '/v1/me/x?y=1', '/v1/catalog/cn/playlists/pl.x;rm', null, undefined, 42];
  for (const p of badPaths) await assert.rejects(engine.call({ path: p }), /路径不合法/, `path=${JSON.stringify(p)}`);
  for (const q of [{ a: { b: 1 } }, { a: true }, { a: null }, { 'a b': 1 }, { 'a"': 1 }, { a: [1] }]) {
    await assert.rejects(engine.call({ path: '/v1/me/storefront', query: q }), /参数不合法/, JSON.stringify(q));
  }
  assert.equal(state.views.length, 0, '校验失败不建视图');
  assert.equal(state.apiCalls.length, 0);
  // 页面内的校验（绕过主进程直接给页面函数）
  for (const req of [{ path: '/v1/me/../x' }, { path: '/v1/me/a b' }, { path: '/v1/me/x', query: { a: { b: 1 } } }, { path: '/v1/me/x', query: { 'a b': 1 } }, null]) {
    assert.deepEqual(await runInPage(`(${readInPage.toString()})(${JSON.stringify(req)})`, state), { invalid: true });
  }
  assert.equal(state.apiCalls.length, 0);
  await engine.call({ path: '/v1/catalog/cn/playlists/pl.u-abc.1_2/tracks', query: { limit: 100, offset: 0, extend: 'tags' } });
  assert.equal(state.apiCalls.length, 1);
});

await test('读取函数的源码里没有令牌 / 请求头相关的访问', async () => {
  const code = buildRequestCode('/v1/me/storefront', {});
  assert.ok(!/developerToken|musicUserToken|Authorization|Music-User-Token|localStorage|cookie|\.headers/i.test(code));
  assert.ok(code.includes('/v1/me/storefront'));
});

/* ---------- 就绪 / 串行 / 超时 ---------- */
await test('页面没就绪：等到上限返回 { notReady: true }（不执行请求）；之后就绪了又能用', async () => {
  const { engine, state } = makeEnv({ ready: false });
  const t0 = Date.now();
  assert.deepEqual(await engine.call({ path: '/v1/me/storefront' }), { notReady: true });
  assert.ok(Date.now() - t0 >= 100, '至少等满就绪超时');
  assert.equal(state.requestCodes, 0);
  assert.ok(state.readyProbes >= 3, '轮询过就绪');
  state.ready = true;
  assert.equal((await engine.call({ path: '/v1/me/storefront' })).status, 200);
});

await test('页面里的 MusicKit 中途消失：返回 notReady，并重新轮询', async () => {
  const { engine, state } = makeEnv();
  await engine.call({ path: '/v1/me/storefront' });
  state.ready = false;
  assert.deepEqual(await engine.call({ path: '/v1/me/storefront' }), { notReady: true });
  state.ready = true;
  assert.equal((await engine.call({ path: '/v1/me/storefront' })).status, 200);
});

await test('请求串行：同时发出的多个请求按顺序一个一个跑', async () => {
  const { engine, state } = makeEnv();
  state.music = async (path) => { await sleep(15); return { status: 200, data: { data: [{ id: path.slice(-1), type: 't' }] } }; };
  const rs = await Promise.all(['a', 'b', 'c', 'd'].map((x) => engine.call({ path: `/v1/me/library/songs/${x}` })));
  assert.deepEqual(rs.map((r) => r.data[0].id), ['a', 'b', 'c', 'd']);
  assert.equal(state.maxRunning, 1);
  assert.deepEqual(state.apiCalls.map((c) => c.path.slice(-1)), ['a', 'b', 'c', 'd']);
});

await test('请求超时：抛「请求超时」，之后的请求照常（队列不卡死）', async () => {
  const { engine, state } = makeEnv();
  let hang = true;
  state.music = async () => (hang ? new Promise(() => {}) : { status: 200, data: { data: [] } });
  await assert.rejects(engine.call({ path: '/v1/me/storefront' }), /超时/);
  hang = false;
  assert.equal((await engine.call({ path: '/v1/me/storefront' })).status, 200);
});

await test('首页加载失败（离线）：下次用到时重新加载', async () => {
  const { engine, state } = makeEnv({ loadFails: 1, ready: false });
  const p = engine.call({ path: '/v1/me/storefront' });
  // 页面要等重新加载之后才有 MusicKit
  const timer = setInterval(() => { if (state.loads.length >= 2) state.ready = true; }, 5);
  const r = await p;
  clearInterval(timer);
  assert.equal(r.status, 200);
  assert.ok(state.loads.length >= 2, '失败后又加载了一次');
});

/* ---------- 导航白名单 ---------- */
await test('导航白名单：只放行 Apple 的 https 域名；will-navigate / will-redirect 新旧两种参数形式都拦', async () => {
  const allowed = ['https://music.apple.com/cn', 'https://authorize.music.apple.com/woa', 'https://account.apple.com/sign-in', 'https://appleid.apple.com/auth', 'https://idmsa.apple.com/appleauth', 'https://www.apple.com/'];
  const denied = ['http://music.apple.com/', 'https://evil.com/', 'https://music.apple.com.evil.com/', 'https://evilapple.com/', 'https://apple.com.evil.com/', 'https://user:pw@music.apple.com/', 'https://music.apple.com:8443/', 'javascript:alert(1)', 'file:///C:/x', 'about:blank', 'not a url', ''];
  for (const u of allowed) assert.equal(isAllowedNavigation(u), true, u);
  for (const u of denied) assert.equal(isAllowedNavigation(u), false, u);
  const { engine, state } = makeEnv();
  await engine.call({ path: '/v1/me/storefront' });
  const v = state.views[0];
  for (const evName of ['will-navigate', 'will-redirect']) {
    assert.equal(v.handlers[evName].length, 1);
    for (const u of denied.slice(0, 6)) {
      let prevented = 0;
      v.handlers[evName][0]({ url: u, preventDefault: () => prevented++ });
      assert.equal(prevented, 1, `${evName} 应拦截 ${u}`);
      prevented = 0;
      v.handlers[evName][0]({ preventDefault: () => prevented++ }, u);
      assert.equal(prevented, 1, `${evName}（旧参数形式）应拦截 ${u}`);
    }
    for (const u of allowed) {
      let prevented = 0;
      v.handlers[evName][0]({ url: u, preventDefault: () => prevented++ });
      assert.equal(prevented, 0, `${evName} 应放行 ${u}`);
    }
  }
  // 新开窗口一律 deny；白名单内的 https 在同一个视图里打开
  const before = state.loads.length;
  assert.deepEqual(v.openHandler({ url: 'https://evil.com/x' }), { action: 'deny' });
  assert.equal(state.loads.length, before);
  assert.deepEqual(v.openHandler({ url: 'https://idmsa.apple.com/appleauth' }), { action: 'deny' });
  assert.equal(state.loads.at(-1), 'https://idmsa.apple.com/appleauth');
});

/* ---------- 登录 / 退出 ---------- */
await test('login：把同一个视图交给内嵌弹窗；授权成功就关闭弹窗并返回 ok', async () => {
  const { engine, state, sheets } = makeEnv();
  let polls = 0;
  const timer = setInterval(() => { if (sheets.length && ++polls >= 3) state.authorized = true; }, 10);
  const r = await engine.login();
  clearInterval(timer);
  assert.equal(r.ok, true);
  assert.equal(sheets.length, 1);
  const o = sheets[0].opts;
  assert.equal(o.platform, 'applemusic');
  assert.equal(o.title, '登录 Apple Music');
  assert.equal(o.view, state.views[0], '交出去的就是引擎自己的视图');
  assert.equal(o.hint, '点页面右上角的「登录」，用 Apple ID 登录；登录完成后会自动关闭');
  assert.equal(o.placeholder, '正在打开 Apple Music…');
  assert.equal(sheets[0].closeReason, 'done');
  assert.equal(state.views[0].added, 0, '引擎自己仍不挂载（挂载是 sheetHost 的事）');
});

await test('login：用户关掉弹窗 → 失败「登录窗口已关闭」', async () => {
  const { engine, sheets } = makeEnv();
  const p = engine.login();
  await sleep(120);
  sheets[0].close('user');
  assert.deepEqual(await p, { ok: false, error: '登录窗口已关闭' });
});

await test('login：已经是登录状态直接成功，不弹窗', async () => {
  const { engine, sheets } = makeEnv({ authorized: true });
  const r = await engine.login();
  assert.equal(r.ok, true);
  assert.equal(sheets.length, 0);
});

await test('login：同时点两次只开一个弹窗；弹窗没法显示（没有主窗口）时给出明确错误', async () => {
  const a = makeEnv();
  const p1 = a.engine.login();
  const p2 = a.engine.login();
  await sleep(120);
  assert.equal(a.sheets.length, 1);
  a.state.authorized = true;
  const [r1, r2] = await Promise.all([p1, p2]);
  assert.equal(r1.ok && r2.ok, true);
  const b = makeEnv();
  b.sheetHost.open = () => ({ view: null, closed: Promise.resolve('unavailable'), close() {} });
  const r = await b.engine.login();
  assert.equal(r.ok, false);
  assert.match(r.error, /无法打开登录窗口/);
});

await test('isAuthorized：页面里 mk.isAuthorized；页面没就绪是 null', async () => {
  const { engine, state } = makeEnv({ authorized: true });
  await engine.call({ path: '/v1/me/storefront' });
  assert.equal(await engine.isAuthorized(), true);
  state.authorized = false;
  assert.equal(await engine.isAuthorized(), false);
  state.ready = false;
  assert.equal(await engine.isAuthorized(), null);
});

await test('logout：页面里尽力取消授权，清空该分区的存储，视图重新加载首页', async () => {
  const { engine, state } = makeEnv({ authorized: true });
  await engine.call({ path: '/v1/me/storefront' });
  const loadsBefore = state.loads.length;
  await engine.logout();
  assert.equal(state.unauthorizeRuns, 1);
  assert.deepEqual(state.partitions, ['persist:applemusic-login']);
  assert.equal(state.cleared.length, 1);
  for (const k of ['cookies', 'localstorage', 'indexdb', 'serviceworkers']) assert.ok(state.cleared[0].storages.includes(k), k);
  assert.equal(state.loads.length, loadsBefore + 1);
  assert.equal(state.loads.at(-1), HOME_URL);
  // 视图从没建过（本次没用过 Apple）：也要清分区，但不建视图
  const fresh = makeEnv();
  await fresh.engine.logout();
  assert.equal(fresh.state.cleared.length, 1);
  assert.equal(fresh.state.views.length, 0);
});

await test('dispose：销毁视图、收掉自己正在显示的弹窗；之后不能再用', async () => {
  const { engine, state, sheets } = makeEnv();
  const p = engine.login();
  await sleep(120);
  engine.dispose();
  assert.equal(state.views[0].closed, true);
  assert.equal(sheets[0].closeReason, 'superseded');
  assert.equal((await p).ok, false);
  await assert.rejects(engine.call({ path: '/v1/me/storefront' }), /已关闭/);
  engine.dispose();
});

/* ---------- 批量读（#192：歌单曲目数） ---------- */
await test('callMany：一次页面执行、页面里并发不超过 6、结果按顺序，令牌不出页面', async () => {
  const { engine, state } = makeEnv();
  state.music = async (path) => {
    await sleep(5);
    const n = Number(path.split('/')[5].slice(2));
    return { status: 200, data: { data: [dirtyTrack()], meta: { total: n * 10 } }, musicUserToken: 'USER-TOKEN-SECRET' };
  };
  const reqs = Array.from({ length: 14 }, (_, i) => ({ path: `/v1/me/library/playlists/p.${i}/tracks`, query: { limit: 1 } }));
  const before = state.requestCodes;
  const res = await engine.callMany(reqs);
  assert.equal(state.requestCodes - before, 1, '14 个请求只执行一次页面脚本');
  assert.deepEqual(res.map((r) => r.total), reqs.map((_, i) => i * 10));
  assert.ok(state.maxRunning > 1 && state.maxRunning <= 6, `并发 ${state.maxRunning}`);
  assert.ok(!/SECRET|developerToken|musicUserToken/i.test(JSON.stringify(res)));
});

await test('callMany：非法路径 / 参数、超过上限都在主进程拒绝且不执行；空数组直接返回；页面没就绪返回 notReady', async () => {
  const { engine, state } = makeEnv();
  const before = state.requestCodes;
  await assert.rejects(engine.callMany([{ path: '/v1/me/storefront' }, { path: '/v1/me/../x' }]), /不合法/);
  await assert.rejects(engine.callMany([{ path: '/v1/me/storefront', query: { 'a b': 1 } }]), /不合法/);
  await assert.rejects(engine.callMany(Array.from({ length: engineModule.BATCH_MAX + 1 }, () => ({ path: '/v1/me/storefront' }))), /数量不合法/);
  assert.deepEqual(await engine.callMany([]), []);
  assert.equal(state.requestCodes, before);
  const nr = makeEnv({ ready: false });
  assert.deepEqual(await nr.engine.callMany([{ path: '/v1/me/storefront' }]), { notReady: true });
});

await test('callMany：和单个请求共用队列（串行，不会和别的读取同时跑）', async () => {
  const { engine, state } = makeEnv();
  const order = [];
  state.music = async (path) => { order.push('start ' + path); await sleep(10); order.push('end ' + path); return { status: 200, data: { data: [] } }; };
  await Promise.all([
    engine.call({ path: '/v1/me/storefront' }),
    engine.callMany([{ path: '/v1/me/library/playlists/p.1/tracks' }]),
    engine.call({ path: '/v1/me/social-profile' }),
  ]);
  assert.deepEqual(order, [
    'start /v1/me/storefront', 'end /v1/me/storefront',
    'start /v1/me/library/playlists/p.1/tracks', 'end /v1/me/library/playlists/p.1/tracks',
    'start /v1/me/social-profile', 'end /v1/me/social-profile',
  ]);
});

/* ---------- 逐字歌词（syllable-lyrics）与目录搜索 ---------- */
await test('歌词：ttml / ttmlLocalizations 字符串带出页面（≤2MB），超限 / 非字符串丢弃，令牌与多余字段仍不出页面', async () => {
  const { engine, state } = makeEnv();
  const xml = '<tt>' + 'x'.repeat(1000) + '</tt>';
  const ok = { id: '111', type: 'syllable-lyrics', attributes: { ttml: xml, ttmlLocalizations: xml + 'L', musicUserToken: 'USER-TOKEN-SECRET', role: 7 } };
  state.music = async () => ({ status: 200, data: { data: [ok], token: 'USER-TOKEN-SECRET' }, headers: { Authorization: 'Bearer DEV-TOKEN-SECRET' } });
  const r = await engine.call({ path: '/v1/catalog/cn/songs/111/syllable-lyrics', query: { l: 'zh-Hans-CN', extend: 'ttmlLocalizations' } });
  assert.deepEqual(r.data[0], { id: '111', type: 'syllable-lyrics', href: '', attributes: { ttml: xml, ttmlLocalizations: xml + 'L' } });
  assert.ok(!/SECRET|musicUserToken|Authorization/i.test(JSON.stringify(r)));
  assert.deepEqual(state.apiCalls[0], { path: '/v1/catalog/cn/songs/111/syllable-lyrics', query: { l: 'zh-Hans-CN', extend: 'ttmlLocalizations' } });
  const MAX = 2 * 1024 * 1024;
  state.music = async () => ({ status: 200, data: { data: [
    { id: 'a', attributes: { ttml: 'y'.repeat(MAX), ttmlLocalizations: 'y'.repeat(MAX + 1) } },
    { id: 'b', attributes: { ttml: { evil: 1 }, ttmlLocalizations: 42 } },
  ] } });
  const big = await engine.call({ path: '/v1/catalog/cn/songs/1/syllable-lyrics' });
  assert.equal(big.data[0].attributes.ttml.length, MAX, '恰好 2MB 保留');
  assert.ok(!('ttmlLocalizations' in big.data[0].attributes), '超过 2MB 丢弃');
  assert.deepEqual(big.data[1].attributes, {}, '非字符串丢弃');
});

await test('歌词：主进程 sanitize 再核一遍 ttml 字段（页面精简之外的第二道），超限 / 非字符串被去掉', async () => {
  const { engine, state } = makeEnv();
  // 绕过页面里的精简：让「页面」直接返回带超大字段的原始结果
  const MAX = 2 * 1024 * 1024;
  const v = (await (async () => { await engine.call({ path: '/v1/me/storefront' }); return state.views[0]; })());
  const orig = v.webContents.executeJavaScript;
  v.webContents.executeJavaScript = async (code, ...rest) => {
    if (code.includes('readInPage')) return { status: 200, data: [{ id: 'z', attributes: { ttml: 'q'.repeat(MAX + 5), ttmlLocalizations: 'ok', name: 'n' } }, { id: 'w', attributes: { ttml: 5 } }] };
    return orig(code, ...rest);
  };
  const r = await engine.call({ path: '/v1/catalog/cn/songs/1/syllable-lyrics' });
  assert.deepEqual(r.data[0].attributes, { ttmlLocalizations: 'ok', name: 'n' });
  assert.deepEqual(r.data[1].attributes, {});
});

await test('目录搜索：响应体 results.songs.data 按 thin 精简后放进返回结果的 data；普通 data 仍优先', async () => {
  const { engine, state } = makeEnv();
  state.music = async () => ({ status: 200, data: { results: { songs: { data: [dirtyTrack(), { id: '2', type: 'songs', attributes: { name: 'n2', secret: 'USER-TOKEN-SECRET' } }], href: '/x', next: '/y' }, albums: { data: [{ id: 'no' }] } }, meta: { results: { order: ['songs'] } } } });
  const r = await engine.call({ path: '/v1/catalog/cn/search', query: { term: '编的歌 编的歌手', types: 'songs', limit: 8 } });
  assert.deepEqual(Object.keys(r).sort(), ['data', 'status']);
  assert.equal(r.data.length, 2);
  assert.equal(r.data[0].attributes.isrc, 'X1');
  assert.deepEqual(r.data[1], { id: '2', type: 'songs', href: '', attributes: { name: 'n2' } });
  assert.ok(!/SECRET|developerToken|musicUserToken|Authorization|albums|\"no\"/i.test(JSON.stringify(r)));
  assert.deepEqual(state.apiCalls[0], { path: '/v1/catalog/cn/search', query: { term: '编的歌 编的歌手', types: 'songs', limit: 8 } });
  state.music = async () => ({ status: 200, data: { data: [{ id: 'top', type: 't' }], results: { songs: { data: [{ id: 'other' }] } } } });
  assert.equal((await engine.call({ path: '/v1/catalog/cn/search' })).data[0].id, 'top');
  state.music = async () => ({ status: 200, data: { results: { songs: { data: 'bad' } } } });
  assert.deepEqual(await engine.call({ path: '/v1/catalog/cn/search' }), { status: 200 });
});

await test('callMany：单项卡住只令该项返回 timeout 错误，其余项曲目数照常返回；readInPage 支持字符串 total 与空 tracks=0', async () => {
  const { engine, state } = makeEnv({
    engine: { timing: { readyTimeoutMs: 120, readyPollMs: 10, requestTimeoutMs: 150, batchItemTimeoutMs: 40, batchTimeoutMs: 400, loginPollMs: 15, loginProbeMs: 60 } },
  });
  state.music = async (path) => {
    if (path.includes('/p.HANG/')) return new Promise(() => {});
    if (path.includes('/p.STR/')) return { status: 200, data: { data: [], meta: { total: '42' } } };
    if (path.includes('/p.EMPTY/')) return { status: 200, data: { data: [] } };
    return { status: 200, meta: { total: 15 }, data: { data: [] } };
  };
  const rs = await engine.callMany([
    { path: '/v1/me/library/playlists/p.STR/tracks', query: { limit: 1 } },
    { path: '/v1/me/library/playlists/p.HANG/tracks', query: { limit: 1 } },
    { path: '/v1/me/library/playlists/p.EMPTY/tracks', query: { limit: 1 } },
    { path: '/v1/me/library/playlists/p.TOP/tracks', query: { limit: 1 } },
  ]);
  assert.equal(rs.length, 4);
  assert.equal(rs[0].total, 42);
  assert.equal(rs[1].status, 0);
  assert.equal(rs[1].errors[0].code, 'timeout');
  assert.equal(rs[2].total, 0);
  assert.equal(rs[3].total, 15);
});

await test('目录搜索歌手 / 专辑与专辑曲目白名单放行，同时不泄漏令牌且资料库曲目仍剥离 editorialNotes（#322）', async () => {
  const { engine, state } = makeEnv();
  state.music = async (p, q) => {
    if (q?.types === 'artists') return { status: 200, data: { results: { artists: { data: [{ id: 'a1', type: 'artists', attributes: { name: '歌手', artwork: { url: 'https://x/{w}x{h}bb.{f}' }, editorialNotes: { short: '简介' }, musicUserToken: 'USER-TOKEN-SECRET' } }] } } } };
    if (q?.types === 'albums') return { status: 200, data: { results: { albums: { data: [{ id: 'al1', type: 'albums', attributes: { name: '专辑', releaseDate: '2020-01-01', trackCount: 10 } }] } } } };
    return { status: 200, data: { data: [{ id: 'al1', type: 'albums', attributes: { name: '专辑', releaseDate: '2020-01-01', editorialNotes: { standard: '说明' } }, relationships: { tracks: { data: [{ id: 's1', type: 'songs', attributes: { name: '歌1', durationInMillis: 180000, developerToken: 'DEV-TOKEN-SECRET' } }] } } }] } };
  };
  const rAr = await engine.call({ path: '/v1/catalog/cn/search', query: { term: 'x', types: 'artists' } });
  assert.equal(rAr.data[0].id, 'a1'); assert.equal(rAr.data[0].attributes.editorialNotes.short, '简介');
  const rAl = await engine.call({ path: '/v1/catalog/cn/search', query: { term: 'x', types: 'albums' } });
  assert.equal(rAl.data[0].attributes.releaseDate, '2020-01-01');
  const rDet = await engine.call({ path: '/v1/catalog/cn/albums/al1' });
  assert.equal(rDet.data[0].relationships.tracks.data[0].attributes.name, '歌1');
  assert.ok(!/SECRET|developerToken|musicUserToken/i.test(JSON.stringify([rAr, rAl, rDet])));
});

say(`Apple Music 页面引擎回归 ${passed}/${passed}`);
