import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
// YouTube Music 适配器 / 登录回归：假传输层，不联网（所有 ID、令牌、设备码都是合成的）。依赖 pnpm build:main 产物。
const require = createRequire(import.meta.url);
const api = require('../dist-main/index.cjs');
const {
  CookieStore, HttpClient, YtmusicAdapter, YtmusicClient, YtmusicLogin, YtmusicAuthExpired, revokeYtmusicToken,
  extractYtmusicClientIdentity, extractYtmusicScriptUrl, parseYtmusicAccount, parseYtmusicDuration, cleanYtmusicTitle,
  mapYtmusicTrack, mapYtmusicPlaylistTile, resolveAdapterByUrl, coverCandidates, registerIpcHandlers,
  YTMUSIC_RENEW_AFTER_MS, YTMUSIC_MAX_PAGES, YTMUSIC_AUTH_EXPIRED,
} = api;

// 收集全部日志：最后断言里面没有令牌 / 设备码 / 客户端身份
const logs = [];
for (const k of ['log', 'info', 'warn', 'error', 'debug']) console[k] = (...a) => logs.push(a.map(String).join(' '));
const say = (s) => process.stdout.write(s + '\n');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ytmusic-regression-'));
let seq = 0;
const newStore = () => new CookieStore(path.join(tmp, `c${++seq}.json`));
let passed = 0;
async function test(name, fn) { await fn(); passed++; say('通过 ' + name); }

/** 合成的敏感值：测试结束时断言它们都没出现在日志里。 */
const SECRETS = {
  clientId: 'FAKE-CLIENT-ID.apps.googleusercontent.com', clientSecret: 'FAKE-CLIENT-SECRET-XYZ',
  deviceCode: 'DEVCODE-SECRET-1', access: 'acc-dev-SECRET', refresh: 'ref-dev-SECRET',
};
const TV_HTML = '<html><head><script id="base-js" src="/s/_/ytlr/_/js/k=ytlr.base.en_US.fake/m=base/rs=FAKE" nonce="n"></script></head></html>';
const SCRIPT_PATH = '/s/_/ytlr/_/js/k=ytlr.base.en_US.fake/m=base/rs=FAKE';
const SCRIPT_TEXT = `var x=function(){};var cfg={clientId:"${SECRETS.clientId}",mobileId:"${SECRETS.clientSecret}"};`;

/* ---------- 合成响应（结构仿照真实样本，内容全是编的） ---------- */
const vid = (i) => `vid${String(i).padStart(8, '0')}`;
const videoTile = (i, { title = `歌${i}`, channel = '歌手甲', dur = '3:45', thumbs } = {}) => ({
  tileRenderer: {
    style: 'TILE_STYLE_YTLR_VERTICAL_LIST',
    header: { tileHeaderRenderer: {
      thumbnail: { thumbnails: thumbs ?? [{ url: `https://i.ytimg.com/vi/${vid(i)}/hqdefault.jpg`, width: 480, height: 360 }] },
      thumbnailOverlays: [{ thumbnailOverlayTimeStatusRenderer: { text: { accessibility: { accessibilityData: { label: '时长' } }, simpleText: dur }, style: 'DEFAULT' } }],
    } },
    metadata: { tileMetadataRenderer: {
      title: { simpleText: title },
      lines: [
        { lineRenderer: { items: [{ lineItemRenderer: { text: { runs: [{ text: channel }] } } }] } },
        { lineRenderer: { items: [{ lineItemRenderer: { text: { simpleText: '1万次观看' } } }] } },
      ],
    } },
    onSelectCommand: { watchEndpoint: { videoId: vid(i), playlistId: 'PLtest' } },
    contentId: vid(i),
    contentType: 'TILE_CONTENT_TYPE_VIDEO',
  },
});
const playlistPage = (name, tiles, token) => ({
  contents: { tvBrowseRenderer: { content: { tvSurfaceContentRenderer: { content: { twoColumnRenderer: {
    leftColumn: { entityMetadataRenderer: { title: { simpleText: name } } },
    rightColumn: { playlistVideoListRenderer: { contents: tiles, continuations: token ? [{ nextContinuationData: { continuation: token } }] : undefined, playlistId: 'PLtest' } },
  } } } } } },
});
const continuationPage = (tiles, token) => ({
  continuationContents: { playlistVideoListContinuation: { contents: tiles, continuations: token ? [{ nextContinuationData: { continuation: token } }] : undefined } },
});
/** YouTube 资料库里的歌单磁贴：标题 simpleText，数量在缩略图覆盖层（「188」「 个视频」）。 */
const aggTile = (id, name, count) => ({
  tileRenderer: {
    header: { tileHeaderRenderer: {
      thumbnail: { thumbnails: [{ url: `https://i.ytimg.com/vi/${id}-small/hqdefault.jpg`, width: 320, height: 180 }, { url: `https://i.ytimg.com/vi/${id}-big/hqdefault.jpg`, width: 640, height: 360 }] },
      thumbnailOverlays: [{ thumbnailOverlayTimeStatusRenderer: { text: { runs: [{ text: String(count), bold: true }, { text: ' 个视频' }] }, icon: { iconType: 'PLAYLISTS' } } }],
    } },
    metadata: { tileMetadataRenderer: { title: { simpleText: name }, lines: [{ lineRenderer: { items: [{ lineItemRenderer: { text: { simpleText: '私享' } } }] } }] } },
    onSelectCommand: { browseEndpoint: { browseId: 'VL' + id } },
    contentId: id,
    contentType: 'TILE_CONTENT_TYPE_PLAYLIST',
  },
});
/** YouTube Music 资料库里的歌单磁贴：标题是 runs，数量在行文字里（「播放列表 • 4 首曲目」）；contentId 是个视频 ID，不能当歌单 ID。 */
const musicTile = (id, name, line) => ({
  tileRenderer: {
    header: { tileHeaderRenderer: { thumbnail: { thumbnails: [
      { url: `https://yt3.googleusercontent.com/${id}=s192`, width: 192, height: 192 },
      { url: `https://yt3.googleusercontent.com/${id}=s576`, width: 576, height: 576 },
    ] } } },
    metadata: { tileMetadataRenderer: {
      title: { runs: [{ text: name, navigationEndpoint: { browseEndpoint: { browseId: 'VL' + id } } }] },
      lines: [
        { lineRenderer: { items: [{ lineItemRenderer: { text: { simpleText: '测试用户' } } }] } },
        { lineRenderer: { items: [{ lineItemRenderer: { text: { simpleText: line } } }] } },
      ],
    } },
    onSelectCommand: { browseEndpoint: { browseId: 'VL' + id } },
    contentId: 'someVideoId',
    contentType: 'TILE_CONTENT_TYPE_PLAYLIST',
  },
});
const aggPage = (items, token) => ({ contents: { tvBrowseRenderer: { content: { tvSurfaceContentRenderer: { content: { gridRenderer: {
  items, continuations: token ? [{ nextContinuationData: { continuation: token } }] : undefined,
} } } } } } });
const aggContinuation = (items) => ({ continuationContents: { tvSurfaceContentContinuation: { content: { gridRenderer: { items } } } } });
const musicPage = (items) => ({ contents: { tvBrowseRenderer: { content: { tvSecondaryNavRenderer: { sections: [{ tvSecondaryNavSectionRenderer: { tabs: [
  { tabRenderer: { title: '近期活动', content: { tvSurfaceContentRenderer: { continuation: { reloadContinuationData: { continuation: 'reload-token' } } } } } },
  { tabRenderer: { title: '播放列表', selected: true, content: { tvSurfaceContentRenderer: { content: { gridRenderer: { items } } } } } },
] } }] } } } } });
const accountsList = (name = '测试用户', premium = false) => ({ contents: [{ accountSectionListRenderer: { contents: [{ accountItemSectionRenderer: { contents: [{ accountItem: {
  accountName: { simpleText: name },
  accountPhoto: { thumbnails: [{ url: 'https://yt3.ggpht.com/small', width: 48, height: 48 }, { url: 'https://yt3.ggpht.com/large', width: 216, height: 216 }] },
  isSelected: true, channelHandle: { simpleText: '@test-handle' }, shouldShowPremiumLogo: premium,
} }] } }] } }] });

