import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
// Apple Music 适配器 / 登录回归：假桥（合成数据），不联网、不启动 Electron。依赖 pnpm build:main 产物。
const require = createRequire(import.meta.url);
const api = require('../dist-main/index.cjs');
const {
  CookieStore, AppleMusicAdapter, AppleMusicClient, AppleMusicLogin, AppleMusicAuthExpired, AppleMusicNoSubscription,
  AppleMusicRestricted, AppleMusicNotReady, resolveAdapterByUrl, coverCandidates, registerIpcHandlers,
  mapAppleTrack, appleArtworkUrl, createAppleMusicLoginAdapter,
  APPLEMUSIC_AUTH_EXPIRED, APPLEMUSIC_NOT_READY, APPLEMUSIC_NO_SUBSCRIPTION, APPLEMUSIC_LIST_MAX_PAGES,
} = api;

// 收集日志（账号核验失败会 console.warn）：不让它们刷屏，最后断言里面没有令牌字样
const logs = [];
for (const k of ['log', 'info', 'warn', 'error', 'debug']) console[k] = (...a) => logs.push(a.map(String).join(' '));
const say = (s) => process.stdout.write(s + '\n');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'applemusic-regression-'));
let seq = 0;
const newStore = () => new CookieStore(path.join(tmp, `c${++seq}.json`));
let passed = 0;
async function test(name, fn) { await fn(); passed++; say('通过 ' + name); }
const rejects = async (p, re) => assert.rejects(p, (e) => (re instanceof RegExp ? re.test(e.message) : e instanceof re));

/** 假桥：记录每次请求，由 handler 按请求造响应。 */
function makeBridge(handler) {
  const calls = [];
  return { calls, call: async (req) => { calls.push(structuredClone(req)); return handler(req, calls.length - 1); } };
}
function makeAdapter(handler) {
  const adapter = new AppleMusicAdapter();
  const bridge = makeBridge(handler);
  adapter.client.setBridge(bridge);
  return { adapter, bridge };
}

/* ---------- 合成数据（结构仿真实响应，内容全是编的） ---------- */
const ART = (k) => `https://is1-ssl.mzstatic.com/image/thumb/Fake/${k}/{w}x{h}bb.{f}`;
const libPl = (id, name, { tags = [], art = true } = {}) => ({
  id, type: 'library-playlists', href: `/v1/me/library/playlists/${id}`,
  attributes: { name, tags, canEdit: true, ...(art ? { artwork: { url: ART(id) } } : {}) },
});
const libSong = (id, { name = `歌${id}`, catalogId, isrc, ms = 200400, type = 'library-songs', cat = true } = {}) => ({
  id, type,
  attributes: {
    name, artistName: '歌手甲', albumName: '专辑乙', durationInMillis: ms, artwork: { url: ART(id) },
    playParams: { id, kind: 'song', isLibrary: true, ...(catalogId ? { catalogId } : {}) },
  },
  ...(cat && catalogId ? { relationships: { catalog: { data: [{ id: catalogId, attributes: isrc ? { isrc } : {} }] } } } : {}),
});
const catSong = (id, { name = `目录歌${id}`, isrc = 'CNA000000001' } = {}) => ({
  id, type: 'songs',
  attributes: { name, artistName: '歌手丙', albumName: '专辑丁', durationInMillis: 180500, artwork: { url: ART(id) }, isrc, playParams: { id, kind: 'song' } },
});
const ok = (data, extra = {}) => ({ status: 200, data, ...extra });
const offsetOf = (req) => Number(req.query?.offset ?? 0);

/* ---------- 链接解析 ---------- */
await test('链接解析：带 / 不带名字、带查询串、地区转小写、非法地区与非歌单链接', async () => {
  const want = { platform: 'applemusic', id: 'cn:pl.u-abc123' };
  assert.deepEqual(resolveAdapterByUrl('https://music.apple.com/cn/playlist/%E6%88%91%E7%9A%84%E6%AD%8C%E5%8D%95/pl.u-abc123'), want);
  assert.deepEqual(resolveAdapterByUrl('https://music.apple.com/cn/playlist/pl.u-abc123'), want);
  assert.deepEqual(resolveAdapterByUrl('https://music.apple.com/cn/playlist/some-name/pl.u-abc123?l=en-US&ign-itscg=1'), want);
  assert.deepEqual(resolveAdapterByUrl('music.apple.com/us/playlist/x/pl.u-abc123#frag'), { platform: 'applemusic', id: 'us:pl.u-abc123' });
  assert.deepEqual(resolveAdapterByUrl('https://music.apple.com/CN/playlist/x/pl.u-abc123'), want);
  assert.equal(resolveAdapterByUrl('https://music.apple.com/c1/playlist/x/pl.u-abc123'), null);
  assert.equal(resolveAdapterByUrl('https://music.apple.com/chn/playlist/x/pl.u-abc123'), null);
  assert.equal(resolveAdapterByUrl('https://music.apple.com/cn/album/x/123456'), null);
  assert.equal(resolveAdapterByUrl('https://music.apple.com/cn/playlist/x/notplaylist'), null);
  assert.equal(resolveAdapterByUrl('https://music.apple.com.evil.com/cn/playlist/x/pl.u-abc123'), null);
});

