import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
// 新歌词来源（AMLL 社区库、Apple Music 逐字歌词）回归：全部离线、合成数据，不联网、不碰真实账号。依赖 pnpm build:main 产物。
const require = createRequire(import.meta.url);
const api = require('../dist-main/index.cjs');
const {
  AmllLyrics, AppleMusicLyrics, AppleMusicClient, LyricService, HttpClient, CookieStore, fromTtml, lyricCoverage, timedLines, lrcAt,
  lyricIdsOf, mergeLyricIds, registerIpcHandlers,
} = api;

for (const k of ['warn']) console[k] = () => {};
const say = (s) => process.stdout.write(s + '\n');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lyric-sources-'));
let passed = 0;
async function test(name, fn) { await fn(); passed++; say('通过 ' + name); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let seq = 0;
const newStore = () => new CookieStore(path.join(tmp, `c${++seq}.json`));

/* ---------- 合成数据（句子都是编的） ---------- */
const NS = 'xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata" xmlns:itunes="http://music.apple.com/lyric-ttml-internal"';
const TEXTS = ['编的第一句话', '编的第二句话', '编的第三句话', '编的第四句话'];
const TIMES = [1000, 6000, 11000, 16000];
/** 合成 TTML：split=每个 span 几个字（改变逐字切分）；trans / roman 用行内 x-translation / x-roman。 */
function ttmlDoc({ split = 1, trans = false, roman = false, words = true } = {}) {
  const ps = TEXTS.map((text, i) => {
    const begin = TIMES[i];
    const chars = [...text];
    const chunks = [];
    for (let k = 0; k < chars.length; k += split) chunks.push(chars.slice(k, k + split).join(''));
    const step = Math.floor(4000 / chunks.length);
    const body = words
      ? chunks.map((c, k) => `<span begin="${(begin + k * step) / 1000}s" end="${(begin + (k + 1) * step) / 1000}s">${c}</span>`).join('')
      : text;
    return `<p begin="${begin / 1000}s" end="${(begin + 4000) / 1000}s" itunes:key="L${i + 1}">${body}${trans ? `<span ttm:role="x-translation">译文${i}</span>` : ''}${roman ? `<span ttm:role="x-roman">roman${i}</span>` : ''}</p>`;
  });
  return `<tt ${NS}><body><div>${ps.join('')}</div></body></tt>`;
}
const baseLyric = () => ({ raw: '', lines: TEXTS.map((text, i) => ({ timeMs: TIMES[i], text })) });
const song = (over = {}) => ({
  id: 'qq:mid1', title: '编的歌', artist: '编的歌手', album: '编的专辑', cover: '', duration: 20, platform: 'qq', sourceId: 'mid1', originalUrl: '', fallbackUrl: '', ...over,
});
const SPOTIFY_ID = '0AbCdEfGhIjKlMnOpQrStU';

/* ---------- AMLL 客户端 ---------- */
const amllBody = (ids = {}, xml = ttmlDoc()) => JSON.stringify({
  status: 200,
  data: { id: 1, musicNames: ['x'], artistNames: ['y'], ncmMusicIds: ids.ncm ?? [], qqMusicIds: ids.qq ?? [], appleMusicIds: ids.apple ?? [], spotifyIds: ids.spotify ?? [], isrcs: ids.isrc ?? [], lyrics: xml },
});
const reply = (status, text = '') => ({ ok: status >= 200 && status < 300, status, statusText: '', headers: new Headers(), text });
function fakeHttp(handler) {
  const calls = [];
  return { calls, requestRaw: async (url, opts) => { calls.push({ url, opts }); return handler(new URL(url), calls.length - 1); } };
}
const queryOf = (u) => [...u.searchParams.entries()][0];
const ALL_IDS = { ncm: '900', qq: '800', apple: '700', spotify: SPOTIFY_ID, isrc: 'USABC2500001' };

await test('AMLL：id 顺序 ncm → qq → apple → spotify → isrc，命中即停，同一首最多 3 次请求', async () => {
  const http = fakeHttp((u) => (queryOf(u)[0] === 'appleMusicId' ? reply(200, amllBody({ apple: ['700'] })) : reply(404)));
  const r = await new AmllLyrics(http).lookup(ALL_IDS);
  assert.deepEqual(http.calls.map((c) => queryOf(new URL(c.url))), [['ncmMusicId', '900'], ['qqMusicId', '800'], ['appleMusicId', '700']]);
  assert.equal(r.matchedBy, 'apple');
  assert.equal(r.id, '700');
  assert.deepEqual(r.record.apple, ['700']);
  assert.equal(r.lyric.source, 'amll');
  assert.equal(lyricCoverage(r.lyric).wordLines, 4);
  // 第一个就命中：只有一次请求
  const h2 = fakeHttp(() => reply(200, amllBody({ ncm: ['900'] })));
  assert.equal((await new AmllLyrics(h2).lookup(ALL_IDS)).matchedBy, 'ncm');
  assert.equal(h2.calls.length, 1);
  // 全部没收录：最多 3 次，spotify / isrc 不再查
  const h3 = fakeHttp(() => reply(404));
  assert.equal(await new AmllLyrics(h3).lookup(ALL_IDS), null);
  assert.equal(h3.calls.length, 3);
});

await test('AMLL：只有有的 id 才查；不合法的 id（QQ songmid、非数字、长度不对）被忽略，没有任何 id 不发请求', async () => {
  const http = fakeHttp(() => reply(404));
  const amll = new AmllLyrics(http);
  assert.equal(await amll.lookup({}), null);
  assert.equal(await amll.lookup({ qq: '0039MnYb0qxYhV', ncm: 'abc', spotify: 'short', isrc: 'bad', apple: 'i.AAA' }), null);
  assert.equal(http.calls.length, 0);
  await amll.lookup({ spotify: SPOTIFY_ID, isrc: 'usabc2500001' });
  assert.deepEqual(http.calls.map((c) => queryOf(new URL(c.url))), [['spotifyId', SPOTIFY_ID], ['isrc', 'USABC2500001']], 'isrc 统一大写');
});

await test('AMLL：命中后核对记录的 id 列表确实包含查询的 id，不含就当没命中（防串）', async () => {
  const http = fakeHttp(() => reply(200, amllBody({ ncm: ['12345'] })));
  const amll = new AmllLyrics(http);
  assert.equal(await amll.lookup({ ncm: '900' }), null);
  assert.equal(http.calls.length, 1);
  assert.equal(await amll.lookup({ ncm: '900' }), null, '串了的也按没收录缓存');
  assert.equal(http.calls.length, 1);
});

await test('AMLL：没收录（404）缓存 6 小时、命中缓存 24 小时；命中的记录里别的 id 之后也不用再请求', async () => {
  let t = 1_000_000_000_000;
  const http = fakeHttp((u) => (queryOf(u)[1] === '900' ? reply(200, amllBody({ ncm: ['900'], qq: ['800'] })) : reply(404)));
  const amll = new AmllLyrics(http, { now: () => t });
  assert.equal(await amll.lookup({ ncm: '111' }), null);
  assert.equal(await amll.lookup({ ncm: '111' }), null);
  assert.equal(http.calls.length, 1, '404 缓存');
  t += 6 * 3600_000 + 1;
  assert.equal(await amll.lookup({ ncm: '111' }), null);
  assert.equal(http.calls.length, 2, '6 小时后重查');
  assert.ok(await amll.lookup({ ncm: '900' }));
  assert.equal(http.calls.length, 3);
  assert.ok(await amll.lookup({ ncm: '900' }));
  const byQq = await amll.lookup({ qq: '800' });
  assert.equal(byQq.matchedBy, 'qq');
  assert.equal(http.calls.length, 3, '命中缓存；按记录里列的别的 id 查也直接用缓存');
  t += 24 * 3600_000 - 1000;
  assert.ok(await amll.lookup({ ncm: '900' }));
  assert.equal(http.calls.length, 3);
  t += 2000;
  assert.ok(await amll.lookup({ ncm: '900' }));
  assert.equal(http.calls.length, 4, '24 小时后重查');
});

await test('AMLL：缓存最多 1000 条', async () => {
  const http = fakeHttp(() => reply(404));
  const amll = new AmllLyrics(http);
  for (let i = 0; i < 1005; i++) await amll.lookup({ ncm: String(1000 + i) });
  assert.equal(http.calls.length, 1005);
  await amll.lookup({ ncm: '2004' });
  assert.equal(http.calls.length, 1005, '最近的还在');
  await amll.lookup({ ncm: '1000' });
  assert.equal(http.calls.length, 1006, '最早的被挤掉了');
});

await test('AMLL：429 / 5xx 后 5 分钟内全局不再请求（任何 id），5 分钟后恢复；缓存仍可用', async () => {
  for (const status of [429, 503]) {
    let t = 2_000_000_000_000;
    let mode = status;
    const http = fakeHttp((u) => (queryOf(u)[1] === '1' ? reply(200, amllBody({ ncm: ['1'] })) : reply(mode)));
    const amll = new AmllLyrics(http, { now: () => t });
    assert.ok(await amll.lookup({ ncm: '1' }));
    assert.equal(await amll.lookup({ ncm: '2' }), null);
    assert.equal(http.calls.length, 2);
    t += 299_000;
    assert.equal(await amll.lookup({ ncm: '3', qq: '4' }), null);
    assert.equal(http.calls.length, 2, `${status}：熔断期内不请求`);
    assert.ok(await amll.lookup({ ncm: '1' }), '熔断期内缓存照常');
    t += 2000;
    mode = 404;
    assert.equal(await amll.lookup({ ncm: '3' }), null);
    assert.equal(http.calls.length, 3, `${status}：5 分钟后恢复`);
    assert.equal(await amll.lookup({ ncm: '2' }), null);
    assert.equal(http.calls.length, 4, '被熔断挡掉的那次没有当作没收录缓存');
  }
});

await test('AMLL：请求只有歌曲 id；真实 HttpClient 下不带 Cookie / Authorization，3 秒级超时（这里 60ms）不缓存也不抛错', async () => {
  const cookies = newStore();
  cookies.set('netease', 'MUSIC_U=SECRET_NCM; __csrf=x');
  cookies.set('applemusic', 'page-session');
  cookies.set('spotify', 'SECRET_SPOTIFY_TOKEN');
  const realFetch = globalThis.fetch;
  const seen = [];
  let hang = false;
  globalThis.fetch = (url, init) => { seen.push({ url: String(url), headers: { ...init.headers }, method: init.method }); return hang ? new Promise(() => {}) : Promise.resolve(new Response(amllBody({ ncm: ['900'] }), { status: 200 })); };
  try {
    const amll = new AmllLyrics(new HttpClient(cookies), { timeoutMs: 60 });
    assert.ok(await amll.lookup({ ncm: '900' }));
    assert.equal(seen.length, 1);
    assert.equal(seen[0].url, 'https://api.amll.dev/v1/lyrics/get?ncmMusicId=900');
    assert.equal(seen[0].method, 'GET');
    const headerNames = Object.keys(seen[0].headers).map((k) => k.toLowerCase());
    for (const bad of ['cookie', 'authorization', 'origin', 'referer']) assert.ok(!headerNames.includes(bad), bad);
    assert.ok(!JSON.stringify(seen[0]).includes('SECRET'));
    assert.match(seen[0].headers['User-Agent'], /^Mozilla\/5\.0/);
    hang = true;
    const t0 = Date.now();
    assert.equal(await amll.lookup({ ncm: '901', qq: '902' }), null);
    assert.ok(Date.now() - t0 < 1000, '超时就放弃，且不再试后面的 id');
    assert.equal(seen.length, 2);
    assert.equal(await amll.lookup({ ncm: '901' }), null);
    assert.equal(seen.length, 3, '超时不缓存');
  } finally { globalThis.fetch = realFetch; }
});

/* ---------- id 提取 ---------- */
await test('lyricIdsOf：QQ 只认数字 id（extra.songId），songmid 不用；Apple 取 catalogId；Spotify / isrc；mergeLyricIds 取靠前的', () => {
  assert.deepEqual(lyricIdsOf(song({ extra: { songId: 97773 } })), { qq: '97773' });
  assert.deepEqual(lyricIdsOf(song()), {});
  assert.deepEqual(lyricIdsOf(song({ platform: 'netease', sourceId: '186016' })), { ncm: '186016' });
  assert.deepEqual(lyricIdsOf(song({ platform: 'applemusic', sourceId: 'i.AAA', extra: { catalogId: '535824738', isrc: 'twk970300503' } })), { apple: '535824738', isrc: 'TWK970300503' });
  assert.deepEqual(lyricIdsOf(song({ platform: 'applemusic', sourceId: 'i.AAA' })), {}, '资料库 id 不是目录 id');
  assert.deepEqual(lyricIdsOf(song({ platform: 'spotify', sourceId: SPOTIFY_ID })), { spotify: SPOTIFY_ID });
  assert.deepEqual(mergeLyricIds({ ncm: '1' }, { ncm: '2', apple: '3' }, undefined, { apple: '4', isrc: 'USABC2500001' }), { ncm: '1', apple: '3', isrc: 'USABC2500001' });
});

/* ---------- Apple 客户端 / 歌词 ---------- */
const catSong = (id, { name = '编的歌', artist = '编的歌手', album = '编的专辑', ms = 20000 } = {}) => ({
  id, type: 'songs', attributes: { name, artistName: artist, albumName: album, durationInMillis: ms, playParams: { id, kind: 'song' } },
});
function appleBridge({ search = [], lyrics = { '111': ttmlDoc({ trans: true }) }, localized = false } = {}) {
  const calls = [];
  return {
    calls,
    call: async (req) => {
      calls.push(structuredClone(req));
      if (req.path === '/v1/me/storefront') return { status: 200, data: [{ id: 'cn', type: 'storefronts' }] };
      if (/\/search$/.test(req.path)) return { status: 200, data: search };
      const m = req.path.match(/\/songs\/([^/]+)\/syllable-lyrics$/);
      if (m) {
        const xml = lyrics[m[1]];
        if (!xml) return { status: 404, errors: [{ code: '40400', status: '404' }] };
        return { status: 200, data: [{ id: m[1], type: 'syllable-lyrics', attributes: localized ? { ttml: '<tt/>', ttmlLocalizations: xml } : { ttml: xml } }] };
      }
      return { status: 404, errors: [{ code: '40400', status: '404' }] };
    },
  };
}
function appleSetup(opts, { marker = true } = {}) {
  const bridge = appleBridge(opts);
  const client = new AppleMusicClient();
  client.setBridge(bridge);
  const cookies = newStore();
  if (marker) cookies.set('applemusic', 'page-session');
  return { bridge, client, cookies };
}

await test('Apple 客户端：syllableLyrics 带 l=zh-Hans-CN&extend=ttmlLocalizations，优先 ttmlLocalizations，其次 ttml，404 → null；searchCatalogSongs 取 data', async () => {
  const a = appleSetup({ localized: true });
  const xml = await a.client.syllableLyrics('cn', '111');
  assert.equal(xml, ttmlDoc({ trans: true }));
  assert.deepEqual(a.bridge.calls[0], { path: '/v1/catalog/cn/songs/111/syllable-lyrics', query: { l: 'zh-Hans-CN', extend: 'ttmlLocalizations' } });
  const b = appleSetup({});
  assert.equal(await b.client.syllableLyrics('cn', '111'), ttmlDoc({ trans: true }));
  assert.equal(await b.client.syllableLyrics('cn', '999'), null);
  await assert.rejects(b.client.syllableLyrics('cn', '../x'), /不合法/);
  await assert.rejects(b.client.syllableLyrics('CN', '111'), /地区/);
  const c = appleSetup({ search: [catSong('111')] });
  const rows = await c.client.searchCatalogSongs('cn', '编的歌 编的歌手');
  assert.equal(rows[0].id, '111');
  assert.deepEqual(c.bridge.calls[0], { path: '/v1/catalog/cn/search', query: { term: '编的歌 编的歌手', types: 'songs', limit: 8 } });
  assert.deepEqual(await c.client.searchCatalogSongs('cn', '   '), []);
});

await test('Apple 歌词：没有 applemusic 标记直接返回 null，不调用桥（不唤起页面）', async () => {
  const a = appleSetup({}, { marker: false });
  const lyrics = new AppleMusicLyrics(a.client, a.cookies);
  const t = song({ platform: 'applemusic', sourceId: '111', extra: { catalogId: '111' } });
  assert.equal(await lyrics.lookup(t, t), null);
  assert.equal(await lyrics.lookup(song()), null);
  assert.equal(a.bridge.calls.length, 0);
  a.cookies.set('applemusic', 'page-session');
  assert.ok(await lyrics.lookup(t, t));
  a.cookies.clear('applemusic');
  assert.equal(await lyrics.lookup(song({ platform: 'applemusic', sourceId: '111', extra: { catalogId: '111' } })), null, '登出后立刻不再用（命中缓存也不返回）');
});

await test('Apple 歌词：origin 是 Apple 曲目时按目录 id 直接取，不搜；地区用账号地区且只读一次；带翻译', async () => {
  const a = appleSetup({ lyrics: { '111': ttmlDoc({ trans: true }), '222': ttmlDoc() } });
  const lyrics = new AppleMusicLyrics(a.client, a.cookies);
  const origin = song({ platform: 'applemusic', sourceId: '111', extra: { catalogId: '111' } });
  const hit = await lyrics.lookup(song(), origin);
  assert.equal(hit.via, 'id');
  assert.equal(hit.catalogId, '111');
  assert.equal(hit.lyric.source, 'applemusic');
  assert.deepEqual(lyricCoverage(hit.lyric), { textLines: 4, wordLines: 4, translatedLines: 4, romanLines: 0, bgLines: 0, agentLines: 0 });
  assert.deepEqual(a.bridge.calls.map((c) => c.path), ['/v1/me/storefront', '/v1/catalog/cn/songs/111/syllable-lyrics']);
  // 第二首：地区不再读
  const hit2 = await lyrics.lookup(song({ id: 'x' }), song({ platform: 'applemusic', sourceId: 'i.LIB', extra: { catalogId: '222', libraryId: 'i.LIB' } }));
  assert.equal(hit2.catalogId, '222');
  assert.equal(a.bridge.calls.filter((c) => c.path === '/v1/me/storefront').length, 1);
  // 同一首再来：缓存
  const n = a.bridge.calls.length;
  assert.equal((await lyrics.lookup(song(), origin)).catalogId, '111');
  assert.equal(a.bridge.calls.length, n);
});

await test('Apple 歌词：没有目录 id 时按「歌名 + 第一个歌手」搜目录，recordingMatch 判同一录音（版本 / 时长 / 歌手不符的排除），取最好的', async () => {
  const a = appleSetup({
    search: [
      catSong('301', { name: '编的歌 (Live)' }),
      catSong('302', { ms: 31000 }),
      catSong('303', { artist: '别的歌手' }),
      catSong('304', { album: '别的专辑', ms: 21000 }),
      catSong('305'),
    ],
    lyrics: { '304': ttmlDoc({ split: 2 }), '305': ttmlDoc() },
  });
  const lyrics = new AppleMusicLyrics(a.client, a.cookies);
  const hit = await lyrics.lookup(song({ artists: ['编的歌手', '另一个'], artist: '编的歌手 / 另一个' }));
  assert.equal(hit, null, '歌手集合不同（目标有两位歌手）：全部排除');
  const hit2 = await lyrics.lookup(song());
  assert.equal(hit2.via, 'search');
  assert.equal(hit2.catalogId, '305', '同专辑同时长（rank 0）胜出');
  assert.equal(hit2.duration, 20);
  const search = a.bridge.calls.find((c) => /search$/.test(c.path));
  assert.equal(search.query.term, '编的歌 编的歌手');
  assert.equal(search.query.types, 'songs');
  assert.deepEqual(a.bridge.calls.filter((c) => /syllable/.test(c.path)).map((c) => c.path), ['/v1/catalog/cn/songs/305/syllable-lyrics'], '只取最好的那一个的歌词');
});

await test('Apple 歌词：404（没有歌词）→ null 并缓存；搜不到 → null 并缓存；桥出错 → null 且不缓存', async () => {
  const a = appleSetup({ search: [catSong('401')], lyrics: {} });
  const lyrics = new AppleMusicLyrics(a.client, a.cookies);
  assert.equal(await lyrics.lookup(song()), null);
  const n = a.bridge.calls.length;
  assert.equal(await lyrics.lookup(song()), null);
  assert.equal(a.bridge.calls.length, n, '没有歌词缓存');
  const b = appleSetup({ search: [] });
  const l2 = new AppleMusicLyrics(b.client, b.cookies);
  assert.equal(await l2.lookup(song()), null);
  const m = b.bridge.calls.length;
  assert.equal(await l2.lookup(song()), null);
  assert.equal(b.bridge.calls.length, m);
  const c = appleSetup({});
  let fail = true;
  const realCall = c.bridge.call;
  c.bridge.call = async (req) => (fail ? { notReady: true } : realCall(req));
  const l3 = new AppleMusicLyrics(c.client, c.cookies);
  assert.equal(await l3.lookup(song({ platform: 'applemusic', sourceId: '111', extra: { catalogId: '111' } })), null);
  fail = false;
  assert.ok(await l3.lookup(song({ platform: 'applemusic', sourceId: '111', extra: { catalogId: '111' } })), '失败没被缓存');
});

await test('Apple 歌词：总时限（这里 80ms）到了就放弃，不抛错', async () => {
  const a = appleSetup({});
  a.bridge.call = () => new Promise(() => {});
  const lyrics = new AppleMusicLyrics(a.client, a.cookies, { totalMs: 80 });
  const t0 = Date.now();
  assert.equal(await lyrics.lookup(song({ platform: 'applemusic', sourceId: '111', extra: { catalogId: '111' } })), null);
  assert.ok(Date.now() - t0 < 1000);
});

/* ---------- LyricService 集成 ---------- */
const lines = () => [];
/** 假适配器：qq 为主（只有行级歌词），netease 可搜。 */
function adapters({ primary = baseLyric(), neteaseLyric = null, platform = 'qq' } = {}) {
  const calls = { search: 0, neteaseFetch: 0 };
  const map = {
    [platform]: { fetchLyric: async () => primary },
    netease: platform === 'netease' ? undefined : {
      searchSongs: async () => { calls.search++; return neteaseLyric ? [song({ id: 'netease:900', platform: 'netease', sourceId: '900' })] : []; },
      fetchLyric: async () => { calls.neteaseFetch++; return neteaseLyric; },
    },
    qq: platform === 'qq' ? { fetchLyric: async () => primary } : {},
    kugou: {},
  };
  if (!map.netease) delete map.netease;
  return { map, calls };
}
const fakeAmll = (impl) => { const calls = []; return { calls, lookup: async (ids) => { calls.push({ ...ids }); return impl(ids, calls.length - 1); } }; };
const amllHit = (xml, over = {}) => ({ lyric: fromTtml(xml, 'amll'), matchedBy: 'ncm', id: '900', record: { ncm: ['900'], qq: [], apple: [], spotify: [], isrc: [] }, ...over });
const fakeApple = (impl) => { const calls = []; return { calls, lookup: async (track, origin) => { calls.push({ track, origin }); return impl(track, origin); } }; };
const appleHit = (xml, over = {}) => ({ lyric: fromTtml(xml, 'applemusic'), catalogId: '111', via: 'id', ...over });

await test('LyricService：主歌词已经够好（逐字和翻译都 ≥80%）时只按已知 id 查一次 AMLL（补和声 / 对唱），不查 Apple，也不搜别的平台', async () => {
  const full = fromTtml(ttmlDoc({ trans: true }), 'amll');
  const { map, calls } = adapters({ primary: full });
  const amll = fakeAmll(() => amllHit(ttmlDoc()));
  const apple = fakeApple(() => appleHit(ttmlDoc()));
  const r = await new LyricService(map, undefined, { amll, appleMusic: apple }).fetchLyric(song({ extra: { songId: 1 } }), undefined, song({ platform: 'spotify', sourceId: SPOTIFY_ID }));
  assert.equal(r.lines.length, 4);
  assert.deepEqual(amll.calls, [{ qq: '1', spotify: SPOTIFY_ID }], '只查一次，只用第一轮的 id');
  assert.equal(apple.calls.length, 0);
  assert.equal(calls.search, 0);
  assert.equal(r.provenance.length, 1, 'AMLL 没带来新东西：不记 enrichment');
});

/** 带和声 / 对唱的 AMLL 歌词（正文、时间与 ttmlDoc 一致）：偶数行 v1、奇数行 v2，前三行有和声。 */
function duetDoc() {
  const ps = TEXTS.map((text, i) => {
    const begin = TIMES[i];
    const bg = i < 3 ? `<span ttm:role="x-bg"><span begin="${(begin + 1000) / 1000}s" end="${(begin + 1500) / 1000}s">(哦${i}</span><span begin="${(begin + 1500) / 1000}s" end="${(begin + 2200) / 1000}s">耶)</span></span>` : '';
    return `<p begin="${begin / 1000}s" end="${(begin + 4000) / 1000}s" ttm:agent="${i % 2 ? 'v2' : 'v1'}"><span begin="${begin / 1000}s" end="${(begin + 4000) / 1000}s">${text}</span>${bg}</p>`;
  });
  return `<tt ${NS}><head><metadata><ttm:agent type="person" xml:id="v1"/><ttm:agent type="person" xml:id="v2"/></metadata></head><body><div>${ps.join('')}</div></body></tt>`;
}

await test('LyricService：主歌词够好时，AMLL 带和声 / 对唱就补上（只补缺的，已有的翻译、逐字不动）；provenance 记 amll', async () => {
  const full = fromTtml(ttmlDoc({ trans: true }), 'amll');
  const { map, calls } = adapters({ primary: full });
  const amll = fakeAmll(() => amllHit(duetDoc()));
  const apple = fakeApple(() => appleHit(ttmlDoc()));
  const r = await new LyricService(map, undefined, { amll, appleMusic: apple }).fetchLyric(song({ extra: { songId: 1 } }));
  assert.equal(amll.calls.length, 1);
  assert.equal(apple.calls.length, 0);
  assert.equal(calls.search, 0);
  assert.deepEqual(r.lines.map((l) => l.agent), ['v1', 'v2', 'v1', 'v2']);
  assert.deepEqual(r.lines.map((l) => l.bg?.text), ['哦0耶', '哦1耶', '哦2耶', undefined]);
  assert.deepEqual(r.lines[0].bg.words.map((w) => [w.text, w.startMs]), [['哦0', 2000], ['耶', 2500]]);
  assert.equal(lyricCoverage(r).bgLines, 3);
  assert.equal(lyricCoverage(r).agentLines, 4);
  assert.deepEqual(r.coverage.bgLines, 3, '写进 coverage');
  assert.equal(r.yrc, full.yrc, '已有的逐字不动');
  assert.deepEqual(r.lines.map((l) => l.translation), ['译文0', '译文1', '译文2', '译文3']);
  assert.deepEqual(r.provenance.map((p) => [p.platform, p.kind]), [['qq', 'primary'], ['amll', 'enrichment']]);
  assert.equal(r.incomplete, false);
});

await test('LyricService：主歌词够好时 AMLL 没命中 / 抛错 / 卡住（1.2 秒预算）：照旧返回主歌词，没带来和声', async () => {
  const full = fromTtml(ttmlDoc({ trans: true }), 'amll');
  const run = async (impl) => {
    const { map, calls } = adapters({ primary: full });
    const amll = fakeAmll(impl);
    const t0 = Date.now();
    const r = await new LyricService(map, undefined, { amll }).fetchLyric(song({ extra: { songId: 1 } }));
    assert.equal(calls.search, 0);
    return { r, amll, took: Date.now() - t0 };
  };
  for (const impl of [() => null, () => { throw new Error('boom'); }, () => ({ lyric: null })]) {
    const { r, amll } = await run(impl);
    assert.equal(amll.calls.length, 1);
    assert.equal(r.lines.length, 4);
    assert.ok(r.lines.every((l) => !l.bg && !l.agent));
    assert.equal(r.yrc, full.yrc);
  }
  const hung = await run(() => new Promise(() => {}));
  assert.ok(hung.took < 2500, `卡住时只拖到预算 ${hung.took}ms`);
  assert.equal(hung.r.lines.length, 4);
  assert.ok(hung.r.lines.every((l) => !l.bg));
  // 没有可查的 id（主平台没有 songId 之类）：不查
  const none = adapters({ primary: full });
  const amll = fakeAmll(() => amllHit(duetDoc()));
  const r = await new LyricService({ ...none.map, kuwo: { fetchLyric: async () => full } }, undefined, { amll }).fetchLyric(song({ id: 'kuwo:1', platform: 'kuwo', sourceId: '1' }));
  assert.equal(amll.calls.length, 0);
  assert.ok(r.lines.every((l) => !l.bg));
});

await test('LyricService：主歌词只有行级时，AMLL 补上逐字（provenance 记 amll）；没注入新来源时行为不变', async () => {
  const { map } = adapters();
  const amll = fakeAmll(() => amllHit(ttmlDoc()));
  const r = await new LyricService(map, undefined, { amll }).fetchLyric(song({ platform: 'qq', extra: { songId: 97773 } }));
  assert.deepEqual(amll.calls, [{ qq: '97773' }]);
  assert.equal(lyricCoverage(r).wordLines, 4);
  assert.deepEqual(r.provenance.map((p) => [p.platform, p.kind]), [['qq', 'primary'], ['amll', 'enrichment']]);
  assert.equal(r.incomplete, false, '中文歌逐字齐了就算完整，不要求翻译（#197）');
  const plain = await new LyricService(adapters().map).fetchLyric(song());
  assert.equal(lyricCoverage(plain).wordLines, 0);
});

await test('LyricService：合并顺序固定 AMLL → Apple → 网易云，与网络完成先后无关', async () => {
  const neteaseLyric = { ...fromTtml(ttmlDoc({ split: 3 }), 'amll'), source: 'netease', romanRaw: '[00:01.000]rr', romalrc: '[00:01.000]rr' };
  const run = async (amllDelay, appleDelay, neteaseDelay) => {
    const { map } = adapters({ neteaseLyric });
    const orig = map.netease.fetchLyric;
    map.netease.fetchLyric = async (...a) => { await sleep(neteaseDelay); return orig(...a); };
    const amll = fakeAmll(async () => { await sleep(amllDelay); return amllHit(ttmlDoc({ split: 1 })); });
    const apple = fakeApple(async () => { await sleep(appleDelay); return appleHit(ttmlDoc({ split: 2, trans: true })); });
    return new LyricService(map, undefined, { amll, appleMusic: apple }).fetchLyric(song({ extra: { songId: 5 } }));
  };
  const a = await run(5, 80, 40);
  const b = await run(80, 5, 5);
  const c = await run(40, 40, 120);
  for (const r of [b, c]) assert.deepEqual(JSON.parse(JSON.stringify(r)), JSON.parse(JSON.stringify(a)));
  assert.deepEqual(a.provenance.map((p) => p.platform), ['qq', 'amll', 'applemusic', 'netease']);
  assert.equal(a.yrc, fromTtml(ttmlDoc({ split: 1 }), 'amll').yrc, '逐字时间轴取最先合并的 AMLL，后面的只补缺口');
  assert.equal(lyricCoverage(a).translatedLines, 4, 'Apple 补上了翻译');
  assert.ok(a.romalrc, '网易云补上了罗马音');
});

await test('LyricService（#197）：日语歌逐字、翻译都齐，只缺罗马音也去别家补；中文歌逐字齐了不再搜也不查新来源', async () => {
  const JA = ['てすとのいち', 'てすとのに', 'てすとのさん', 'てすとのよん'];
  const mk = (roman) => {
    const ls = JA.map((text, i) => ({ timeMs: TIMES[i], text, translation: '译文' + i }));
    return { raw: '', lines: ls, yrc: ls.map((l) => `[${l.timeMs},3000](${l.timeMs},3000,0)${l.text}`).join('\n'), ...(roman ? { romalrc: ls.map((l, i) => lrcAt(l.timeMs, 'roma' + i)).join('\n') } : {}) };
  };
  const ja = adapters({ primary: mk(false), neteaseLyric: { ...mk(true), source: 'netease' } });
  const r = await new LyricService(ja.map).fetchLyric(song());
  assert.equal(ja.calls.search, 1);
  assert.equal(lyricCoverage(r).romanLines, 4);
  assert.equal(r.incomplete, false);
  const zh = adapters({ primary: fromTtml(ttmlDoc(), 'amll'), neteaseLyric: { ...mk(true), source: 'netease' } });
  const amll = fakeAmll(() => null);
  const rz = await new LyricService(zh.map, undefined, { amll }).fetchLyric(song({ extra: { songId: 1 } }));
  assert.equal(zh.calls.search, 0);
  assert.equal(amll.calls.length, 1, '够好时只按 id 查一次 AMLL（补和声 / 对唱），不搜别的平台');
  assert.equal(rz.incomplete, false);
});

await test('LyricService：origin 的 Spotify / Apple / isrc id 用于查询，缓存键和歌词身份仍按实际供流那首', async () => {
  const stored = [];
  const cache = { get: () => null, set: (p, id, l) => stored.push([p, id, l]) };
  const { map } = adapters();
  const amll = fakeAmll(() => amllHit(ttmlDoc(), { matchedBy: 'spotify', id: SPOTIFY_ID }));
  const apple = fakeApple(() => appleHit(ttmlDoc()));
  const stream = song({ platform: 'qq', sourceId: 'mid1' });
  const origin = song({ id: 'spotify:' + SPOTIFY_ID, platform: 'spotify', sourceId: SPOTIFY_ID, extra: { isrc: 'USABC2500001' } });
  const r = await new LyricService(map, cache, { amll, appleMusic: apple }).fetchLyric(stream, undefined, origin);
  assert.deepEqual(amll.calls, [{ spotify: SPOTIFY_ID, isrc: 'USABC2500001' }]);
  assert.equal(apple.calls[0].origin, origin);
  assert.equal(apple.calls[0].track, stream);
  assert.equal(stored.length, 1);
  assert.deepEqual([stored[0][0], stored[0][1]], ['qq', 'mid1']);
  assert.deepEqual(r.identity, { platform: 'qq', sourceId: 'mid1' });
  // Apple 来源的 origin
  const amll2 = fakeAmll(() => null);
  await new LyricService(adapters().map, undefined, { amll: amll2, appleMusic: fakeApple(() => null) })
    .fetchLyric(stream, undefined, song({ platform: 'applemusic', sourceId: 'i.X', extra: { catalogId: '535824738', libraryId: 'i.X' } }));
  assert.deepEqual(amll2.calls, [{ apple: '535824738' }]);
});

await test('LyricService：第一轮 AMLL 没命中、而搜到的网易云同一首带来新 id 时，再查一次 AMLL', async () => {
  const neteaseLyric = fromTtml(ttmlDoc(), 'amll');
  const { map } = adapters({ neteaseLyric });
  const amll = fakeAmll((ids) => (ids.ncm === '900' ? amllHit(ttmlDoc({ trans: true })) : null));
  const r = await new LyricService(map, undefined, { amll }).fetchLyric(song({ extra: { songId: 5 } }));
  assert.deepEqual(amll.calls, [{ qq: '5' }, { qq: '5', ncm: '900' }]);
  assert.equal(lyricCoverage(r).translatedLines, 4);
  assert.equal(r.provenance[1].platform, 'amll');
});

await test('LyricService：主歌词没有正文时，按 id 命中的 AMLL / Apple 保留逐字；Apple 搜索命中且时长差 >2 秒只给整句', async () => {
  const none = (platform) => ({ [platform]: { fetchLyric: async () => null }, netease: {}, qq: {}, kugou: {} });
  const stream = song({ platform: 'spotify', sourceId: SPOTIFY_ID, duration: 20 });
  const a = await new LyricService(none('spotify'), undefined, { amll: fakeAmll(() => amllHit(ttmlDoc())) }).fetchLyric(stream);
  assert.equal(lyricCoverage(a).wordLines, 4);
  assert.deepEqual(a.identity, { platform: 'amll', sourceId: 'ncm:900' });
  assert.equal(a.incomplete, true);
  const b = await new LyricService(none('spotify'), undefined, { appleMusic: fakeApple(() => appleHit(ttmlDoc(), { via: 'id' })) }).fetchLyric(stream);
  assert.equal(lyricCoverage(b).wordLines, 4);
  assert.deepEqual(b.identity, { platform: 'applemusic', sourceId: '111' });
  const c = await new LyricService(none('spotify'), undefined, { appleMusic: fakeApple(() => appleHit(ttmlDoc(), { via: 'search', duration: 24 })) }).fetchLyric(stream);
  assert.equal(c.yrc, undefined);
  assert.equal(c.lines.length, 4);
  const d = await new LyricService(none('spotify'), undefined, { appleMusic: fakeApple(() => appleHit(ttmlDoc(), { via: 'search', duration: 21 })) }).fetchLyric(stream);
  assert.equal(lyricCoverage(d).wordLines, 4);
});

await test('LyricService：第二轮 AMLL 用的是搜到的那首的 id（不是严格确认的同一录音）：没有主歌词时按那首的时长核对，差 >2 秒只给整句', async () => {
  // 主平台（酷我）没有歌词、也没有可查 AMLL 的 id；网易云按歌名搜到一首（同一录音判定对 5 分钟的歌容差 6 秒），它自己的歌词取不到，AMLL 用它的 id 命中
  const run = async (candidateDuration) => {
    const map = {
      kuwo: { fetchLyric: async () => null },
      netease: { searchSongs: async () => [song({ id: 'netease:900', platform: 'netease', sourceId: '900', duration: candidateDuration })], fetchLyric: async () => null },
      qq: {}, kugou: {},
    };
    const amll = fakeAmll((ids) => (ids.ncm === '900' ? amllHit(ttmlDoc()) : null));
    const r = await new LyricService(map, undefined, { amll }).fetchLyric(song({ id: 'kuwo:1', platform: 'kuwo', sourceId: '1', duration: 300 }));
    return { r, amll };
  };
  const far = await run(305);
  assert.deepEqual(far.amll.calls, [{ ncm: '900' }], '没有 id 时不发第一轮，搜到后才查');
  assert.equal(far.r.yrc, undefined, '时长差 5 秒（过了搜索的同一录音判定，但超过 2 秒）：只给整句');
  assert.equal(far.r.lines.length, 4);
  const near = await run(301);
  assert.equal(lyricCoverage(near.r).wordLines, 4, '时长差 1 秒：保留逐字');
});

await test('LyricService：新来源抛错 / 返回垃圾 / 卡住都不影响其余来源的结果，整体仍在时限内', async () => {
  const neteaseLyric = fromTtml(ttmlDoc(), 'amll');
  const make = (amllImpl, appleImpl) => {
    const { map } = adapters({ neteaseLyric });
    return new LyricService(map, undefined, { amll: fakeAmll(amllImpl), appleMusic: fakeApple(appleImpl) });
  };
  const bad = await make(() => { throw new Error('boom'); }, () => ({ lyric: null })).fetchLyric(song({ extra: { songId: 5 } }));
  assert.equal(lyricCoverage(bad).wordLines, 4, '网易云照常补上');
  const t0 = Date.now();
  const hung = await make(() => new Promise(() => {}), () => new Promise(() => {})).fetchLyric(song({ extra: { songId: 6 } }));
  const took = Date.now() - t0;
  assert.equal(lyricCoverage(hung).wordLines, 4, '两个新来源都卡住，网易云的结果仍在');
  assert.ok(took < 6000, `整体 ${took}ms，应远小于 8.5 秒`);
});

await test('LyricService：旧调用方式（两个参数 / 无新来源）不受影响', async () => {
  const { map } = adapters();
  const r = await new LyricService(map).fetchLyric(song());
  assert.equal(r.lines.length, 4);
  const r2 = await new LyricService(adapters().map, undefined, {}).fetchLyric(song(), undefined, undefined);
  assert.equal(r2.lines.length, 4);
  assert.ok(timedLines(fromTtml(ttmlDoc(), 'amll').yrc).length === 4);
});

/* ---------- 手动换歌词（歌词版本 / 选择 / 时间微调） ---------- */
const MARK = { qq: 'QQ自带', netease: '网易云自带' };
/** 只有前 n 行有逐字的歌词，lrc 带来源标记（用来看「正文来自谁」）。 */
const partialWords = (n, mark, extra = {}) => ({
  raw: '', lrc: `${lrcAt(0, mark)}\n` + TEXTS.map((t, i) => lrcAt(TIMES[i], t)).join('\n'),
  lines: TEXTS.map((text, i) => ({ timeMs: TIMES[i], text })),
  yrc: TEXTS.slice(0, n).map((t, i) => `[${TIMES[i]},3000](${TIMES[i]},3000,0)${t}`).join('\n'), ...extra,
});
/** qq 自己（只有整句）+ netease 搜到一首（前 2 行逐字）+ AMLL（第一轮 id 命中，带逐字和翻译）+ Apple（按 id，带逐字和罗马音）。 */
function manualSetup({ neteaseDuration = 21, appleImpl, amllImpl } = {}) {
  const stats = { neteaseFetch: [], qqFetch: 0 };
  const map = {
    qq: { fetchLyric: async () => { stats.qqFetch++; return partialWords(0, MARK.qq); } },
    netease: {
      searchSongs: async () => [song({ id: 'netease:900', platform: 'netease', sourceId: '900', duration: neteaseDuration })],
      fetchLyric: async (id) => { stats.neteaseFetch.push(id); if (id !== '900') return null; return partialWords(2, MARK.netease, { source: 'netease' }); },
    },
    kugou: {},
  };
  const amll = fakeAmll(amllImpl ?? (() => amllHit(ttmlDoc({ trans: true }), { matchedBy: 'qq', id: '5', record: { ncm: [], qq: ['5'], apple: [], spotify: [], isrc: [] } })));
  const apple = fakeApple(appleImpl ?? (() => appleHit(ttmlDoc({ split: 2, roman: true }), { catalogId: '111', via: 'id' })));
  return { map, stats, amll, apple };
}
const mtrack = () => song({ extra: { songId: 5 } });
const newOverrides = (name) => new api.LyricOverrides(path.join(tmp, name));

await test('listLyricVersions：本平台 / AMLL / Apple / 搜索来源各一份，带覆盖率与时长差（按 id 确认的为 null）', async () => {
  const { map, amll, apple } = manualSetup();
  const svc = new LyricService(map, undefined, { amll, appleMusic: apple }, newOverrides('o1'));
  const r = await svc.listLyricVersions(mtrack());
  assert.equal(r.pick, null);
  assert.equal(r.offsetMs, 0);
  assert.deepEqual(r.versions.map((v) => [v.platform, v.sourceId]), [['qq', 'mid1'], ['amll', 'qq:5'], ['applemusic', '111'], ['netease', '900']]);
  assert.deepEqual(r.versions.map((v) => v.coverage.wordLines), [0, 4, 4, 2]);
  assert.deepEqual(r.versions.map((v) => v.coverage.translatedLines), [0, 4, 0, 0]);
  assert.equal(r.versions[2].coverage.romanLines, 4);
  assert.deepEqual(r.versions.map((v) => v.durationDiffSec), [null, null, null, 1], '搜到的那首时长 21 秒、这首 20 秒');
  assert.equal(amll.calls.length, 1, '第一轮就命中，只查一次');
  // 没有 overrides 时也能列（pick 为 null、微调 0）
  const bare = await new LyricService(manualSetup().map).listLyricVersions(mtrack());
  assert.deepEqual(bare.versions.map((v) => v.platform), ['qq', 'netease']);
  assert.equal(bare.pick, null);
});

await test('listLyricVersions：一个来源抛错 / 卡住不影响其余；没有正文的候选不列；第一轮没命中时按搜到的网易云 id 再查 AMLL（与 fetchLyric 同一段收集）', async () => {
  const bad = manualSetup({ amllImpl: () => { throw new Error('boom'); }, appleImpl: () => { throw new Error('boom'); } });
  const r = await new LyricService(bad.map, undefined, { amll: bad.amll, appleMusic: bad.apple }).listLyricVersions(mtrack());
  assert.deepEqual(r.versions.map((v) => v.platform), ['qq', 'netease']);
  const hung = manualSetup({ appleImpl: () => new Promise(() => {}) });
  const t0 = Date.now();
  const r2 = await new LyricService(hung.map, undefined, { amll: hung.amll, appleMusic: hung.apple }).listLyricVersions(mtrack());
  assert.deepEqual(r2.versions.map((v) => v.platform), ['qq', 'amll', 'netease']);
  assert.ok(Date.now() - t0 < 8000, `Apple 卡住只拖到它自己的预算 ${Date.now() - t0}ms`);
  // 本平台抛错；AMLL 返回没有正文的歌词
  const m = manualSetup({ amllImpl: () => ({ lyric: { raw: '', lines: [{ timeMs: 1, text: '' }] }, matchedBy: 'ncm', id: '1', record: {} }) });
  m.map.qq.fetchLyric = async () => { throw new Error('boom'); };
  const r3 = await new LyricService(m.map, undefined, { amll: m.amll, appleMusic: m.apple }).listLyricVersions(mtrack());
  assert.deepEqual(r3.versions.map((v) => v.platform), ['applemusic', 'netease']);
  // 第一轮（只有 songId）没命中，搜到的网易云带来 ncm id 后再查一次
  const two = manualSetup({ amllImpl: (ids) => (ids.ncm === '900' ? amllHit(ttmlDoc()) : null) });
  const r4 = await new LyricService(two.map, undefined, { amll: two.amll }).listLyricVersions(mtrack());
  assert.deepEqual(two.amll.calls, [{ qq: '5' }, { qq: '5', ncm: '900' }]);
  assert.deepEqual(r4.versions.map((v) => v.platform), ['qq', 'amll', 'netease']);
  assert.equal(r4.versions[1].durationDiffSec, 1, '用搜到的那首的时长核对，不算严格确认的同一录音');
  // 已经取消就不再等
  const c = new AbortController(); c.abort();
  const r5 = await new LyricService(manualSetup().map).listLyricVersions(mtrack(), c.signal);
  assert.deepEqual(r5.versions, []);
});

await test('chooseLyric：选了某一份后正文来自它（provenance 第一项 manual），别家仍补它缺的；改回 null 恢复自动', async () => {
  const dir = path.join(tmp, 'c2');
  const { map, amll, apple } = manualSetup();
  const cache = new api.LyricCache(dir), ov = new api.LyricOverrides(dir);
  const svc = new LyricService(map, cache, { amll, appleMusic: apple }, ov);
  const auto = await svc.fetchLyric(mtrack());
  assert.deepEqual(auto.provenance[0], { platform: 'qq', sourceId: 'mid1', kind: 'primary' });
  assert.match(auto.lrc, /QQ自带/);
  assert.ok(cache.get('qq', 'mid1'), '自动结果进了缓存');
  svc.chooseLyric(mtrack(), { pick: { platform: 'netease', sourceId: '900' } });
  assert.equal(cache.get('qq', 'mid1'), null, '来源变了：缓存作废');
  const manual = await svc.fetchLyric(mtrack());
  assert.deepEqual(manual.provenance[0], { platform: 'netease', sourceId: '900', kind: 'manual' });
  assert.match(manual.lrc, /网易云自带/, '正文来自选中的那份');
  assert.ok(!/QQ自带/.test(manual.lrc));
  assert.equal(lyricCoverage(manual).wordLines, 4, '它只有 2 行逐字，别家补上其余');
  assert.equal(lyricCoverage(manual).translatedLines, 4, '别家补它缺的翻译');
  assert.ok(manual.provenance.length > 1);
  assert.ok(manual.provenance.slice(1).every((p) => p.kind === 'enrichment' && p.platform !== 'netease'), '补丁里跳过选中的那份');
  assert.ok(manual.provenance.slice(1).every((p) => Array.isArray(p.gain) && p.gain.length), '每家补了什么记在 gain 里');
  assert.ok(manual.provenance.some((p) => p.gain?.includes('translation')) && manual.provenance.some((p) => p.gain?.includes('words')));
  // 选择写进了文件，重启后还在
  await ov.flush();
  assert.deepEqual(new api.LyricOverrides(dir).get('qq:mid1'), { pick: { platform: 'netease', sourceId: '900' } });
  const listed = await svc.listLyricVersions(mtrack());
  assert.deepEqual(listed.pick, { platform: 'netease', sourceId: '900' });
  // 改回自动
  svc.chooseLyric(mtrack(), { pick: null });
  const back = await svc.fetchLyric(mtrack());
  assert.deepEqual(back.provenance[0], { platform: 'qq', sourceId: 'mid1', kind: 'primary' });
  assert.match(back.lrc, /QQ自带/);
  assert.equal(ov.get('qq:mid1'), null, 'pick 为空且微调为 0：这一条删掉');
  // 选 AMLL / Apple（没列过版本、内存里没有：按来源重取）：正文来自它们
  const f = manualSetup();
  const svc2 = new LyricService(f.map, undefined, { amll: f.amll, appleMusic: f.apple }, newOverrides('o2b'));
  svc2.chooseLyric(mtrack(), { pick: { platform: 'amll', sourceId: 'qq:5' } });
  const a = await svc2.fetchLyric(mtrack());
  assert.deepEqual(a.provenance[0], { platform: 'amll', sourceId: 'qq:5', kind: 'manual' });
  assert.deepEqual(f.amll.calls[0], { qq: '5' }, 'AMLL 的 sourceId 是 matchedBy:id，按它重取');
  assert.equal(lyricCoverage(a).translatedLines, 4);
  svc2.chooseLyric(mtrack(), { pick: { platform: 'applemusic', sourceId: '111' } });
  const p = await svc2.fetchLyric(mtrack());
  assert.deepEqual(p.provenance[0], { platform: 'applemusic', sourceId: '111', kind: 'manual' });
  const origin = f.apple.calls.find((c) => c.origin?.platform === 'applemusic').origin;
  assert.equal(origin.extra.catalogId, '111', 'Apple 按目录 id 重取（把它当 origin 传给 lookup）');
  assert.equal(lyricCoverage(p).romanLines, 4);
});

await test('chooseLyric：选中的那份取不到（下架 / 网络失败 / 来源不存在）退回自动，这首歌不会没歌词', async () => {
  const { map, amll, apple } = manualSetup();
  const svc = new LyricService(map, undefined, { amll, appleMusic: apple }, newOverrides('o3'));
  for (const pick of [{ platform: 'netease', sourceId: 'gone' }, { platform: 'kuwo', sourceId: '1' }, { platform: 'amll', sourceId: 'bad' }, { platform: 'amll', sourceId: 'nope:1' }]) {
    svc.chooseLyric(mtrack(), { pick });
    const r = await svc.fetchLyric(mtrack());
    assert.deepEqual(r.provenance[0], { platform: 'qq', sourceId: 'mid1', kind: 'primary' }, JSON.stringify(pick));
    assert.equal(r.lines.length, 4);
  }
  const down = manualSetup({ amllImpl: () => { throw new Error('boom'); } });
  const s2 = new LyricService(down.map, undefined, { amll: down.amll, appleMusic: down.apple }, newOverrides('o3b'));
  s2.chooseLyric(mtrack(), { pick: { platform: 'amll', sourceId: 'qq:5' } });
  assert.equal((await s2.fetchLyric(mtrack())).provenance[0].kind, 'primary');
  // 退回自动的结果不写缓存：来源恢复后下一次就按选择取（否则自动结果会盖住选择最长 30 天）
  const flaky = manualSetup({ amllImpl: () => { throw new Error('boom'); } });
  const fc = new api.LyricCache(path.join(tmp, 'c3c'));
  const s3 = new LyricService(flaky.map, fc, { amll: flaky.amll, appleMusic: flaky.apple }, newOverrides('o3c'));
  s3.chooseLyric(mtrack(), { pick: { platform: 'amll', sourceId: 'qq:5' } });
  assert.equal((await s3.fetchLyric(mtrack())).provenance[0].kind, 'primary');
  assert.equal(fc.get('qq', 'mid1'), null, '退回自动时不写缓存');
});

await test('chooseLyric：列过版本后选中不用重取（内存缓存）；别的歌不串；只改微调不删歌词缓存、不重取', async () => {
  const m = manualSetup();
  const cache = new api.LyricCache(path.join(tmp, 'c4'));
  const svc = new LyricService(m.map, cache, { amll: m.amll, appleMusic: m.apple }, newOverrides('o4'));
  await svc.listLyricVersions(mtrack());
  m.map.netease.fetchLyric = async () => null; // 之后网易云取不到：选中的只能来自内存缓存
  svc.chooseLyric(mtrack(), { pick: { platform: 'netease', sourceId: '900' } });
  const r = await svc.fetchLyric(mtrack());
  assert.deepEqual(r.provenance[0], { platform: 'netease', sourceId: '900', kind: 'manual' });
  assert.match(r.lrc, /网易云自带/);
  // 另一首歌没列过：同一来源不会用到这首的缓存，取不到就退回自动
  const other = song({ id: 'qq:mid2', sourceId: 'mid2', extra: { songId: 6 } });
  svc.chooseLyric(other, { pick: { platform: 'netease', sourceId: '900' } });
  assert.equal((await svc.fetchLyric(other)).provenance[0].kind, 'primary');
  // 只改微调：缓存还在，不重取
  assert.ok(cache.get('qq', 'mid1'));
  const before = m.stats.qqFetch;
  svc.chooseLyric(mtrack(), { pick: { platform: 'netease', sourceId: '900' }, offsetMs: 400 });
  assert.ok(cache.get('qq', 'mid1'), '只改微调不删缓存');
  await svc.fetchLyric(mtrack());
  assert.equal(m.stats.qqFetch, before);
});

await test('chooseLyric：来源变了会作废进行中的任务（迟到的旧结果不入缓存）', async () => {
  const cache = new api.LyricCache(path.join(tmp, 'c5'));
  let release;
  const gate = new Promise((r) => { release = r; });
  const map = { qq: { fetchLyric: async () => { await gate; return partialWords(0, MARK.qq); } }, netease: {}, kugou: {} };
  const svc = new LyricService(map, cache, {}, newOverrides('o5'));
  const pending = svc.fetchLyric(mtrack());
  await sleep(20);
  svc.chooseLyric(mtrack(), { pick: { platform: 'netease', sourceId: '900' } });
  release();
  assert.equal(await pending, null);
  assert.equal(cache.get('qq', 'mid1'), null);
});

/** 完整的合成歌词：行 / 逐字 / 翻译 / 罗马音 / 和声都有，lrc 类文本带时间。 */
const richLyric = () => {
  const lines = TEXTS.map((text, i) => ({ timeMs: TIMES[i], text, translation: '译文' + i, ...(i === 0 ? { agent: 'v1', bg: { text: '哦耶', words: [{ text: '哦', startMs: 2000, duration: 300 }, { text: '耶', startMs: 2300, duration: 200 }] } } : {}) }));
  const lrc = (f) => lines.map((l, i) => lrcAt(l.timeMs, f(l, i))).join('\n');
  return { raw: '', lines, lrc: lrc((l) => l.text), tlyric: lrc((l) => l.translation), translationRaw: lrc((l) => l.translation), romalrc: lrc((l, i) => 'roma' + i), romanRaw: lrc((l, i) => 'roma' + i), yrc: lines.map((l) => `[${l.timeMs},3000](${l.timeMs},1500,0)${l.text.slice(0, 3)}(${l.timeMs + 1500},1500,0)${l.text.slice(3)}`).join('\n') };
};

await test('时间微调：行 / 逐字 / lrc 类文本 / 和声词时间都平移，缓存里没平移，只改微调不重取', async () => {
  const dir = path.join(tmp, 'c6');
  let fetched = 0;
  const map = { qq: { fetchLyric: async () => { fetched++; return richLyric(); } }, netease: {}, kugou: {} };
  const cache = new api.LyricCache(dir), ov = new api.LyricOverrides(dir);
  const svc = new LyricService(map, cache, {}, ov);
  const plain = await svc.fetchLyric(mtrack());
  assert.deepEqual(plain.lines.map((l) => l.timeMs), TIMES);
  assert.equal(plain.lyricOffsetMs, undefined);
  svc.chooseLyric(mtrack(), { pick: null, offsetMs: 300 });
  const r = await svc.fetchLyric(mtrack());
  assert.equal(r.lyricOffsetMs, 300, '带出当前微调，前端据此写「推后 0.3 秒」');
  assert.deepEqual(r.lines.map((l) => l.timeMs), TIMES.map((t) => t + 300));
  assert.deepEqual(r.lines[0].bg.words.map((w) => w.startMs), [2300, 2600]);
  assert.equal(r.lines[0].agent, 'v1');
  assert.equal(r.yrc.split('\n')[0], '[1300,3000](1300,1500,0)编的第(2800,1500,0)一句话');
  for (const k of ['lrc', 'tlyric', 'translationRaw', 'romalrc', 'romanRaw']) {
    assert.deepEqual(r[k].split('\n').map((s) => s.slice(0, 10)), TIMES.map((t) => lrcAt(t + 300, '').slice(0, 10)), k);
    assert.equal(r[k].split('\n')[0].slice(10), richLyric()[k].split('\n')[0].slice(10), k + ' 内容不变');
  }
  assert.deepEqual(timedLines(r.yrc).map((l) => l.timeMs), TIMES.map((t) => t + 300));
  assert.equal(r.coverage.wordLines, 4, '覆盖率不因平移改变');
  // 缓存里是没平移的
  const stored = cache.get('qq', 'mid1');
  assert.deepEqual(stored.lines.map((l) => l.timeMs), TIMES);
  assert.equal(stored.yrc, richLyric().yrc);
  assert.equal(stored.lrc, richLyric().lrc);
  // 缓存命中的返回同样平移；改微调不重取、不删缓存；负数 = 提前
  svc.chooseLyric(mtrack(), { pick: null, offsetMs: -500 });
  const early = await svc.fetchLyric(mtrack());
  assert.deepEqual(early.lines.map((l) => l.timeMs), TIMES.map((t) => t - 500));
  assert.equal(early.lines[0].bg.words[0].startMs, 1500);
  assert.equal(fetched, 1);
  // 只传 pick 不传 offsetMs：微调保持
  svc.chooseLyric(mtrack(), { pick: null });
  assert.equal(ov.get('qq:mid1').offsetMs, -500);
  // 夹到 ±5 秒、取整到 0.1 秒；0 = 删掉这条；平移后小于 0 的行时间夹到 0
  svc.chooseLyric(mtrack(), { pick: null, offsetMs: 99999 });
  assert.equal(ov.get('qq:mid1').offsetMs, 5000);
  svc.chooseLyric(mtrack(), { pick: null, offsetMs: -5000 });
  const edge = await svc.fetchLyric(mtrack());
  assert.deepEqual(edge.lines.map((l) => l.timeMs), TIMES.map((t) => Math.max(0, t - 5000)));
  assert.equal(edge.lrc.split('\n')[0].slice(0, 10), '[00:00.000');
  svc.chooseLyric(mtrack(), { pick: null, offsetMs: 0 });
  assert.equal(ov.get('qq:mid1'), null);
  assert.deepEqual((await svc.fetchLyric(mtrack())).lines.map((l) => l.timeMs), TIMES);
  assert.equal(fetched, 1, '全程只取过一次');
  // 只有 qrc（没有 yrc）的歌词：平移后转成 yrc 带出
  const qrcOnly = { ...richLyric(), yrc: undefined, qrc: TEXTS.map((t, i) => `[${TIMES[i]},3000]${t}(${TIMES[i]},3000)`).join('\n') };
  const svc2 = new LyricService({ qq: { fetchLyric: async () => qrcOnly }, netease: {}, kugou: {} }, undefined, {}, newOverrides('o6b'));
  svc2.chooseLyric(mtrack(), { pick: null, offsetMs: 200 });
  const q = await svc2.fetchLyric(mtrack());
  assert.deepEqual(timedLines(q.yrc).map((l) => l.timeMs), TIMES.map((t) => t + 200));
  assert.equal(q.qrc, undefined);
});

await test('LyricOverrides：存取、重启保留、损坏文件当空、条数上限 2000 按时间淘汰、删除规则；LyricCache.delete', async () => {
  const dir = path.join(tmp, 'ov7');
  const ov = new api.LyricOverrides(dir);
  assert.equal(ov.get('qq:a'), null);
  ov.set('qq:a', { pick: { platform: 'netease', sourceId: '1' }, offsetMs: 300 });
  ov.set('qq:b', { offsetMs: -1234 });
  ov.set('qq:c', { pick: { platform: 'amll', sourceId: 'ncm:9' } });
  assert.deepEqual(ov.get('qq:a'), { pick: { platform: 'netease', sourceId: '1' }, offsetMs: 300 });
  assert.deepEqual(ov.get('qq:b'), { offsetMs: -1200 }, '取整到 0.1 秒');
  assert.deepEqual(ov.get('qq:c'), { pick: { platform: 'amll', sourceId: 'ncm:9' } });
  await ov.flush();
  const disk = JSON.parse(fs.readFileSync(path.join(dir, 'lyric-overrides.json'), 'utf8'));
  assert.equal(disk.schema, 1);
  assert.equal(Object.keys(disk.entries).length, 3);
  assert.ok(Number.isFinite(disk.entries['qq:a'].at));
  assert.deepEqual(new api.LyricOverrides(dir).get('qq:a'), ov.get('qq:a'), '重启保留');
  // 删除规则：null、或 pick 为空且 offset 为 0
  ov.set('qq:a', null);
  assert.equal(ov.get('qq:a'), null);
  ov.set('qq:b', { offsetMs: 0 });
  assert.equal(ov.get('qq:b'), null);
  ov.set('qq:c', { pick: { platform: 'amll', sourceId: 'ncm:9' }, offsetMs: 0 });
  assert.deepEqual(ov.get('qq:c'), { pick: { platform: 'amll', sourceId: 'ncm:9' } }, '还有 pick 就保留');
  ov.set('qq:c', { pick: undefined, offsetMs: 0 });
  assert.equal(ov.get('qq:c'), null);
  ov.set('qq:x', { offsetMs: 99999 });
  assert.equal(ov.get('qq:x').offsetMs, 5000);
  assert.equal(api.clampLyricOffset(7000), 5000);
  assert.equal(api.clampLyricOffset(-7000), -5000);
  assert.equal(api.clampLyricOffset(149), 100);
  assert.equal(api.clampLyricOffset(NaN), 0);
  assert.equal(api.clampLyricOffset('abc'), 0);
  // 条数上限
  const big = new api.LyricOverrides(path.join(tmp, 'ov7big'));
  for (let i = 0; i < 2005; i++) big.set(`k${i}`, { offsetMs: 100 });
  assert.equal(big.get('k0'), null);
  assert.equal(big.get('k4'), null);
  assert.ok(big.get('k5'));
  assert.ok(big.get('k2004'));
  await big.flush();
  assert.equal(Object.keys(JSON.parse(fs.readFileSync(path.join(tmp, 'ov7big', 'lyric-overrides.json'), 'utf8')).entries).length, 2000);
  // 损坏 / 旧版 / 类型不对的文件当空；坏条目跳过
  for (const [name, text] of [['junk', '{not json'], ['schema', JSON.stringify({ schema: 2, entries: { a: { at: 1, offsetMs: 100 } } })], ['entries', JSON.stringify({ schema: 1, entries: [] })]]) {
    const d = path.join(tmp, 'ov7-' + name);
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, 'lyric-overrides.json'), text);
    assert.equal(new api.LyricOverrides(d).get('a'), null, name);
  }
  const d2 = path.join(tmp, 'ov7-mixed');
  fs.mkdirSync(d2, { recursive: true });
  fs.writeFileSync(path.join(d2, 'lyric-overrides.json'), JSON.stringify({ schema: 1, entries: { good: { at: 1, offsetMs: 200 }, bad1: { at: 'x' }, bad2: { at: 1, pick: { platform: 1 } }, bad3: null } }));
  const mixed = new api.LyricOverrides(d2);
  assert.deepEqual(mixed.get('good'), { offsetMs: 200 });
  assert.equal(mixed.get('bad1'), null);
  assert.equal(mixed.get('bad2'), null);
  // LyricCache.delete
  const c = new api.LyricCache(path.join(tmp, 'ov7cache'));
  c.set('qq', 'z', { raw: '', lines: [] });
  assert.ok(c.get('qq', 'z'));
  c.delete('qq', 'z');
  assert.equal(c.get('qq', 'z'), null);
});

