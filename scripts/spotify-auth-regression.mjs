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

fs.rmSync(dir, { recursive: true, force: true });
console.log(`Spotify 登录令牌回归 ${n}/${n}`);