/* ---------- 我的歌单 ---------- */
await test('我的歌单：全量翻页（按 next 的 offset）、favorited 排前面、封面换 600x600、曲目数拿不到为 0', async () => {
  const pages = {
    0: ok(Array.from({ length: 100 }, (_, i) => libPl(`p.A${i}`, `歌单${i}`, { art: i !== 3 })), { next: '/v1/me/library/playlists?extend=tags&offset=100' }),
    100: ok([libPl('p.B0', '第二页普通'), libPl('p.B1', '我的喜爱', { tags: ['favorited'] })]),
  };
  const { adapter, bridge } = makeAdapter((req) => pages[offsetOf(req)]);
  const list = await adapter.fetchMyPlaylists();
  assert.equal(list.length, 102);
  assert.equal(list[0].id, 'p.B1', 'favorited 排第一');
  assert.equal(list[0].name, '我的喜爱');
  assert.equal(list[1].id, 'p.A0');
  assert.equal(list[0].trackCount, 0);
  assert.equal(list[1].cover, 'https://is1-ssl.mzstatic.com/image/thumb/Fake/p.A0/600x600bb.jpg');
  assert.equal(list.find((p) => p.id === 'p.A3').cover, '', '没有封面就是空串');
  assert.equal(bridge.calls.length, 2);
  assert.deepEqual(bridge.calls.map((c) => c.path), ['/v1/me/library/playlists', '/v1/me/library/playlists']);
  assert.deepEqual(bridge.calls[0].query, { extend: 'tags', limit: 100, offset: 0 });
  assert.equal(bridge.calls[1].query.offset, 100);
});

await test('我的歌单：翻页有上限、offset 不前进就停', async () => {
  const forever = makeAdapter((req) => ok([libPl(`p.F${offsetOf(req)}`, 'x')], { next: `/v1/me/library/playlists?offset=${offsetOf(req) + 100}` }));
  await forever.adapter.fetchMyPlaylists();
  assert.equal(forever.bridge.calls.length, APPLEMUSIC_LIST_MAX_PAGES);
  const stuck = makeAdapter(() => ok([libPl('p.S', 'x')], { next: '/v1/me/library/playlists?offset=0' }));
  assert.equal((await stuck.adapter.fetchMyPlaylists()).length, 1);
  assert.equal(stuck.bridge.calls.length, 1);
});

/* ---------- 歌单曲目 ---------- */
await test('资料库歌单：先读名称封面再翻页读曲目（include=catalog）；封面 1000、时长取整、isrc 取自目录、i. / a. / 视频回退', async () => {
  const tracks0 = [
    libSong('i.AAA', { catalogId: '1001', isrc: 'USX000000001', ms: 200600 }),
    libSong('a.BBB', { name: '没有目录 id 的歌' }),
    libSong('i.CCC', { type: 'library-music-videos', name: '一个 MV', catalogId: '2002' }),
  ];
  const { adapter, bridge } = makeAdapter((req) => {
    if (req.path === '/v1/me/storefront') return ok([{ id: 'jp', type: 'storefronts' }]);
    if (req.path === '/v1/me/library/playlists/p.LIB1') return ok([{ ...libPl('p.LIB1', '资料库歌单'), attributes: { name: '资料库歌单', artwork: { url: ART('plcover') }, description: { standard: '简介' } } }]);
    if (req.path === '/v1/me/library/playlists/p.LIB1/tracks') {
      return offsetOf(req) === 0
        ? ok(tracks0, { next: '/v1/me/library/playlists/p.LIB1/tracks?offset=100' })
        : ok([libSong('i.AAA', { catalogId: '1001' }), libSong('i.DDD', { name: '第二页', catalogId: '4004', isrc: 'USX000000004' })]);
    }
    throw new Error('意外请求 ' + req.path);
  });
  const pl = await adapter.fetchPlaylist('p.LIB1');
  assert.equal(pl.name, '资料库歌单');
  assert.equal(pl.description, '简介');
  assert.equal(pl.platform, 'applemusic');
  assert.equal(pl.cover, 'https://is1-ssl.mzstatic.com/image/thumb/Fake/plcover/600x600bb.jpg');
  assert.equal(pl.tracks.length, 4, '重复的 i.AAA 去重');
  const trackCalls = bridge.calls.filter((c) => c.path.endsWith('/tracks'));
  assert.equal(trackCalls.length, 2);
  assert.deepEqual(trackCalls[0].query, { include: 'catalog', limit: 100, offset: 0 });
  const [a, b, c, d] = pl.tracks;
  assert.equal(a.id, 'applemusic:1001');
  assert.equal(a.sourceId, '1001');
  assert.equal(a.title, '歌i.AAA');
  assert.equal(a.artist, '歌手甲');
  assert.equal(a.album, '专辑乙');
  assert.equal(a.duration, 201);
  assert.equal(a.cover, 'https://is1-ssl.mzstatic.com/image/thumb/Fake/i.AAA/1000x1000bb.jpg');
  assert.equal(a.originalUrl, '');
  assert.equal(a.fallbackUrl, '');
  assert.equal(a.platform, 'applemusic');
  assert.equal(a.extra.isrc, 'USX000000001', 'isrc 在 relationships.catalog 里');
  assert.equal(a.extra.catalogId, '1001');
  assert.equal(a.extra.libraryId, 'i.AAA');
  assert.equal(a.extra.storefront, 'jp');
  assert.equal(b.id, 'applemusic:a.BBB', '没有 catalogId：回退资料库 id');
  assert.equal(b.sourceId, 'a.BBB');
  assert.equal(b.extra.catalogId, undefined);
  assert.equal(b.extra.libraryId, 'a.BBB');
  assert.equal(c.id, 'applemusic:2002', 'library-music-videos 也按曲目收');
  assert.equal(d.extra.isrc, 'USX000000004');
});