/**
 * 假 YouTube：电视端页面 / 脚本 / 设备码 / 令牌 / youtubei / 撤销。
 * valid = 当前有效的访问令牌；h 里的函数可以覆盖默认行为。
 */
function server(h = {}) {
  const s = {
    valid: new Set(), calls: [], count: { tv: 0, script: 0, device: 0, deviceToken: 0, refresh: 0, browse: 0, accounts: 0, revoke: 0 }, gen: 0,
    deviceReply: { error: 'authorization_pending', error_description: 'Precondition Required' },
    refreshReply: null, browse: null, authSeen: [],
  };
  const res = (status, data) => ({ status, text: typeof data === 'string' ? data : JSON.stringify(data) });
  s.transport = async (req) => {
    s.calls.push(req);
    const u = new URL(req.url);
    const body = req.body && /json/.test(req.headers['Content-Type'] || '') ? JSON.parse(req.body) : null;
    if (u.pathname === '/tv') { s.count.tv++; return h.tv ? h.tv() : res(200, TV_HTML); }
    if (u.pathname === SCRIPT_PATH) { s.count.script++; return h.script ? h.script() : res(200, SCRIPT_TEXT); }
    if (u.pathname === '/o/oauth2/device/code') {
      s.count.device++; s.deviceBody = body;
      return res(200, { device_code: SECRETS.deviceCode, user_code: 'ABC-DEF-GHI', expires_in: 1800, interval: 5, verification_url: 'https://www.google.com/device' });
    }
    if (u.pathname === '/o/oauth2/token') {
      s.tokenBody = body;
      if (body.grant_type === 'refresh_token') {
        s.count.refresh++;
        await new Promise((r) => setTimeout(r, 15));
        if (s.refreshReply) return s.refreshReply(body);
        const access = `access-${++s.gen}`;
        s.valid.add(access);
        return res(200, { access_token: access, expires_in: 83000, scope: 'x', token_type: 'Bearer' });
      }
      s.count.deviceToken++;
      s.lastDeviceCode = body.code;
      const r = s.deviceReply;
      if (r.access_token) s.valid.add(r.access_token);
      return res(200, r);
    }
    if (u.hostname === 'oauth2.googleapis.com') { s.count.revoke++; return res(200, {}); }
    if (u.pathname.startsWith('/youtubei/v1/')) {
      const endpoint = u.pathname.slice('/youtubei/v1/'.length);
      const auth = req.headers.Authorization;
      s.authSeen.push({ endpoint, auth });
      if (endpoint === 'browse') s.count.browse++; else s.count.accounts++;
      s.lastContext = body.context;
      s.lastHeaders = req.headers;
      if (auth && !s.valid.has(auth.replace(/^Bearer /, ''))) return res(401, { error: { code: 401, message: 'Request had invalid authentication credentials.' } });
      if (endpoint === 'account/accounts_list') {
        if (!auth) return res(401, { error: { code: 401 } });
        return res(200, h.accounts ? h.accounts() : accountsList());
      }
      const out = (s.browse ?? h.browse)?.(body, auth);
      return out ? res(out.status ?? 200, out.data) : res(404, {});
    }
    throw new Error('未预期的请求 ' + req.url);
  };
  return s;
}
const SAVED = (store, access = 'acc-old', refresh = 'ref-1', nick = '昵称') => store.set('ytmusic', access, refresh, nick);
const mk = (store, srv) => {
  const adapter = new YtmusicAdapter({}, store, srv.transport);
  return { adapter, client: adapter.client };
};

/* ================= 客户端身份 ================= */

await test('客户端身份：从电视端页面找脚本地址、从脚本里正则取出，进程内缓存且并发只取一次', async () => {
  assert.equal(extractYtmusicScriptUrl(TV_HTML), 'https://www.youtube.com' + SCRIPT_PATH);
  assert.equal(extractYtmusicScriptUrl('<script id="base-js"   src="https://www.youtube.com/s/a.js"></script>'), 'https://www.youtube.com/s/a.js');
  assert.equal(extractYtmusicScriptUrl('<script src="/a.js" id="base-js"></script>'), null);
  assert.equal(extractYtmusicScriptUrl('<script id="base-js" src="https://evil.example/a.js"></script>'), null);
  assert.equal(extractYtmusicScriptUrl('<script id="base-js" src="http://www.youtube.com/a.js"></script>'), null);
  assert.deepEqual(extractYtmusicClientIdentity('x={clientId:"AAA",secretKey:"BBB"}'), { clientId: 'AAA', clientSecret: 'BBB' });
  assert.equal(extractYtmusicClientIdentity('x={clientName:"AAA"}'), null);
  const srv = server();
  const client = new YtmusicClient(newStore(), srv.transport);
  const [a, b] = await Promise.all([client.identity(), client.identity()]);
  assert.deepEqual(a, { clientId: SECRETS.clientId, clientSecret: SECRETS.clientSecret });
  assert.equal(a, b);
  await client.identity();
  assert.deepEqual([srv.count.tv, srv.count.script], [1, 1]);
  const tv = srv.calls[0];
  assert.equal(tv.headers['User-Agent'], 'Mozilla/5.0 (ChromiumStylePlatform) Cobalt/Version');
  assert.equal(tv.headers.Referer, 'https://www.youtube.com/tv');
});

