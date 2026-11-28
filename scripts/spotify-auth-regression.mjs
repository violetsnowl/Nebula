// Spotify 登录令牌：存储不能被按 Cookie 格式清洗成空串；请求带 Bearer、不带 Cookie 头（#170）
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url), api = require('../dist-main/index.cjs');
console.warn = () => {};
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nebula-spotify-'));
let n = 0;
const test = (name, fn) => Promise.resolve(fn()).then(() => { n++; console.log('通过 ' + name); });

await test('访问令牌原样保存（不含等号也不会被洗掉），重新读取后仍在', () => {
  const file = path.join(dir, 'c.json');
  const store = new api.CookieStore(file);
  store.set('spotify', 'BQAfixture.access-token_1', 'fixture-refresh', 'Spotify');
  assert.equal(store.get('spotify').cookies, 'BQAfixture.access-token_1');
  assert.equal(store.get('spotify').token, 'fixture-refresh');
  assert.equal(new api.CookieStore(file).get('spotify').cookies, 'BQAfixture.access-token_1');
});

await test('其他平台仍按 Cookie 头清洗', () => {
  const store = new api.CookieStore(path.join(dir, 'd.json'));
  store.set('netease', ' MUSIC_U=abc ;  __csrf=x ');
  assert.ok(!store.get('netease').cookies.startsWith(' '));
  assert.ok(store.get('netease').cookies.includes('MUSIC_U=abc'));
});

await test('请求 Spotify 带 Bearer，不把令牌塞进 Cookie 头', async () => {
  const store = new api.CookieStore(path.join(dir, 'e.json'));
  store.set('spotify', 'BQAfixture.token', 'r', 'Spotify');
  const http = new api.HttpClient(store);
  const seen = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init) => { seen.push(init.headers); return new Response('{"id":"u"}', { status: 200, headers: { 'Content-Type': 'application/json' } }); };
  try { await http.requestJson('https://api.spotify.com/v1/me', { platform: 'spotify' }); } finally { globalThis.fetch = real; }
  const h = Object.fromEntries(Object.entries(seen[0]).map(([k, v]) => [k.toLowerCase(), v]));
  assert.equal(h.authorization, 'Bearer BQAfixture.token');
  assert.equal(h.cookie, undefined);
});

await test('Spotify 自家查询服务的曲目：歌单（trackDuration）与点赞（duration）都能解析', () => {
  const art = { profile: { name: '甲' } };
  const cover = { sources: [{ url: 'https://i/s', width: 64, height: 64 }, { url: 'https://i/l', width: 640, height: 640 }] };
  const a = api.mapPathfinderTrack({ uri: 'spotify:track:0123456789abcdefghijkl', name: '歌', artists: { items: [art] }, albumOfTrack: { name: '专辑', coverArt: cover }, trackDuration: { totalMilliseconds: 262000 } });
  assert.deepEqual([a.id, a.title, a.artist, a.album, a.cover, a.duration], ['spotify:0123456789abcdefghijkl', '歌', '甲', '专辑', 'https://i/l', 262]);
  const b = api.mapPathfinderTrack({ name: '歌2', artists: { items: [art] }, albumOfTrack: { coverArt: cover }, duration: { totalMilliseconds: 1000 } }, 'spotify:track:abcdefghijkl0123456789');
  assert.equal(b.sourceId, 'abcdefghijkl0123456789'); assert.equal(b.duration, 1);
  assert.equal(api.mapPathfinderTrack({ name: '无效', uri: 'spotify:episode:x' }), null);
});