await test('目录歌单：{地区}:pl.xxx → catalog 路径，曲目翻页，isrc 来自曲目自身，不读账号地区', async () => {
  const { adapter, bridge } = makeAdapter((req) => {
    if (req.path === '/v1/catalog/cn/playlists/pl.u-abc') return ok([{ id: 'pl.u-abc', type: 'playlists', attributes: { name: '公开歌单', curatorName: '某人', artwork: { url: ART('catpl') } } }]);
    if (req.path === '/v1/catalog/cn/playlists/pl.u-abc/tracks') {
      return offsetOf(req) === 0 ? ok([catSong('3001'), catSong('3002')], { next: '/v1/catalog/cn/playlists/pl.u-abc/tracks?offset=100' }) : ok([catSong('3003', { isrc: 'CNA000000003' })]);
    }
    throw new Error('意外请求 ' + req.path);
  });
  const pl = await adapter.fetchPlaylist('cn:pl.u-abc');
  assert.equal(pl.id, 'cn:pl.u-abc');
  assert.equal(pl.name, '公开歌单');
  assert.deepEqual(pl.tracks.map((t) => t.id), ['applemusic:3001', 'applemusic:3002', 'applemusic:3003']);
  assert.equal(pl.tracks[0].extra.catalogId, '3001');
  assert.equal(pl.tracks[0].extra.isrc, 'CNA000000001');
  assert.equal(pl.tracks[0].extra.libraryId, undefined);
  assert.equal(pl.tracks[0].extra.storefront, 'cn');
  assert.equal(pl.tracks[2].extra.isrc, 'CNA000000003');
  assert.ok(bridge.calls.every((c) => c.path.startsWith('/v1/catalog/cn/')));
});

await test('歌单 404 给中文提示；歌单为空也能返回', async () => {
  const gone = makeAdapter(() => ({ status: 404, errors: [{ code: '40400', status: '404' }] }));
  await rejects(gone.adapter.fetchPlaylist('cn:pl.zzz'), /不存在或未公开/);
  const empty = makeAdapter((req) => (req.path.endsWith('/tracks') ? ok([]) : ok([{ id: 'pl.e', type: 'playlists', attributes: { name: '空' } }])));
  assert.equal((await empty.adapter.fetchPlaylist('cn:pl.e')).tracks.length, 0);
});

await test('没封面的歌单用第一首补（tracks?limit=1）；目录歌单不补', async () => {
  const { adapter, bridge } = makeAdapter(() => ok([libSong('i.ZZZ', { catalogId: '9' })]));
  assert.equal(await adapter.fetchPlaylistFirstCover('p.NOART'), 'https://is1-ssl.mzstatic.com/image/thumb/Fake/i.ZZZ/1000x1000bb.jpg');
  assert.deepEqual(bridge.calls[0], { path: '/v1/me/library/playlists/p.NOART/tracks', query: { limit: 1 } });
  assert.equal(await adapter.fetchPlaylistFirstCover('cn:pl.x'), '');
  assert.equal(bridge.calls.length, 1);
});