await test('客户端身份取不到：明确的中文错误，不缓存（下次重试），错误里不带任何身份', async () => {
  const cases = [
    [{ tv: () => ({ status: 200, text: '<html></html>' }) }, /找不到客户端脚本/],
    [{ tv: () => ({ status: 500, text: '' }) }, /HTTP 500/],
    [{ tv: () => ({ status: 200, text: '<script id="base-js" src="https://evil.example/a.js"></script>' }) }, /找不到客户端脚本/],
    [{ script: () => ({ status: 200, text: 'var nothing=1;' }) }, /找不到客户端身份/],
    [{ script: () => ({ status: 404, text: '' }) }, /HTTP 404/],
    [{ tv: () => { throw new Error('socket hang up'); } }, /连不上 YouTube/],
  ];
  for (const [h, re] of cases) {
    const srv = server(h);
    const client = new YtmusicClient(newStore(), srv.transport);
    await assert.rejects(client.identity(), (e) => re.test(e.message) && !e.message.includes(SECRETS.clientSecret));
    await assert.rejects(client.identity(), re);
    assert.ok(srv.count.tv + srv.count.script >= 2, '失败后不缓存，应重试');
  }
});

/* ================= 设备码登录 ================= */

await test('设备码：createQr 返回登录代码，请求参数对，设备码不下发前端', async () => {
  const store = newStore(), srv = server();
  const { client } = mk(store, srv);
  const login = new YtmusicLogin(store, client);
  const r = await login.createQr();
  assert.equal(r.userCode, 'ABC-DEF-GHI');
  assert.equal(r.verificationUrl, 'https://www.google.com/device');
  assert.equal(r.payload, 'https://www.google.com/device');
  assert.equal(r.expiresIn, 1800);
  assert.equal(r.interval, 5);
  assert.match(r.unikey, /^[0-9a-f-]{36}$/);
  assert.ok(!JSON.stringify(r).includes(SECRETS.deviceCode), '返回对象里不许有 device_code');
  const b = srv.deviceBody;
  assert.equal(b.client_id, SECRETS.clientId);
  assert.equal(b.scope, 'http://gdata.youtube.com https://www.googleapis.com/auth/youtube-paid-content');
  assert.equal(b.device_model, 'ytlr::');
  assert.match(b.device_id, /^[0-9a-f-]{36}$/);
  assert.ok(!('client_secret' in b));
  // 设备码请求失败：明确错误
  const bad = server({});
  const orig = bad.transport;
  bad.transport = async (req) => (req.url.includes('/device/code') ? { status: 403, text: JSON.stringify({ error: 'access_denied' }) } : orig(req));
  await assert.rejects(new YtmusicLogin(newStore(), new YtmusicClient(newStore(), bad.transport)).createQr(), /获取 YouTube 登录代码失败/);
});

await test('设备码轮询：等待 / 太频繁 / 已过期 / 已拒绝 四种状态映射成中文提示，且不下发设备码', async () => {
  const clock = { t: 1_000_000 };
  const store = newStore(), srv = server();
  const { client } = mk(store, srv);
  const login = new YtmusicLogin(store, client, () => clock.t);
  const results = [];
  // pending
  let q = await login.createQr();
  srv.deviceReply = { error: 'authorization_pending' };
  let r = await login.pollLogin(q.unikey); results.push(r);
  assert.deepEqual([r.ok, r.final], [false, undefined]);
  assert.match(r.message, /等待/);
  assert.equal(srv.lastDeviceCode, SECRETS.deviceCode, '主进程拿设备码去换令牌');
  // 轮询比间隔勤：不再去问 Google
  const before = srv.count.deviceToken;
  r = await login.pollLogin(q.unikey);
  assert.equal(srv.count.deviceToken, before);
  assert.match(r.message, /等待/);
  // slow_down：放慢，间隔 +5 秒
  clock.t += 6000;
  srv.deviceReply = { error: 'slow_down' };
  r = await login.pollLogin(q.unikey); results.push(r);
  assert.equal(r.ok, false);
  assert.match(r.message, /太频繁/);
  clock.t += 6000;
  const n = srv.count.deviceToken;
  await login.pollLogin(q.unikey);
  assert.equal(srv.count.deviceToken, n, '放慢后 6 秒内不该再问');
  clock.t += 5000;
  srv.deviceReply = { error: 'authorization_pending' };
  await login.pollLogin(q.unikey);
  assert.equal(srv.count.deviceToken, n + 1);
  // expired_token
  clock.t += 20000;
  srv.deviceReply = { error: 'expired_token' };
  r = await login.pollLogin(q.unikey); results.push(r);
  assert.deepEqual([r.ok, r.final], [false, true]);
  assert.match(r.message, /代码已过期，请重新获取/);
  r = await login.pollLogin(q.unikey);
  assert.equal(r.final, true, '过期后这个代码就没了');
  // access_denied
  q = await login.createQr();
  srv.deviceReply = { error: 'access_denied' };
  r = await login.pollLogin(q.unikey); results.push(r);
  assert.deepEqual([r.ok, r.final], [false, true]);
  assert.match(r.message, /拒绝授权/);
  // 本地到期（expiresIn 过了）
  q = await login.createQr();
  clock.t += 1801 * 1000;
  r = await login.pollLogin(q.unikey);
  assert.match(r.message, /代码已过期/);
  assert.equal((await login.pollLogin('no-such-key')).final, true);
  // 网络异常：当作等待，不判失败
  q = await login.createQr();
  const orig = srv.transport;
  const flaky = new YtmusicClient(store, async (req) => { if (req.url.includes('/oauth2/token')) throw new Error('ETIMEDOUT'); return orig(req); });
  const l2 = new YtmusicLogin(store, flaky, () => clock.t);
  q = await l2.createQr();
  r = await l2.pollLogin(q.unikey);
  assert.equal(r.ok, false); assert.equal(r.final, undefined); assert.match(r.message, /网络波动/);
  assert.ok(!JSON.stringify(results).includes(SECRETS.deviceCode));
});