/** 假 Spotify：查询服务按令牌回 401 / 200，续期接口按 refresh_token 发新令牌（用过的作废）。 */
function fakeSpotify(store, { revoked = false } = {}) {
  const calls = { refresh: 0, query: 0 };
  const used = new Set();
  let gen = 0;
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    if (u.includes('accounts.spotify.com/api/token')) {
      calls.refresh++;
      const rt = new URLSearchParams(init.body).get('refresh_token');
      await new Promise((r) => setTimeout(r, 15));
      if (revoked || used.has(rt)) return new Response(JSON.stringify({ error: 'invalid_grant', error_description: 'Refresh token revoked' }), { status: 400 });
      used.add(rt); gen++;
      return new Response(JSON.stringify({ access_token: `access-${gen}`, refresh_token: `refresh-${gen}`, expires_in: 3600 }), { status: 200 });
    }
    calls.query++;
    const auth = Object.fromEntries(Object.entries(init.headers || {}).map(([k, v]) => [k.toLowerCase(), v])).authorization;
    if (auth === 'Bearer access-old') return new Response('{}', { status: 401 });
    return new Response(JSON.stringify({ data: { me: { profile: { username: 'u', name: '甲' } } } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  return { calls, restore: () => { globalThis.fetch = real; } };
}

await test('令牌过期时并发的几个请求只续一次，都拿到结果，新令牌写回', async () => {
  const store = new api.CookieStore(path.join(dir, 'f.json'));
  store.set('spotify', 'access-old', 'refresh-0', 'Spotify');
  const fake = fakeSpotify(store);
  try {
    const adapter = new api.SpotifyAdapter(new api.HttpClient(store), store);
    const results = await Promise.all([adapter.fetchMe(), adapter.fetchMe(), adapter.fetchMe()]);
    assert.ok(results.every((r) => r && r !== 'expired' && r.nickname === '甲'));
    assert.equal(fake.calls.refresh, 1);
    assert.equal(store.get('spotify').cookies, 'access-1');
    assert.equal(store.get('spotify').token, 'refresh-1');
  } finally { fake.restore(); }
});

await test('令牌写入超过 55 分钟：请求前先续，不先吃一次 401', async () => {
  const store = new api.CookieStore(path.join(dir, 'g.json'));
  store.set('spotify', 'access-old', 'refresh-0', 'Spotify');
  store.get('spotify').updatedAt = Date.now() - api.SPOTIFY_RENEW_AFTER_MS - 1000;
  const fake = fakeSpotify(store);
  try {
    const me = await new api.SpotifyAdapter(new api.HttpClient(store), store).fetchMe();
    assert.equal(me.nickname, '甲');
    assert.equal(fake.calls.refresh, 1);
    assert.equal(fake.calls.query, 1);
  } finally { fake.restore(); }
});

await test('续期令牌已被吊销（invalid_grant）：判为登录已过期，令牌不被改写', async () => {
  const store = new api.CookieStore(path.join(dir, 'h.json'));
  store.set('spotify', 'access-old', 'refresh-0', 'Spotify');
  const fake = fakeSpotify(store, { revoked: true });
  try {
    assert.equal(await new api.SpotifyAdapter(new api.HttpClient(store), store).fetchMe(), 'expired');
    assert.equal(store.get('spotify').token, 'refresh-0');
  } finally { fake.restore(); }
});

await test('Spotify pathfinder 搜索（歌 / 歌手 / 专辑）与专辑 / 歌手详情（#322）', async () => {
  const store = new api.CookieStore(path.join(dir, 'i.json'));
  store.set('spotify', 'access-ok', 'refresh-ok', 'Spotify');
  const real = globalThis.fetch;
  let overviewCalls = 0;
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(String(init?.body || '{}'));
    const op = body.operationName;
    if (op === 'searchTracks') {
      return new Response(JSON.stringify({
        data: { searchV2: { tracksV2: { items: [{ item: { data: {
          uri: 'spotify:track:1BxfuPKGuaTgP7aM0Bbdwr', name: 'Cruel Summer',
          artists: { items: [{ profile: { name: 'Taylor Swift' } }] },
          albumOfTrack: { name: 'Lover', coverArt: { sources: [{ url: 'https://i/640', width: 640, height: 640 }] } },
          duration: { totalMilliseconds: 178426 },
        } } }] } } },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (op === 'searchArtists') {
      return new Response(JSON.stringify({
        data: { searchV2: { artists: { items: [{ data: {
          uri: 'spotify:artist:06HL4z0CvFAxyc27GXpf02', profile: { name: 'Taylor Swift' },
          visuals: { avatarImage: { sources: [{ url: 'https://i/av', width: 640, height: 640 }] } },
        } }] } } },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (op === 'searchAlbums') {
      return new Response(JSON.stringify({
        data: { searchV2: { albumsV2: { items: [{ data: {
          uri: 'spotify:album:1NAmidJlEaVgA3MpcPFYGq', name: 'Lover', date: { year: 2019 },
          coverArt: { sources: [{ url: 'https://i/alb', width: 640, height: 640 }] },
          artists: { items: [{ profile: { name: 'Taylor Swift' } }] },
        } }] } } },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (op === 'getAlbum') {
      return new Response(JSON.stringify({
        data: { albumUnion: {
          name: 'Lover', date: { isoString: '2019-08-23T00:00:00Z' },
          coverArt: { sources: [{ url: 'https://i/alb', width: 640, height: 640 }] },
          artists: { items: [{ profile: { name: 'Taylor Swift' } }] },
          tracksV2: { items: [{ track: {
            uri: 'spotify:track:1BxfuPKGuaTgP7aM0Bbdwr', name: 'Cruel Summer',
            artists: { items: [{ profile: { name: 'Taylor Swift' } }] },
            duration: { totalMilliseconds: 178426 },
          } }] },
        } },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (op === 'queryArtistOverview') {
      overviewCalls++;
      return new Response(JSON.stringify({
        data: { artistUnion: {
          profile: { name: 'Taylor Swift', biography: { text: '<p>Bio</p>' } },
          visuals: { avatarImage: { sources: [{ url: 'https://i/av', width: 640, height: 640 }] } },
          discography: {
            topTracks: { items: [{ track: { uri: 'spotify:track:1BxfuPKGuaTgP7aM0Bbdwr', name: 'Cruel Summer', artists: { items: [{ profile: { name: 'Taylor Swift' } }] }, duration: { totalMilliseconds: 178426 } } }] },
            albums: { items: [{ releases: { items: [{ uri: 'spotify:album:1NAmidJlEaVgA3MpcPFYGq', name: 'Lover', date: { year: 2019 }, tracks: { totalCount: 18 }, coverArt: { sources: [{ url: 'https://i/alb', width: 640, height: 640 }] } }] } }] },
          },
        } },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response('{}', { status: 404 });
  };
  try {
    const ad = new api.SpotifyAdapter(new api.HttpClient(store), store);
    const songs = await ad.searchSongs('Cruel Summer', 5);
    assert.equal(songs.length, 1); assert.equal(songs[0].title, 'Cruel Summer');
    const arts = await ad.searchArtists('Taylor', 5);
    assert.equal(arts.length, 1); assert.equal(arts[0].avatar, 'https://i/av');
    const albs = await ad.searchAlbums('Lover', 5);
    assert.equal(albs.length, 1); assert.equal(albs[0].year, 2019);
    const det = await ad.fetchAlbumDetail('1NAmidJlEaVgA3MpcPFYGq');
    assert.equal(det.name, 'Lover'); assert.equal(det.tracks[0].album, 'Lover'); assert.equal(det.tracks[0].cover, 'https://i/alb');
    const [info, top, aAlbs] = await Promise.all([
      ad.fetchArtistInfo('06HL4z0CvFAxyc27GXpf02'),
      ad.fetchArtistSongs('06HL4z0CvFAxyc27GXpf02'),
      ad.fetchArtistAlbums('06HL4z0CvFAxyc27GXpf02'),
    ]);
    assert.equal(info.description, 'Bio');
    assert.equal(top.length, 1);
    assert.equal(aAlbs.length, 1);
    assert.ok(overviewCalls <= 3);
    // 再次调用应命中 60s 缓存
    await ad.fetchArtistInfo('06HL4z0CvFAxyc27GXpf02');
    const afterCache = overviewCalls;
    await ad.fetchArtistAlbums('06HL4z0CvFAxyc27GXpf02');
    assert.equal(overviewCalls, afterCache, '歌手总览应命中进程内缓存');
  } finally { globalThis.fetch = real; }
});

fs.rmSync(dir, { recursive: true, force: true });
console.log(`Spotify 登录令牌回归 ${n}/${n}`);