await test('封面模板：{w}x{h} / {f} 替换；非 http(s) 丢弃；mzstatic 封面候选与允许域名', async () => {
  assert.equal(appleArtworkUrl('https://a.mzstatic.com/x/{w}x{h}bb.{f}', 1000), 'https://a.mzstatic.com/x/1000x1000bb.jpg');
  assert.equal(appleArtworkUrl('https://a.mzstatic.com/x/{w}x{h}{c}.{f}', 600), 'https://a.mzstatic.com/x/600x600bb.jpg');
  assert.equal(appleArtworkUrl('javascript:alert(1)', 600), '');
  assert.equal(appleArtworkUrl(undefined, 600), '');
  const c = coverCandidates({ platform: 'applemusic', cover: 'https://is1-ssl.mzstatic.com/image/thumb/Fake/k/1000x1000bb.jpg' });
  assert.deepEqual(c, ['https://is1-ssl.mzstatic.com/image/thumb/Fake/k/1000x1000bb.jpg', 'https://is1-ssl.mzstatic.com/image/thumb/Fake/k/600x600bb.jpg']);
  assert.equal(mapAppleTrack({ id: '1', attributes: {} }), null, '没有标题的丢掉');
});

/* ---------- 错误分类 ---------- */
await test('401 → 登录过期；403 → 本次受限而不是过期', async () => {
  const e401 = makeAdapter(() => ({ status: 401, errors: [{ code: '40100', status: '401' }] }));
  await rejects(e401.adapter.fetchMyPlaylists(), AppleMusicAuthExpired);
  await rejects(e401.adapter.fetchMyPlaylists(), new RegExp(APPLEMUSIC_AUTH_EXPIRED));
  const e403 = makeAdapter(() => ({ status: 403, errors: [{ code: '40300', status: '403' }] }));
  await assert.rejects(e403.adapter.fetchMyPlaylists(), (e) => e instanceof AppleMusicRestricted && !(e instanceof AppleMusicAuthExpired) && !/过期/.test(e.message));
});

await test('40015 → 没有订阅的中文消息（含 400 状态，以及 errors 以 resolve 形式带在 200 里）', async () => {
  const e400 = makeAdapter(() => ({ status: 400, errors: [{ code: '40015', status: '400' }] }));
  await assert.rejects(e400.adapter.fetchMyPlaylists(), (e) => e instanceof AppleMusicNoSubscription && e.message === APPLEMUSIC_NO_SUBSCRIPTION);
  assert.match(APPLEMUSIC_NO_SUBSCRIPTION, /没有有效的 Apple Music 订阅/);
  assert.match(APPLEMUSIC_NO_SUBSCRIPTION, /公开歌单链接仍可导入/);
  const resolved = makeAdapter(() => ({ status: 200, errors: [{ code: '40015', status: '400' }] }));
  await rejects(resolved.adapter.fetchPlaylist('p.XYZ'), AppleMusicNoSubscription);
  const noStatus = makeAdapter(() => ({ status: 0, errors: [{ code: '40015', status: '' }] }));
  await rejects(noStatus.adapter.fetchMyPlaylists(), AppleMusicNoSubscription);
  const generic = makeAdapter(() => ({ status: 500, errors: [{ code: '50000', status: '500' }] }));
  await rejects(generic.adapter.fetchMyPlaylists(), /HTTP 500/);
});

await test('页面没准备好 / 没有桥：统一的「还没准备好」', async () => {
  const nr = makeAdapter(() => ({ notReady: true }));
  await assert.rejects(nr.adapter.fetchMyPlaylists(), (e) => e instanceof AppleMusicNotReady && e.message === APPLEMUSIC_NOT_READY);
  assert.equal(APPLEMUSIC_NOT_READY, 'Apple Music 页面还没准备好，请稍后再试');
  const none = new AppleMusicAdapter();
  await rejects(none.fetchMyPlaylists(), AppleMusicNotReady);
  none.client.setBridge(null);
  await rejects(none.fetchPlaylist('cn:pl.x'), AppleMusicNotReady);
});