await test('设备码登录成功：先读 accounts_list 拿昵称，再存令牌（访问令牌 / 续期令牌 / 昵称），不在 Cookie 头里', async () => {
  const clock = { t: 5_000_000 };
  const store = newStore(), srv = server();
  let storedWhenAsked = 'unset';
  const spy = async (req) => { if (req.url.includes('accounts_list')) storedWhenAsked = store.get('ytmusic'); return srv.transport(req); };
  const lg = new YtmusicLogin(store, new YtmusicClient(store, spy), () => clock.t);
  const qq = await lg.createQr();
  srv.deviceReply = { access_token: SECRETS.access, expires_in: 83000, refresh_token: SECRETS.refresh, scope: 'x', token_type: 'Bearer' };
  const r2 = await lg.pollLogin(qq.unikey);
  assert.deepEqual([r2.ok, r2.message, r2.nickname], [true, '登录成功：测试用户', '测试用户']);
  assert.equal(storedWhenAsked, undefined, '读昵称发生在存令牌之前');
  const rec = store.get('ytmusic');
  assert.deepEqual([rec.cookies, rec.token, rec.nickname], [SECRETS.access, SECRETS.refresh, '测试用户']);
  assert.ok(!JSON.stringify(r2).includes(SECRETS.access) && !JSON.stringify(r2).includes(SECRETS.refresh));
  // 落盘后重新读取仍在；磁盘上没有客户端身份和设备码
  const disk = fs.readFileSync(store.filePath, 'utf8');
  assert.equal(new CookieStore(store.filePath).get('ytmusic').token, SECRETS.refresh);
  for (const secret of [SECRETS.clientId, SECRETS.clientSecret, SECRETS.deviceCode]) assert.ok(!disk.includes(secret), '不得落盘: ' + secret.slice(0, 6));
  // accounts_list 读不到昵称不影响登录
  const store2 = newStore(), srv2 = server({ accounts: () => ({}) });
  const lg2 = new YtmusicLogin(store2, new YtmusicClient(store2, srv2.transport));
  const q2 = await lg2.createQr();
  srv2.deviceReply = { access_token: 'acc-x', refresh_token: 'ref-x' };
  const r3 = await lg2.pollLogin(q2.unikey);
  assert.deepEqual([r3.ok, r3.message], [true, '登录成功']);
  assert.equal(store2.get('ytmusic').nickname, undefined);
  // 没给续期令牌：不存
  const store3 = newStore(), srv3 = server();
  const lg3 = new YtmusicLogin(store3, new YtmusicClient(store3, srv3.transport));
  const q3 = await lg3.createQr();
  srv3.deviceReply = { access_token: 'acc-y' };
  assert.equal((await lg3.pollLogin(q3.unikey)).ok, false);
  assert.equal(store3.has('ytmusic'), false);
});

await test('令牌存储：原样保存不做 Cookie 清洗（含 = / + 也不丢），HttpClient 不把它塞进 Cookie 头', async () => {
  const store = newStore();
  store.set('ytmusic', 'ya29.a0Af-xx_y/z+w==', '1//refresh-token_abc', '昵称');
  assert.equal(store.get('ytmusic').cookies, 'ya29.a0Af-xx_y/z+w==');
  assert.equal(new CookieStore(store.filePath).get('ytmusic').token, '1//refresh-token_abc');
  const seen = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init) => { seen.push(init.headers); return new Response('{}', { status: 200 }); };
  try { await new HttpClient(store).requestJson('https://example.test/x', { platform: 'ytmusic' }); } finally { globalThis.fetch = real; }
  const h = Object.fromEntries(Object.entries(seen[0]).map(([k, v]) => [k.toLowerCase(), v]));
  assert.equal(h.cookie, undefined);
  assert.equal(h.authorization, undefined);
});

/* ================= 账号 ================= */

await test('accounts_list 解析：昵称 / 最大头像 / 会员标 / 选中的账号优先', async () => {
  const me = parseYtmusicAccount(accountsList('小明', true));
  assert.deepEqual(me, { nickname: '小明', avatarUrl: 'https://yt3.ggpht.com/large', isVip: true, handle: '@test-handle' });
  const two = { contents: [{ accountSectionListRenderer: { contents: [{ accountItemSectionRenderer: { contents: [
    { accountItem: { accountName: { simpleText: '甲' }, isSelected: false } },
    { accountItem: { accountName: { runs: [{ text: '乙' }] }, isSelected: true, accountPhoto: { thumbnails: [{ url: '//yt3.ggpht.com/p', width: 10, height: 10 }] } } },
  ] } }] } }] };
  assert.deepEqual([parseYtmusicAccount(two).nickname, parseYtmusicAccount(two).avatarUrl, parseYtmusicAccount(two).isVip], ['乙', 'https://yt3.ggpht.com/p', false]);
  assert.equal(parseYtmusicAccount({}), null);
  // getAccount 走完整链路
  const store = newStore(), srv = server();
  SAVED(store); srv.valid.add('acc-old');
  const { client } = mk(store, srv);
  const acc = await new YtmusicLogin(store, client).getAccount();
  assert.deepEqual(
    [acc.loggedIn, acc.authStatus, acc.nickname, acc.avatarUrl, acc.isVip, acc.isSvip, acc.userId],
    [true, 'valid', '测试用户', 'https://yt3.ggpht.com/large', false, false, '@test-handle'],
  );
  // 未登录
  assert.equal(await new YtmusicLogin(newStore(), client).getAccount(), null);
  // 请求格式
  assert.equal(srv.lastHeaders['X-Youtube-Client-Name'], '7');
  assert.equal(srv.lastHeaders['X-Youtube-Client-Version'], '7.20260311.12.00');
  assert.equal(srv.lastHeaders.Authorization, 'Bearer acc-old');
  assert.deepEqual(srv.lastContext.client, { clientName: 'TVHTML5', clientVersion: '7.20260311.12.00', hl: 'zh-CN', gl: 'US' });
  assert.ok(srv.calls.at(-1).url.endsWith('/youtubei/v1/account/accounts_list?prettyPrint=false'));
});

await test('账号状态：网络异常不判登出（unknown，保留昵称）', async () => {
  const store = newStore(), srv = server();
  SAVED(store); srv.valid.add('acc-old');
  const client = new YtmusicClient(store, async (req) => { if (req.url.includes('/youtubei/')) throw new Error('ENOTFOUND'); return srv.transport(req); });
  const acc = await new YtmusicLogin(store, client).getAccount();
  assert.deepEqual([acc.loggedIn, acc.authStatus, acc.nickname], [true, 'unknown', '昵称']);
  const http500 = new YtmusicClient(store, async (req) => (req.url.includes('/youtubei/') ? { status: 503, text: '' } : srv.transport(req)));
  const acc2 = await new YtmusicLogin(store, http500).getAccount();
  assert.deepEqual([acc2.loggedIn, acc2.authStatus], [true, 'unknown']);
});

/* ================= 续期 ================= */