await test('IPC：nebula:lyric-versions / nebula:lyric-choose 参数校验，offset 缺省 = 保持，requestId 可取消', async () => {
  const handlers = new Map();
  const seen = [];
  const lyricService = {
    chooseLyric: (t, c) => seen.push([t.sourceId, c]),
    listLyricVersions: (t, signal, origin) => new Promise((resolve) => {
      seen.push(['list', t.sourceId, origin?.sourceId]);
      signal.addEventListener('abort', () => resolve({ pick: null, offsetMs: 0, versions: [] }), { once: true });
      if (t.sourceId === 'now') resolve({ pick: null, offsetMs: 0, versions: [{ platform: 'qq' }] });
    }),
  };
  registerIpcHandlers({ handle: (k, f) => handlers.set(k, f) }, { adapters: {}, cookies: {}, resolver: {}, lyricService, login: {}, audioProxy: {} });
  const choose = (p) => handlers.get('nebula:lyric-choose')(null, p);
  const t = { platform: 'qq', sourceId: 'mid1' };
  assert.deepEqual(await choose({ track: t, pick: { platform: 'netease', sourceId: '9' }, offsetMs: 300 }), { ok: true, data: true });
  assert.deepEqual(seen.at(-1), ['mid1', { pick: { platform: 'netease', sourceId: '9' }, offsetMs: 300 }]);
  assert.equal((await choose({ track: t, pick: null, offsetMs: 0 })).ok, true);
  assert.equal(seen.at(-1)[1].pick, null);
  assert.equal((await choose({ track: t, pick: null })).ok, true, 'offsetMs 缺省 = 保持');
  assert.equal(seen.at(-1)[1].offsetMs, undefined);
  for (const bad of [{ track: t, pick: { platform: 1, sourceId: 'x' } }, { track: t, pick: { platform: 'qq' } }, { track: t, pick: 'x' }, { track: t, pick: null, offsetMs: 'abc' }, { track: t, pick: null, offsetMs: NaN }, { track: t, pick: null, offsetMs: Infinity }, { pick: null }, { track: { platform: 1 }, pick: null }]) {
    assert.equal((await choose(bad)).ok, false, JSON.stringify(bad));
  }
  // 版本列表：origin 透传，requestId 取消
  const ev = {};
  const quick = await handlers.get('nebula:lyric-versions')(ev, { track: { ...t, sourceId: 'now' }, origin: { platform: 'spotify', sourceId: 'S' } });
  assert.equal(quick.data.versions.length, 1);
  assert.deepEqual(seen.at(-1), ['list', 'now', 'S']);
  const slow = handlers.get('nebula:lyric-versions')(ev, { track: t, requestId: 'req-1' });
  await sleep(10);
  await handlers.get('nebula:cancel-resolve')(ev, { requestId: 'req-1' });
  assert.deepEqual((await slow).data.versions, []);
});

fs.rmSync(tmp, { recursive: true, force: true });
say(`歌词新来源回归 ${passed}/${passed}`);