/* ---------- 路径 / id 注入 ---------- */
await test('路径与 id 注入校验：../、空格、引号、斜杠、空串、坏地区都被拒，且不发请求', async () => {
  const { adapter, bridge } = makeAdapter(() => ok([]));
  const bad = ['../x', 'p.a b', "p.a'b", 'p."x"', 'p.a/b', '', '..', 'p.a?x=1', 'p.a#', 'p.a\nb'];
  for (const id of bad) await assert.rejects(adapter.fetchPlaylist(id), /不合法/, `fetchPlaylist(${JSON.stringify(id)})`);
  for (const id of ['CN:pl.x', 'c1:pl.x', 'cn:pl.a b', 'cn:pl.../x', 'cn:pl.x/../../me', 'cnn:pl.x', ':pl.x']) {
    await assert.rejects(adapter.fetchPlaylist(id), /不合法/, `fetchPlaylist(${JSON.stringify(id)})`);
  }
  for (const id of ['../x', 'a b', "a'b", 'a/b', '', '..', 'a..b']) {
    await assert.rejects(adapter.client.libraryPlaylist(id), /不合法/, `libraryPlaylist(${JSON.stringify(id)})`);
    await assert.rejects(adapter.client.libraryPlaylistTracks(id), /不合法/);
    await assert.rejects(adapter.client.catalogPlaylistTracks('cn', id), /不合法/);
  }
  await assert.rejects(adapter.client.catalogPlaylist('c/n', 'pl.x'), /不合法/);
  await assert.rejects(adapter.client.catalogPlaylist('../', 'pl.x'), /不合法/);
  assert.equal(bridge.calls.length, 0, '校验失败时不应访问页面');
});

await test('不播 Apple 音频：取链与歌词返回 null，不实现 getAuthStatus', async () => {
  const adapter = new AppleMusicAdapter();
  assert.equal(await adapter.fetchSongUrl('1'), null);
  assert.equal(await adapter.fetchLyric('1'), null);
  assert.equal(typeof adapter.getAuthStatus, 'undefined');
  assert.equal(adapter.platform, 'applemusic');
});

/* ---------- 账号 ---------- */
const withMarker = () => {
  const cookies = newStore();
  cookies.set('applemusic', 'page-session', '', 'Apple Music');
  return cookies;
};
const accountHandler = ({ profile = ok([{ id: 'me', attributes: { name: '小明', artwork: { url: ART('av') } } }]), sub = ok([], { meta: { subscription: { active: true } } }), store = ok([{ id: 'cn', type: 'storefronts' }]) } = {}) =>
  (req) => (req.path === '/v1/me/storefront' ? store : req.path === '/v1/me/social-profile' ? profile : req.path === '/v1/me/account' ? sub : { status: 404 });

await test('没有标记：getAccount 返回 null 且不调用桥（不唤起页面）', async () => {
  const cookies = newStore();
  const client = new AppleMusicClient();
  const bridge = makeBridge(() => { throw new Error('不应被调用'); });
  client.setBridge(bridge);
  assert.equal(await new AppleMusicLogin(cookies, client).getAccount(), null);
  assert.equal(bridge.calls.length, 0);
});

await test('标记写入 CookieStore 不被清洗，可持久化、可清除', async () => {
  const cookies = newStore();
  cookies.set('applemusic', 'page-session', '', 'Apple Music');
  assert.equal(cookies.get('applemusic').cookies, 'page-session');
  assert.equal(cookies.get('applemusic').nickname, 'Apple Music');
  const reloaded = new CookieStore(cookies.filePath);
  assert.equal(reloaded.get('applemusic').cookies, 'page-session');
  cookies.clear('applemusic');
  assert.equal(cookies.get('applemusic'), undefined);
});

await test('getAccount：昵称 / 头像 / 订阅 → isVip；没有社交资料回退「Apple Music 用户」；没订阅 isVip=false', async () => {
  const client = new AppleMusicClient();
  const bridge = makeBridge(accountHandler());
  client.setBridge(bridge);
  const a = await new AppleMusicLogin(withMarker(), client).getAccount();
  assert.equal(a.loggedIn, true);
  assert.equal(a.authStatus, 'valid');
  assert.equal(a.nickname, '小明');
  assert.equal(a.avatarUrl, 'https://is1-ssl.mzstatic.com/image/thumb/Fake/av/300x300bb.jpg');
  assert.equal(a.isVip, true);
  assert.equal(a.vipType, 1);
  assert.deepEqual(bridge.calls.find((c) => c.path === '/v1/me/account').query, { meta: 'subscription' });

  const c2 = new AppleMusicClient();
  c2.setBridge(makeBridge(accountHandler({ profile: ok([]), sub: ok([], { meta: { subscription: { active: false } } }) })));
  const b = await new AppleMusicLogin(withMarker(), c2).getAccount();
  assert.equal(b.nickname, 'Apple Music 用户');
  assert.equal(b.avatarUrl, undefined);
  assert.equal(b.isVip, false);
  assert.equal(b.vipType, 0);
  assert.equal(b.authStatus, 'valid');
});