await test('续期单飞：三个并发请求都遇 401，只续一次，都拿到结果，新令牌写回、续期令牌与昵称不变', async () => {
  const store = newStore(), srv = server();
  SAVED(store);
  const { client } = mk(store, srv);
  const results = await Promise.all([client.accountInfo(), client.accountInfo(), client.accountInfo()]);
  assert.ok(results.every((r) => r?.nickname === '测试用户'));
  assert.equal(srv.count.refresh, 1);
  assert.equal(store.get('ytmusic').cookies, 'access-1');
  assert.equal(store.get('ytmusic').token, 'ref-1');
  assert.equal(store.get('ytmusic').nickname, '昵称');
  assert.equal(srv.tokenBody.grant_type, 'refresh_token');
  assert.equal(srv.tokenBody.refresh_token, 'ref-1');
  assert.equal(srv.tokenBody.client_id, SECRETS.clientId);
  assert.equal(srv.tokenBody.client_secret, SECRETS.clientSecret);
  // 迟到的、还带着旧令牌的请求吃到 401：发现令牌已被别人续过，直接用新的重试，不再续
  const late = await client.call('account/accounts_list', {});
  assert.ok(late);
  assert.equal(srv.count.refresh, 1);
});

await test('令牌写入超过 50 分钟：请求前先续，不先吃一次 401', async () => {
  const store = newStore(), srv = server();
  SAVED(store); srv.valid.add('acc-old');
  store.get('ytmusic').updatedAt = Date.now() - YTMUSIC_RENEW_AFTER_MS - 1000;
  const { client } = mk(store, srv);
  const me = await client.accountInfo();
  assert.equal(me.nickname, '测试用户');
  assert.equal(srv.count.refresh, 1);
  assert.equal(srv.count.accounts, 1, '只发了一次业务请求');
  assert.equal(srv.authSeen[0].auth, 'Bearer access-1');
  // 没到 50 分钟不提前续
  const store2 = newStore(), srv2 = server();
  SAVED(store2); srv2.valid.add('acc-old');
  await mk(store2, srv2).client.accountInfo();
  assert.equal(srv2.count.refresh, 0);
});

await test('续期令牌被拒（invalid_grant）：登录已过期，令牌不被改写，之后不再反复续期；公开歌单仍可匿名读', async () => {
  const store = newStore(), srv = server();
  SAVED(store);
  srv.refreshReply = () => ({ status: 400, text: JSON.stringify({ error: 'invalid_grant', error_description: 'Bad Request' }) });
  srv.browse = (body) => (body.browseId === 'VLPLpublic' ? { data: playlistPage('公开歌单', [videoTile(1)]) } : null);
  const { adapter, client } = mk(store, srv);
  const login = new YtmusicLogin(store, client);
  const acc = await login.getAccount();
  assert.deepEqual([acc.loggedIn, acc.authStatus, acc.error], [false, 'expired', 'YouTube Music 登录已过期，请重新登录']);
  assert.equal(YTMUSIC_AUTH_EXPIRED, acc.error);
  assert.deepEqual([store.get('ytmusic').cookies, store.get('ytmusic').token], ['acc-old', 'ref-1']);
  assert.equal(client.authState(), 'expired');
  const refreshes = srv.count.refresh;
  assert.deepEqual(await adapter.fetchMyPlaylists(), []);
  assert.equal((await login.getAccount()).authStatus, 'expired');
  assert.equal(srv.count.refresh, refreshes, '已确认失效就不再去续');
  // 公开歌单：退回匿名读；私人的「赞过的视频」：报登录过期
  const pl = await adapter.fetchPlaylist('PLpublic');
  assert.equal(pl.tracks.length, 1);
  assert.equal(srv.authSeen.at(-1).auth, undefined);
  await assert.rejects(adapter.fetchPlaylist('LL'), (e) => e instanceof YtmusicAuthExpired);
  // 换了新登录就不再算过期
  SAVED(store, 'acc-new', 'ref-2');
  assert.equal(client.authState(), 'valid');
});

await test('续期成功但新令牌仍 401：判登录已过期', async () => {
  const store = newStore(), srv = server();
  SAVED(store);
  srv.refreshReply = () => ({ status: 200, text: JSON.stringify({ access_token: 'access-not-accepted', expires_in: 83000 }) });
  const { client } = mk(store, srv);
  const acc = await new YtmusicLogin(store, client).getAccount();
  assert.deepEqual([acc.loggedIn, acc.authStatus], [false, 'expired']);
});

await test('续期期间登录变了（退出 / 换号）：旧结果丢弃，不写回', async () => {
  const store = newStore(), srv = server();
  SAVED(store);
  const { client } = mk(store, srv);
  const pending = client.accountInfo();
  setTimeout(() => store.clear('ytmusic'), 5);
  await pending.catch(() => {});
  assert.equal(store.has('ytmusic'), false);
});

/* ================= 歌单 ================= */

await test('我的歌单：合并两处资料库去重，「赞过的视频」第一并改名，跳过 稍后观看 / 赞过的音乐 / RD 合辑；翻页没有新 ID 就停', async () => {
  const store = newStore(), srv = server();
  SAVED(store); srv.valid.add('acc-old');
  const aggItems = [aggTile('WL', '稍后观看', 62), aggTile('PLaaa', '歌单甲', 4), aggTile('LL', '赞过的视频', 188), aggTile('RDxyz', '合辑 - 某某', 0), aggTile('PLbbb', '歌单乙', 2)];
  srv.browse = (body) => {
    if (body.browseId === 'FEplaylist_aggregation') return { data: aggPage(aggItems, 'agg-token-2') };
    if (body.continuation === 'agg-token-2') return { data: aggContinuation(aggItems) }; // 翻页返回的是同一批
    if (body.browseId === 'FEmusic_liked_playlists') {
      return { data: musicPage([musicTile('LM', '赞过的音乐', '自动播放列表 • 测试用户 • 5 首歌曲'), musicTile('PLbbb', '歌单乙', '播放列表 • 2 首曲目'), musicTile('PLccc', '音乐库歌单', '播放列表 • 1,204 首曲目'), musicTile('PLddd', '没数量的', '公开')]) };
    }
    return null;
  };
  const { adapter } = mk(store, srv);
  const list = await adapter.fetchMyPlaylists();
  assert.deepEqual(list.map((p) => p.id), ['LL', 'PLaaa', 'PLbbb', 'PLccc', 'PLddd']);
  assert.equal(list[0].name, '赞过的视频');
  assert.equal(list[0].trackCount, 188);
  assert.deepEqual([list[1].name, list[1].trackCount, list[1].cover], ['歌单甲', 4, 'https://i.ytimg.com/vi/PLaaa-big/hqdefault.jpg']);
  assert.deepEqual([list[2].name, list[2].trackCount], ['歌单乙', 2]);
  assert.deepEqual([list[3].name, list[3].trackCount, list[3].cover], ['音乐库歌单', 1204, 'https://yt3.googleusercontent.com/PLccc=s576']);
  assert.deepEqual([list[4].name, list[4].trackCount], ['没数量的', 0]);
  const browses = srv.calls.filter((c) => c.url.includes('/browse')).map((c) => JSON.parse(c.body));
  assert.equal(browses.filter((b) => b.continuation).length, 1, '翻页一次发现没有新 ID 就停');
  // 单边失败时另一边照常；都不可用返回 []
  srv.browse = (body) => (body.browseId === 'FEmusic_liked_playlists' ? { data: musicPage([musicTile('PLccc', '音乐库歌单', '播放列表 • 3 首曲目')]) } : { status: 500, data: {} });
  assert.deepEqual((await adapter.fetchMyPlaylists()).map((p) => p.id), ['PLccc']);
  srv.browse = () => ({ status: 500, data: {} });
  assert.deepEqual(await adapter.fetchMyPlaylists(), []);
  // 未登录没有资料库
  assert.deepEqual(await new YtmusicAdapter({}, newStore(), srv.transport).fetchMyPlaylists(), []);
  // 磁贴解析
  assert.equal(mapYtmusicPlaylistTile(videoTile(1).tileRenderer), null);
  assert.equal(mapYtmusicPlaylistTile({ ...aggTile('PLx', 'x', 1).tileRenderer, onSelectCommand: {} }), null);
});