await test('getAccount：401 → 过期；页面没就绪 / 网络失败 → unknown 但仍算已登录；社交资料单独失败不影响', async () => {
  const mk = (handler) => { const c = new AppleMusicClient(); c.setBridge(makeBridge(handler)); return new AppleMusicLogin(withMarker(), c); };
  const expired = await mk(() => ({ status: 401 })).getAccount();
  assert.deepEqual(expired, { loggedIn: false, authStatus: 'expired', error: 'Apple Music 登录已过期，请重新登录' });
  const expired403 = await mk(() => ({ status: 403 })).getAccount();
  assert.equal(expired403.authStatus, 'expired', 'storefront 403 = 页面里没有有效登录');
  const profile401 = await mk(accountHandler({ profile: { status: 401 } })).getAccount();
  assert.equal(profile401.authStatus, 'expired');
  const notReady = await mk(() => ({ notReady: true })).getAccount();
  assert.equal(notReady.loggedIn, true);
  assert.equal(notReady.authStatus, 'unknown');
  assert.equal(notReady.nickname, 'Apple Music 用户');
  const boom = await mk(() => { throw new Error('超时'); }).getAccount();
  assert.equal(boom.loggedIn, true);
  assert.equal(boom.authStatus, 'unknown');
  const partial = await mk(accountHandler({ profile: { status: 500, errors: [{ code: '50000', status: '500' }] }, sub: { status: 403 } })).getAccount();
  assert.equal(partial.authStatus, 'valid');
  assert.equal(partial.nickname, 'Apple Music 用户');
  assert.equal(partial.isVip, false);
});

await test('登录适配器：kind=window，getAccount / getMyPlaylists 透传', async () => {
  const la = createAppleMusicLoginAdapter({ getAccount: async () => null, getMyPlaylists: async () => [] });
  assert.equal(la.platform, 'applemusic');
  assert.equal(la.name, 'Apple Music');
  assert.equal(la.kind, 'window');
  assert.equal(await la.getAccount(), null);
  assert.deepEqual(await la.getMyPlaylists(), []);
});

await test('IPC：applemusic 登录通道存在；歌单链接导入走目录歌单；无法识别的提示里有 Apple Music', async () => {
  const handlers = new Map();
  const { adapter } = makeAdapter((req) => (req.path.endsWith('/tracks') ? ok([catSong('5001')]) : ok([{ id: 'pl.q', type: 'playlists', attributes: { name: '导入测试' } }])));
  const cookies = newStore();
  registerIpcHandlers({ handle: (k, f) => handlers.set(k, f) }, {
    adapters: { applemusic: adapter }, cookies, resolver: {}, lyricService: {}, login: {}, audioProxy: { urlFor: (u) => u },
    applemusicLoginWindow: async () => ({ ok: true, message: 'Apple Music 登录成功' }),
  });
  assert.deepEqual(await handlers.get('nebula:login:applemusic:window')(null, {}), { ok: true, data: { ok: true, message: 'Apple Music 登录成功' } });
  const r = await handlers.get('nebula:import-playlist')(null, { url: 'https://music.apple.com/cn/playlist/x/pl.q' });
  assert.equal(r.ok, true, r.error);
  assert.equal(r.data.tracks.length, 1);
  assert.equal(r.data.tracks[0].platform, 'applemusic');
  const bad = await handlers.get('nebula:import-playlist')(null, { url: 'https://example.com/x' });
  assert.equal(bad.ok, false);
  assert.match(bad.error, /Apple Music/);
});

/* ---------- 歌单曲目数（#192：列表接口不给数量，另外批量读 tracks?limit=1 的 meta.total） ---------- */
function makeCountingAdapter(totals, { failIds = [] } = {}) {
  const adapter = new AppleMusicAdapter();
  const batches = [];
  const bridge = {
    calls: [],
    call: async (req) => {
      bridge.calls.push(structuredClone(req));
      if (req.path === '/v1/me/library/playlists') return ok([libPl('p.A', '普通'), libPl('p.FAV', '喜爱', { tags: ['favorited'] }), libPl('p.EMPTY', '空歌单'), libPl('p.BAD', '读不到')]);
      if (req.path === '/v1/me/storefront') return ok([{ id: 'cn', type: 'storefronts' }]);
      if (req.path === '/v1/me/library/playlists/p.A') return ok([libPl('p.A', '普通')]);
      if (req.path === '/v1/me/library/playlists/p.A/tracks') return ok([libSong('i.1', { catalogId: '1' }), libSong('i.2', { catalogId: '2' }), libSong('i.3', { catalogId: '3' })]);
      throw new Error('意外请求 ' + req.path);
    },
    callMany: async (reqs) => {
      batches.push(structuredClone(reqs));
      return reqs.map((r) => {
        const id = r.path.split('/')[5];
        if (failIds.includes(id)) return { status: 500, errors: [{ code: '50000', status: '500' }] };
        return { status: 200, data: [], total: totals[id] };
      });
    },
  };
  adapter.client.setBridge(bridge);
  return { adapter, bridge, batches };
}

await test('曲目数：一次批量读出每张歌单的 meta.total；喜爱仍排第一；空歌单是 0；单张失败保持 0', async () => {
  const { adapter, batches } = makeCountingAdapter({ 'p.A': 646, 'p.FAV': 286, 'p.EMPTY': 0, 'p.BAD': 9 }, { failIds: ['p.BAD'] });
  const list = await adapter.fetchMyPlaylists();
  assert.deepEqual(list.map((p) => [p.id, p.trackCount]), [['p.FAV', 286], ['p.A', 646], ['p.EMPTY', 0], ['p.BAD', 0]]);
  assert.equal(batches.length, 1, '所有歌单合成一次批量');
  assert.deepEqual(batches[0][0], { path: '/v1/me/library/playlists/p.A/tracks', query: { limit: 1 } });
  assert.equal(batches[0].length, 4);
});

await test('曲目数：5 分钟内再拉歌单不重复读已知的；失败的下次重试；导入过的歌单用实际数量', async () => {
  const { adapter, batches } = makeCountingAdapter({ 'p.A': 646, 'p.FAV': 286, 'p.EMPTY': 0, 'p.BAD': 9 }, { failIds: ['p.BAD'] });
  await adapter.fetchMyPlaylists();
  const again = await adapter.fetchMyPlaylists();
  assert.equal(batches.length, 2);
  assert.deepEqual(batches[1].map((r) => r.path.split('/')[5]), ['p.BAD'], '只重试读不到的那张');
  assert.equal(again.find((p) => p.id === 'p.A').trackCount, 646);
  const fresh = makeCountingAdapter({ 'p.FAV': 1, 'p.EMPTY': 0, 'p.BAD': 2 });
  await fresh.adapter.fetchPlaylist('p.A');
  const list = await fresh.adapter.fetchMyPlaylists();
  assert.equal(list.find((p) => p.id === 'p.A').trackCount, 3, '导入时记下的实际数量');
  assert.ok(!fresh.batches[0].some((r) => r.path.includes('/p.A/')), '导入过的不再问');
});

await test('曲目数：桥不支持批量 / 页面没就绪 / 批量抛错时，歌单列表照常返回、数量为 0', async () => {
  const noBatch = makeAdapter(() => ok([libPl('p.A', '普通')]));
  assert.equal((await noBatch.adapter.fetchMyPlaylists())[0].trackCount, 0);
  const nr = makeCountingAdapter({});
  nr.bridge.callMany = async () => ({ notReady: true });
  assert.ok((await nr.adapter.fetchMyPlaylists()).every((p) => p.trackCount === 0));
  const boom = makeCountingAdapter({});
  boom.bridge.callMany = async () => { throw new Error('Apple Music 请求超时'); };
  assert.equal((await boom.adapter.fetchMyPlaylists()).length, 4);
});

await test('曲目数：单项 timeout 自动重试恢复；延迟 reject 不产生未捕获异常', async () => {
  const { adapter, bridge } = makeCountingAdapter({ 'p.A': 120, 'p.FAV': 88, 'p.EMPTY': 0, 'p.BAD': 19 });
  let round = 0;
  bridge.callMany = async (reqs) => {
    round++;
    return reqs.map((r) => {
      const id = r.path.split('/')[5];
      if (id === 'p.BAD' && round === 1) return { status: 0, errors: [{ code: 'timeout', status: '' }] };
      return { status: 200, data: [], total: { 'p.A': 120, 'p.FAV': 88, 'p.EMPTY': 0, 'p.BAD': 19 }[id] };
    });
  };
  const list = await adapter.fetchMyPlaylists();
  assert.equal(round, 2, 'timeout 项应自动重试一次');
  assert.equal(list.find((p) => p.id === 'p.BAD').trackCount, 19);
});