await test('歌单内容：标题、曲目、翻页（continuation）；没有新 ID 的一页丢弃并停；到上限停', async () => {
  const store = newStore(), srv = server();
  SAVED(store); srv.valid.add('acc-old');
  const page = (n, size = 2) => Array.from({ length: size }, (_, k) => videoTile(n * 10 + k, { title: `歌${n}-${k}` }));
  srv.browse = (body) => {
    if (body.browseId === 'VLPLtwo') return { data: playlistPage('两页歌单', page(1), 'tok2') };
    if (body.continuation === 'tok2') return { data: continuationPage(page(2), 'tok3') };
    if (body.continuation === 'tok3') return { data: continuationPage(page(2), 'tok4') }; // 重复的一页：没有新 ID
    if (body.browseId === 'VLPLone') return { data: playlistPage('一页歌单', page(1)) };
    if (body.browseId === 'VLPLendless') return { data: playlistPage('停不下来', page(0), 'e1') };
    if (String(body.continuation || '').startsWith('e')) { const n = Number(body.continuation.slice(1)) + 1; return { data: continuationPage(page(n), 'e' + n) }; }
    if (body.browseId === 'VLPLempty') return { data: playlistPage('空', []) };
    if (body.browseId === 'VLPLnone') return { status: 404, data: {} };
    return null;
  };
  const { adapter } = mk(store, srv);
  const two = await adapter.fetchPlaylist('PLtwo');
  assert.deepEqual([two.id, two.platform, two.name, two.tracks.length], ['PLtwo', 'ytmusic', '两页歌单', 4]);
  assert.deepEqual(two.tracks.map((t) => t.title), ['歌1-0', '歌1-1', '歌2-0', '歌2-1']);
  assert.equal(two.cover, two.tracks[0].cover);
  assert.equal(srv.calls.filter((c) => c.url.includes('/browse') && JSON.parse(c.body).continuation).length, 2);
  assert.equal((await adapter.fetchPlaylist('PLone')).tracks.length, 2);
  // 上限
  const before = srv.count.browse;
  const endless = await adapter.fetchPlaylist('PLendless');
  assert.equal(srv.count.browse - before, YTMUSIC_MAX_PAGES);
  assert.equal(endless.tracks.length, YTMUSIC_MAX_PAGES * 2);
  // 空 / 不存在：明确错误
  await assert.rejects(adapter.fetchPlaylist('PLempty'), /为空、不存在或未公开/);
  await assert.rejects(adapter.fetchPlaylist('PLnone'), /不存在或未公开/);
  await assert.rejects(adapter.fetchPlaylist('bad id!'), /不合法/);
  // 没有标题时的兜底名
  srv.browse = (body) => (body.browseId === 'VLPLnoname' ? { data: { contents: playlistPage('x', [videoTile(5)]).contents && { tvBrowseRenderer: { content: { tvSurfaceContentRenderer: { content: { twoColumnRenderer: { rightColumn: { playlistVideoListRenderer: { contents: [videoTile(5)] } } } } } } } } } } : null);
  assert.equal((await adapter.fetchPlaylist('PLnoname')).name, 'YouTube 歌单 PLnoname');
  // 第一首封面
  srv.browse = (body) => (body.browseId === 'VLPLcover' ? { data: playlistPage('封面', [videoTile(7)]) } : null);
  assert.equal(await adapter.fetchPlaylistFirstCover('PLcover'), `https://i.ytimg.com/vi/${vid(7)}/hqdefault.jpg`);
  assert.equal(await adapter.fetchPlaylistFirstCover('WL'), '');
});

await test('「赞过的视频」（LL）：登录后可读；稍后观看 / 赞过的音乐 / RD 合辑 / 未登录的 LL 一律明确报错', async () => {
  const store = newStore(), srv = server();
  srv.browse = (body) => (body.browseId === 'VLLL' ? { data: playlistPage('赞过的视频', [videoTile(1)]) } : null);
  const { adapter } = mk(store, srv);
  await assert.rejects(adapter.fetchPlaylist('LL'), /请先登录/);
  for (const [id, re] of [['WL', /稍后观看/], ['LM', /赞过的音乐/], ['RDabc123', /合辑/], ['RDCLAK5uy_x', /合辑/]]) {
    await assert.rejects(adapter.fetchPlaylist(id), re);
  }
  assert.equal(srv.count.browse, 0, '这些 ID 不会发请求');
  SAVED(store); srv.valid.add('acc-old');
  const ll = await adapter.fetchPlaylist('LL');
  assert.deepEqual([ll.name, ll.tracks.length], ['赞过的视频', 1]);
  assert.equal(srv.authSeen.at(-1).auth, 'Bearer acc-old');
  // 混在里面的播客 / 实况（超过 15 分钟）不收；普通歌单不过滤；同页重复的 videoId 只收一次
  srv.browse = (body) => ({ data: playlistPage('x', [videoTile(1), videoTile(2, { dur: '15:01' }), videoTile(3, { dur: '1:02:03' }), videoTile(4, { dur: '15:00' }), videoTile(1)]) });
  assert.deepEqual((await adapter.fetchPlaylist('LL')).tracks.map((t) => t.sourceId), [vid(1), vid(4)]);
  assert.equal((await adapter.fetchPlaylist('PLmine')).tracks.length, 4);
});