assert.ok(!logs.some((l) => /developerToken|musicUserToken|Bearer/i.test(l)), '日志里不应出现令牌字样');
await test('搜索（#232）：未登录时立即返回空，不调用页面引擎；登录后走目录搜索并映射成曲目', async () => {
  const { AppleMusicAdapter } = api;
  // 未登录：cookies 里没有 applemusic 记录 → 必须直接 [] 且不碰 bridge
  let called = 0;
  const anonAdapter = new AppleMusicAdapter({}, { get: () => null });
  anonAdapter.client.setBridge({
    call: async () => {
      called++;
      return { results: { songs: { data: [] } } };
    },
  });
  assert.deepEqual(await anonAdapter.searchSongs('晴天', 5), []);
  assert.equal(called, 0, '没登录就不该发起注定失败的请求');

  // 登录后：目录搜索结果 → Track（复用 mapAppleTrack，封面走 1000 模板）
  const logged = new AppleMusicAdapter({}, { get: () => ({ cookies: 'page-session' }) });
  const seen = [];
  logged.client.setBridge({
    call: async (req) => {
      seen.push(req);
      return {
        // 页面引擎（appleMusicEngine.cjs）会把 results.songs.data 提取到顶层的 data
        data: [
          {
            id: '1440857781',
            type: 'songs',
            attributes: {
              name: '晴天',
              artistName: '周杰伦',
              albumName: '叶惠美',
              durationInMillis: 269000,
              isrc: 'TWA531400001',
              artwork: { url: 'https://is1-ssl.mzstatic.com/image/{w}x{h}bb.jpg' },
              playParams: { id: '1440857781', kind: 'song' },
            },
          },
        ],
      };
    },
    storefront: async () => 'cn',
  });
  const hits = await logged.searchSongs('晴天', 5);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].title, '晴天');
  assert.equal(hits[0].artist, '周杰伦');
  assert.equal(hits[0].platform, 'applemusic');
  assert.equal(hits[0].sourceId, '1440857781');
  assert.ok(hits[0].cover.includes('1000x1000'), '封面走大图模板');
  assert.ok(seen.some((r) => String(r.path).includes('/search')), '走的是目录搜索');
});

await test('目录搜索（歌手 / 专辑）与歌手页 / 专辑详情（#322）：未登录不发请求，登录后正确映射', async () => {
  let anonCalls = 0;
  const anon = new AppleMusicAdapter({}, { get: () => null });
  anon.client.setBridge({ call: async () => { anonCalls++; return { status: 200, data: [] }; } });
  assert.deepEqual(await anon.searchArtists('周杰伦', 5), []);
  assert.deepEqual(await anon.searchAlbums('范特西', 5), []);
  assert.equal(await anon.fetchAlbumDetail('123'), null);
  assert.equal(await anon.fetchArtistInfo('456'), null);
  assert.equal(anonCalls, 0);

  const logged = new AppleMusicAdapter({}, { get: () => ({ cookies: 'page-session' }) });
  logged.client.setBridge({
    call: async (req) => {
      if (req.path === '/v1/me/storefront') return ok([{ id: 'cn', type: 'storefronts' }]);
      if (req.path.endsWith('/search') && req.query?.types === 'artists') {
        return ok([{ id: '3001', type: 'artists', attributes: { name: '周杰伦', artwork: { url: ART('ar1') } } }]);
      }
      if (req.path.endsWith('/search') && req.query?.types === 'albums') {
        return ok([{ id: '2001', type: 'albums', attributes: { name: '范特西', artistName: '周杰伦', releaseDate: '2001-09-14', trackCount: 10, artwork: { url: ART('al1') } } }]);
      }
      if (req.path.endsWith('/albums/2001')) {
        return ok([{ id: '2001', type: 'albums', attributes: { name: '范特西', artistName: '周杰伦', releaseDate: '2001-09-14', artwork: { url: ART('al1') }, editorialNotes: { standard: '<i>经典</i>' } }, relationships: { tracks: { data: [catSong('9001')] } } }]);
      }
      if (req.path.endsWith('/artists/3001')) {
        return ok([{ id: '3001', type: 'artists', attributes: { name: '周杰伦', artwork: { url: ART('ar1') }, editorialNotes: { short: '华语天王' } } }]);
      }
      if (req.path.endsWith('/artists/3001/view/top-songs')) return ok([catSong('9001')]);
      if (req.path.endsWith('/artists/3001/albums')) {
        return ok([{ id: '2001', type: 'albums', attributes: { name: '范特西', artistName: '周杰伦', releaseDate: '2001-09-14', trackCount: 10, artwork: { url: ART('al1') } } }]);
      }
      return ok([]);
    },
  });
  const arts = await logged.searchArtists('周杰伦', 5);
  assert.equal(arts.length, 1); assert.equal(arts[0].id, '3001'); assert.ok(arts[0].avatar.includes('300x300'));
  const albs = await logged.searchAlbums('范特西', 5);
  assert.equal(albs.length, 1); assert.equal(albs[0].year, 2001);
  const det = await logged.fetchAlbumDetail('2001');
  assert.equal(det.tracks.length, 1); assert.equal(det.year, 2001);
  const info = await logged.fetchArtistInfo('3001');
  assert.equal(info.description, '华语天王');
  assert.equal((await logged.fetchArtistSongs('3001')).length, 1);
  assert.equal((await logged.fetchArtistAlbums('3001')).length, 1);
});

say(`Apple Music 适配器回归 ${passed}/${passed}`);