await test('匿名读公开歌单：未登录时不带 Authorization', async () => {
  const store = newStore(), srv = server();
  srv.browse = (body) => (body.browseId === 'VLPLpublic' ? { data: playlistPage('热门音乐视频', [videoTile(1), videoTile(2)]) } : null);
  const { adapter } = mk(store, srv);
  const pl = await adapter.fetchPlaylist('PLpublic');
  assert.deepEqual([pl.name, pl.tracks.length], ['热门音乐视频', 2]);
  assert.ok(srv.calls.filter((c) => c.url.includes('/browse')).every((c) => !('Authorization' in c.headers)));
  assert.equal(srv.count.refresh, 0);
});

/* ================= 曲目映射 ================= */

await test('曲目映射：Topic 去尾、「歌手 - 歌名」拆分、噪音去除、时长解析、封面', async () => {
  const map = (title, channel, extra) => mapYtmusicTrack(videoTile(1, { title, channel, ...extra }).tileRenderer);
  let t = map('Song Name', '某歌手 - Topic');
  assert.deepEqual([t.title, t.artist, t.artists], ['Song Name', '某歌手', ['某歌手']]);
  t = map('Band - Song (Official Video)', 'Band');
  assert.deepEqual([t.title, t.artist], ['Song', 'Band']);
  t = map('Other Artist - Hit (Official Music Video) ft. X', 'Some VEVO');
  assert.deepEqual([t.title, t.artist], ['Hit ft. X', 'Other Artist']);
  t = map('BELLAKEO (Video Oficial) - Peso Pluma, Anitta', 'Peso Pluma'); // 频道名出现在右边：倒过来
  assert.deepEqual([t.title, t.artist], ['BELLAKEO', 'Peso Pluma, Anitta']);
  t = map('Plain Title Without Dash', 'Some Channel');
  assert.deepEqual([t.title, t.artist], ['Plain Title Without Dash', 'Some Channel']);
  t = map('Topic 频道里的 A - B 不拆', '甲 - Topic');
  assert.deepEqual([t.title, t.artist], ['Topic 频道里的 A - B 不拆', '甲']);
  // 噪音
  for (const [raw, want] of [
    ['歌 (Official Audio)', '歌'], ['Song [Lyric Video]', 'Song'], ['Song (MV)', 'Song'], ['歌名【官方MV】', '歌名'], ['Song (Lyrics)', 'Song'],
    ['Song | Official Video', 'Song'], ['Song (Official HD Video)', 'Song'], ['Song 【MV】', 'Song'], ['Song (Official Visualizer)', 'Song'],
    ['Song (Live at Budokan)', 'Song (Live at Budokan)'], ['Song (Remix)', 'Song (Remix)'], ['The Way I Loved You (Taylor’s Version)', 'The Way I Loved You (Taylor’s Version)'],
    ['【組曲】花譜「あさひ」【オリジナルMV】', '【組曲】花譜「あさひ」'], ['(Official Video)', '(Official Video)'],
  ]) assert.equal(cleanYtmusicTitle(raw), want, raw);
  // 时长
  for (const [s, sec] of [['3:45', 225], ['1:02:03', 3723], ['2:57:13', 10633], ['0:59', 59], ['', 0], ['直播', 0], ['LIVE', 0]]) assert.equal(parseYtmusicDuration(s), sec, s);
  t = map('歌', '歌手', { dur: '4:50' });
  assert.equal(t.duration, 290);
  // 封面取最大、字段齐全
  t = map('歌', '歌手', { thumbs: [{ url: 'https://i.ytimg.com/vi/a/default.jpg', width: 120, height: 90 }, { url: 'https://i.ytimg.com/vi/a/hqdefault.jpg?sqp=x', width: 480, height: 360 }] });
  assert.equal(t.cover, 'https://i.ytimg.com/vi/a/hqdefault.jpg?sqp=x');
  assert.deepEqual([t.id, t.sourceId, t.platform, t.album, t.originalUrl], [`ytmusic:${vid(1)}`, vid(1), 'ytmusic', '', '']);
  // 不是视频 / 没有 ID / 没标题
  assert.equal(mapYtmusicTrack({ ...videoTile(1).tileRenderer, contentType: 'TILE_CONTENT_TYPE_PLAYLIST' }), null);
  assert.equal(mapYtmusicTrack({ ...videoTile(1).tileRenderer, onSelectCommand: {}, contentId: undefined }), null);
  assert.equal(mapYtmusicTrack(videoTile(1, { title: '' }).tileRenderer), null);
  // 没有 watchEndpoint 时退回 contentId
  assert.equal(mapYtmusicTrack({ ...videoTile(3).tileRenderer, onSelectCommand: {} }).sourceId, vid(3));
});

/* ================= 链接 / 封面 / 播放 / 退出 ================= */

await test('链接识别：music / www / m.youtube.com 的歌单链接；无 list 或假域名不认；合辑与私人歌单 ID 解析出来后报明确错误', async () => {
  const ok = (url, id) => assert.deepEqual(resolveAdapterByUrl(url), { platform: 'ytmusic', id }, url);
  ok('https://music.youtube.com/playlist?list=PLabc_123-x', 'PLabc_123-x');
  ok('https://www.youtube.com/playlist?list=PLxyz&si=abc', 'PLxyz');
  ok('https://m.youtube.com/playlist?list=PLmobile', 'PLmobile');
  ok('youtube.com/playlist?list=PLbare', 'PLbare');
  ok('https://www.youtube.com/watch?v=aaaaaaaaaaa&list=PLwatch', 'PLwatch');
  ok('https://youtu.be/aaaaaaaaaaa?list=PLshort', 'PLshort');
  ok('https://music.youtube.com/playlist?list=RDCLAK5uy_abc', 'RDCLAK5uy_abc');
  ok('https://music.youtube.com/playlist?list=LL', 'LL');
  for (const url of ['https://music.youtube.com/watch?v=aaaaaaaaaaa', 'https://www.youtube.com/', 'https://evilyoutube.com/playlist?list=PLx', 'https://youtube.com.evil.example/playlist?list=PLx', 'https://example.com/?u=youtube.com&list=PLx']) {
    assert.equal(resolveAdapterByUrl(url), null, url);
  }
  // 其他平台不受影响
  assert.equal(resolveAdapterByUrl('https://open.spotify.com/playlist/abc').platform, 'spotify');
  assert.equal(resolveAdapterByUrl('https://music.163.com/#/playlist?id=1').platform, 'netease');
  // 经 IPC 导入：合辑 / 稍后观看 / 未登录的 LL 都是明确的中文错误
  const handlers = new Map();
  const srv = server(), store = newStore();
  const adapters = { ytmusic: new YtmusicAdapter({}, store, srv.transport) };
  registerIpcHandlers({ handle: (k, f) => handlers.set(k, f) }, { adapters, cookies: store, resolver: {}, lyricService: {}, login: {}, audioProxy: { urlFor: (u) => u } });
  for (const [url, re] of [['https://music.youtube.com/playlist?list=RDCLAK5uy_abc', /合辑/], ['https://www.youtube.com/playlist?list=WL', /稍后观看/], ['https://www.youtube.com/playlist?list=LL', /请先登录/]]) {
    const r = await handlers.get('nebula:import-playlist')(null, { url });
    assert.equal(r.ok, false, url);
    assert.match(r.error, re);
  }
});

await test('封面：缩略图优先试 maxres / hq 再原地址；头像等其他域名保持原样；ytimg / ggpht / googleusercontent 允许下载', async () => {
  assert.deepEqual(coverCandidates({ platform: 'ytmusic', cover: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg?sqp=abc' }), [
    'https://i.ytimg.com/vi/dQw4w9WgXcQ/maxresdefault.jpg',
    'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
    'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg?sqp=abc',
  ]);
  assert.deepEqual(coverCandidates({ platform: 'ytmusic', cover: 'https://yt3.googleusercontent.com/abc=s576' }), ['https://yt3.googleusercontent.com/abc=s576']);
  assert.deepEqual(coverCandidates({ platform: 'ytmusic', cover: '' }), []);
  // 允许名单：CoverService 只会去取名单里的域名
  const requested = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (url) => { requested.push(String(url)); return new Response(null, { status: 404 }); };
  try {
    for (const cover of ['https://yt3.ggpht.com/a=s88', 'https://yt3.googleusercontent.com/b=s88', 'https://i.ytimg.com/vi/aaaaaaaaaaa/hqdefault.jpg', 'https://evil.example/x.jpg']) {
      await new api.CoverService().inspect({ platform: 'ytmusic', cover });
    }
  } finally { globalThis.fetch = real; }
  assert.ok(requested.some((u) => u.startsWith('https://yt3.ggpht.com/')));
  assert.ok(requested.some((u) => u.startsWith('https://yt3.googleusercontent.com/')));
  assert.ok(requested.some((u) => u.startsWith('https://i.ytimg.com/')));
  assert.ok(!requested.some((u) => u.includes('evil.example')));
});

await test('播放与歌词：第一阶段不取 YouTube 音频，返回 null 走跨平台兜底', async () => {
  const { adapter } = mk(newStore(), server());
  assert.equal(await adapter.fetchSongUrl('aaaaaaaaaaa'), null);
  assert.equal(await adapter.fetchLyric(), null);
  assert.equal(typeof adapter.getAuthStatus, 'undefined', '不挂 getAuthStatus：过期时 SongResolver 会直接拒播，而本平台的曲目本来就靠兜底播放');
  const adapters = api.createAdapters(new HttpClient(newStore()), newStore());
  assert.equal(adapters.ytmusic.platform, 'ytmusic');
});

await test('退出登录：撤销续期令牌（尽力而为，失败忽略），清除前的令牌交给钩子', async () => {
  const seen = [];
  assert.equal(await revokeYtmusicToken('1//ref+x', async (req) => { seen.push(req); return { status: 200, text: '{}' }; }), true);
  assert.equal(seen[0].method, 'POST');
  assert.equal(seen[0].url, 'https://oauth2.googleapis.com/revoke?token=1%2F%2Fref%2Bx');
  assert.equal(await revokeYtmusicToken('x', async () => { throw new Error('offline'); }), false);
  assert.equal(await revokeYtmusicToken('x', async () => ({ status: 400, text: '' })), false);
  assert.equal(await revokeYtmusicToken('', async () => { throw new Error('不该调用'); }), false);
  const store = newStore(), handlers = new Map(), cleared = [];
  SAVED(store, 'acc-1', 'ref-9');
  registerIpcHandlers({ handle: (k, f) => handlers.set(k, f) }, {
    adapters: {}, cookies: store, resolver: {}, lyricService: {}, login: {}, audioProxy: { urlFor: (u) => u },
    onCookieClear: async (platform, previous) => { cleared.push([platform, previous?.token, store.has('ytmusic')]); },
  });
  assert.equal((await handlers.get('nebula:cookie:clear')(null, { platform: 'ytmusic' })).ok, true);
  assert.deepEqual(cleared, [['ytmusic', 'ref-9', false]]);
});

await test('全网搜歌：解析 TVHTML5 lockupViewModel，跳过合辑与超过 15 分钟视频（#322）', async () => {
  const lockup = (id, title, channel, dur, ctype = 'LOCKUP_CONTENT_TYPE_MUSIC') => ({
    lockupViewModel: {
      contentId: id,
      contentType: ctype,
      contentImage: {
        thumbnailViewModel: {
          image: { sources: [{ url: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`, width: 320, height: 180 }] },
          overlays: [{ thumbnailBottomOverlayViewModel: { badges: [{ thumbnailBadgeViewModel: { text: dur } }] } }],
        },
      },
      metadata: {
        lockupMetadataViewModel: {
          title: { content: title },
          metadata: { contentMetadataViewModel: { metadataRows: [{ metadataParts: [{ text: { content: channel } }] }] } },
        },
      },
    },
  });
  const adapter = new YtmusicAdapter({}, newStore(), async (req) => {
    assert.ok(req.url.includes('/youtubei/v1/search'));
    return {
      status: 200,
      text: JSON.stringify({
        contents: {
          sectionListRenderer: {
            contents: [{
              shelfRenderer: {
                content: {
                  horizontalListRenderer: {
                    items: [
                      lockup('ic8j13piAhQ', 'Taylor Swift - Cruel Summer (Official Audio)', 'Taylor Swift', '3:00'),
                      lockup('RDic8j13piAhQ', 'Mix', 'Various', '3:00', 'LOCKUP_CONTENT_TYPE_PLAYLIST'),
                      lockup('longPodcast1', '1 Hour Podcast', 'TalkShow', '45:00'),
                    ],
                  },
                },
              },
            }],
          },
        },
      }),
    };
  });
  const hits = await adapter.searchSongs('Cruel Summer', 5);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].platform, 'ytmusic');
  assert.equal(hits[0].sourceId, 'ic8j13piAhQ');
  assert.equal(hits[0].title, 'Cruel Summer');
  assert.equal(hits[0].artist, 'Taylor Swift');
  assert.equal(hits[0].duration, 180);
});

await test('日志里没有访问令牌 / 续期令牌 / 设备码 / 客户端身份', async () => {
  const text = logs.join('\n');
  for (const [name, secret] of Object.entries(SECRETS)) assert.ok(!text.includes(secret), '日志泄露了 ' + name);
  for (const secret of ['acc-old', 'ref-1', 'ref-9', 'access-1', 'ya29.', '1//refresh']) assert.ok(!text.includes(secret), '日志泄露了 ' + secret);
});

fs.rmSync(tmp, { recursive: true, force: true });
say(`YouTube Music 回归 ${passed}/${passed}`);
