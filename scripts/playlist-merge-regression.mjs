/* 整合歌单回归测试：titleKeys / 跨平台去重 / VIP 选主源 / 磁盘持久化 / SongResolver 备用源直取 / IPC 全链路 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const api = require('../dist-main/index.cjs');

const makeTrack = (overrides = {}) => ({
  id: `${overrides.platform || 'qq'}:${overrides.sourceId || '1'}`,
  title: 'Test Song',
  artist: 'Singer A',
  album: 'Test Album',
  cover: 'https://example.com/c.jpg',
  duration: 210,
  platform: 'qq',
  sourceId: '1',
  originalUrl: '',
  fallbackUrl: '',
  ...overrides,
});

// 1. 繁简与日语新字体归一化 + 版本门禁不放松
assert.equal(api.identityText('高橋優'), api.identityText('高桥优'));
assert.equal(api.identityText('折戸伸治'), api.identityText('折户伸治'));
assert.equal(api.identityText('幾田りら'), api.identityText('几田りら'));
assert.equal(
  api.recordingMatch(
    makeTrack({ platform: 'qq', title: 'ヤキモチ (吃醋)', artist: '高桥优 (たかはし ゆう)', duration: 314 }),
    makeTrack({ platform: 'kugou', title: 'ヤキモチ (吃醋)', artist: '高橋優', duration: 314 }),
  ).ok,
  true,
  '高桥优 == 高橋優 应匹配',
);
assert.equal(
  api.recordingMatch(
    makeTrack({ platform: 'qq', title: '晴天', artist: '周杰伦', duration: 269 }),
    makeTrack({ platform: 'netease', title: '晴天 (Live)', artist: '周杰伦', duration: 269 }),
  ).ok,
  false,
  'Live 版本不得被整合误并',
);

// 2. titleKeys 分桶键覆盖跨文字译名括注与版本剥离
const keys = api.titleKeys(makeTrack({ title: 'なんでもないや (没什么大不了) (Movie ver.)' }));
assert.ok(keys.includes(api.identityText('なんでもないや')));
const bilingualKeys = api.titleKeys(makeTrack({ title: 'The Other Side (天堂彼岸) (Live)' }));
assert.ok(bilingualKeys.includes(api.identityText('The Other Side')));
assert.ok(bilingualKeys.includes(api.identityText('天堂彼岸')));

// 3. 按勾选顺序拼接 + 同/跨平台去重 + 原位置 VIP 升级 + altSources 留存
const merged = api.mergeTrackLists(
  [
    {
      source: { platform: 'ytmusic', id: 'pl-yt', name: 'YT Favorite', cover: 'https://example.com/yt.jpg' },
      tracks: [
        makeTrack({ platform: 'ytmusic', sourceId: 'yt-1', title: 'Lemon', artist: '米津玄師', duration: 255, cover: 'https://example.com/1.jpg' }),
        makeTrack({ platform: 'ytmusic', sourceId: 'yt-2', title: 'YT Only Track', artist: 'Solo', duration: 190, cover: 'https://example.com/2.jpg' }),
      ],
    },
    {
      source: { platform: 'qq', id: 'pl-qq', name: 'QQ 我喜欢', cover: 'https://example.com/qq.jpg' },
      tracks: [
        // Exact diff platform same recording -> should upgrade slot 0 in-place to QQ SVIP!
        makeTrack({ platform: 'qq', sourceId: 'qq-1', title: 'Lemon', artist: '米津玄師', duration: 255, cover: '' }),
        makeTrack({ platform: 'qq', sourceId: 'qq-3', title: '七里香', artist: '周杰伦', duration: 299, cover: 'https://example.com/3.jpg' }),
        // Same-platform same sourceId dupe
        makeTrack({ platform: 'qq', sourceId: 'qq-3', title: '七里香', artist: '周杰伦', duration: 299, cover: 'https://example.com/3.jpg' }),
      ],
    },
    {
      source: { platform: 'netease', id: 'pl-ne', name: '网易云红心' },
      tracks: [
        makeTrack({ platform: 'netease', sourceId: 'ne-1', title: 'Lemon', artist: '米津玄師', duration: 256, cover: 'https://example.com/ne1.jpg' }),
        makeTrack({ platform: 'netease', sourceId: 'ne-4', title: '晴天', artist: '周杰伦', duration: 269, cover: 'https://example.com/4.jpg' }),
      ],
    },
  ],
  {
    ytmusic: { loggedIn: true },
    qq: { loggedIn: true, isSvip: true },
    netease: { loggedIn: true, isVip: true },
  },
);

assert.equal(merged.tracks.length, 4, '7 条输入去重后应剩 4 首');
assert.equal(merged.stats.rawTotal, 7);
assert.equal(merged.stats.exactIdDupes, 1);
assert.equal(merged.stats.crossMatchDupes, 2);
assert.equal(merged.stats.dedupCount, 3);
assert.equal(merged.tracks[0].title, 'Lemon', '应保留首个勾选歌单的位置 0');
assert.equal(merged.tracks[0].platform, 'qq', '原位置应升级为主源最高权限的 QQ SVIP');
assert.equal(merged.tracks[0].sourceId, 'qq-1');
assert.equal(merged.tracks[0].cover, 'https://example.com/1.jpg', '高优源无封面时保留原封面');
assert.deepEqual(
  merged.tracks[0].altSources.map((a) => `${a.platform}:${a.sourceId}`),
  ['netease:ne-1', 'ytmusic:yt-1'],
  'altSources 应包含其余来源并按可播优先级排序',
);
assert.equal(merged.tracks[1].sourceId, 'yt-2');
assert.equal(merged.tracks[2].sourceId, 'qq-3');
assert.equal(merged.tracks[3].sourceId, 'ne-4');
assert.equal(merged.covers.length, 4, '应提取最多 4 张不同封面做拼贴');

// 4. 2000 首规模性能验证（应远小于 1500ms）
const bigA = Array.from({ length: 1000 }, (_, i) =>
  makeTrack({ platform: 'qq', sourceId: `big-q-${i}`, title: `Track ${i}`, artist: `Artist ${i % 50}`, duration: 180 + (i % 60) }),
);
const bigB = Array.from({ length: 1000 }, (_, i) =>
  makeTrack({ platform: 'netease', sourceId: `big-n-${i}`, title: `Track ${i < 400 ? i : 1000 + i}`, artist: `Artist ${i % 50}`, duration: 180 + (i % 60) }),
);
const t0 = Date.now();
const bigMerged = api.mergeTrackLists(
  [
    { source: { platform: 'qq', id: 'bigA', name: 'Big A' }, tracks: bigA },
    { source: { platform: 'netease', id: 'bigB', name: 'Big B' }, tracks: bigB },
  ],
  { qq: { loggedIn: true, isVip: true }, netease: { loggedIn: true } },
);
const elapsed = Date.now() - t0;
assert.equal(bigMerged.tracks.length, 1600);
assert.equal(bigMerged.stats.dedupCount, 400);
assert.ok(elapsed < 1500, `2000 首整合耗时过长: ${elapsed}ms`);

// 5. MergedPlaylistStore 磁盘读写与删改 + SongResolver altSources 快速通道（0 次 searchSongs）
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nebula-merged-test-'));
try {
  const store = new api.MergedPlaylistStore(tmpDir);
  store.save({
    id: 'm1',
    name: 'Test Mix',
    covers: merged.covers,
    sources: [{ platform: 'ytmusic', id: 'pl-yt', name: 'YT' }, { platform: 'qq', id: 'pl-qq', name: 'QQ' }],
    trackCount: merged.tracks.length,
    dedupCount: merged.stats.dedupCount,
    createdAt: 1000,
    updatedAt: 2000,
    tracks: merged.tracks,
  });

  const store2 = new api.MergedPlaylistStore(tmpDir);
  assert.equal(store2.list().length, 1);
  assert.equal('tracks' in store2.list()[0], false, 'list() 不得返回大体积 tracks');
  assert.equal(store2.get('m1').tracks.length, 4);
  assert.equal(store2.rename('m1', 'Renamed Mix').name, 'Renamed Mix');
  assert.equal(store2.get('m1').name, 'Renamed Mix');

  // SongResolver altSources fast-path test
  let searchCalls = 0;
  let fetchOrder = [];
  const fakeAdapters = {
    netease: {
      platform: 'netease',
      fetchSongUrl: async () => { fetchOrder.push('netease'); return null; },
      searchSongs: async () => { searchCalls++; return []; },
    },
    qq: {
      platform: 'qq',
      fetchSongUrl: async (songId) => {
        fetchOrder.push(`qq:${songId}`);
        return { url: 'https://cdn.example.com/ok.mp3', playable: true, quality: '320k' };
      },
      searchSongs: async () => { searchCalls++; return []; },
    },
    kugou: {
      platform: 'kugou',
      fetchSongUrl: async () => null,
      searchSongs: async () => { searchCalls++; return []; },
    },
    kuwo: { platform: 'kuwo', fetchSongUrl: async () => null, searchSongs: async () => { searchCalls++; return []; } },
    bodian: { platform: 'bodian', fetchSongUrl: async () => null, searchSongs: async () => { searchCalls++; return []; } },
    qishui: { platform: 'qishui', fetchSongUrl: async () => null },
    spotify: { platform: 'spotify', fetchSongUrl: async () => null },
    ytmusic: { platform: 'ytmusic', fetchSongUrl: async () => null },
    applemusic: { platform: 'applemusic', fetchSongUrl: async () => null },
  };
  const resolver = new api.SongResolver(fakeAdapters, () => {}, async () => true);
  const res = await resolver.resolve(
    makeTrack({
      platform: 'netease',
      sourceId: 'ne-dead',
      altSources: [{ platform: 'qq', sourceId: 'qq-known' }],
    }),
  );
  assert.equal(res.url, 'https://cdn.example.com/ok.mp3');
  assert.equal(res.platform, 'qq');
  assert.equal(res.sourceId, 'qq-known');
  assert.equal(res.fallback, true);
  assert.equal(searchCalls, 0, '命中 known altSources 时不得触发全网 searchSongs');
  assert.ok(res.timings.some((t) => t.stage === 'alt-source' && t.outcome === 'hit'));

  // 6. IPC 全链路（create -> list -> get -> refresh 失败保留原快照 -> refresh 成功 -> rename -> delete）
  let failPlaylistB = false;
  let bVersion = 1;
  const mockAdapters = {
    ...fakeAdapters,
    qq: {
      ...fakeAdapters.qq,
      fetchPlaylist: async (id) => ({
        id,
        platform: 'qq',
        name: 'QQ A',
        cover: 'https://example.com/qq-a.jpg',
        tracks: [makeTrack({ platform: 'qq', sourceId: 'a1', title: 'Alpha', artist: 'Art', duration: 200 })],
      }),
    },
    netease: {
      ...fakeAdapters.netease,
      fetchPlaylist: async (id) => {
        if (failPlaylistB) throw new Error('Cookie 过期');
        return {
          id,
          platform: 'netease',
          name: 'NE B',
          cover: 'https://example.com/ne-b.jpg',
          tracks: [
            makeTrack({ platform: 'netease', sourceId: 'b1', title: 'Alpha', artist: 'Art', duration: 200 }),
            ...(bVersion > 1
              ? [makeTrack({ platform: 'netease', sourceId: 'b2', title: 'Beta', artist: 'Art2', duration: 215 })]
              : []),
          ],
        };
      },
    },
  };

  const ipcHandlers = new Map();
  const mockIpc = { handle: (ch, fn) => ipcHandlers.set(ch, fn) };
  api.setCookieDataDir(tmpDir);
  const cookies = new api.CookieStore();
  api.registerIpcHandlers(mockIpc, {
    adapters: mockAdapters,
    resolver,
    lyricService: {},
    cookies,
    login: {},
    loginAdapters: {},
    audioProxy: { urlFor: (u) => u },
    mergedStore: new api.MergedPlaylistStore(tmpDir, 'ipc-merged.json'),
  });

  const invoke = (ch, payload) => ipcHandlers.get(ch)(null, payload);

  const created = await invoke('nebula:merged:create', {
    name: 'IPC Mix',
    sources: [
      { platform: 'qq', id: 'qa', name: 'QQ A' },
      { platform: 'netease', id: 'nb', name: 'NE B' },
    ],
    accounts: { qq: { loggedIn: true, isVip: true }, netease: { loggedIn: true } },
  });
  assert.equal(created.ok, true);
  assert.equal(created.data.playlist.trackCount, 1);
  assert.equal(created.data.stats.dedupCount, 1);
  const createdId = created.data.record.id;

  const listed = await invoke('nebula:merged:list');
  assert.equal(listed.ok, true);
  assert.equal(listed.data.length, 1);

  failPlaylistB = true;
  const failedRefresh = await invoke('nebula:merged:refresh', { id: createdId });
  assert.equal(failedRefresh.ok, false, '源歌单拉取失败时 refresh 必须显式报错');
  const preserved = await invoke('nebula:merged:get', { id: createdId });
  assert.equal(preserved.data.playlist.tracks.length, 1, 'refresh 失败不得覆盖原快照');

  failPlaylistB = false;
  bVersion = 2;
  const refreshed = await invoke('nebula:merged:refresh', { id: createdId });
  assert.equal(refreshed.ok, true);
  assert.equal(refreshed.data.playlist.tracks.length, 2, 'refresh 成功后应更新曲库数量');

  const renamed = await invoke('nebula:merged:rename', { id: createdId, name: 'IPC Mix v2' });
  assert.equal(renamed.data.name, 'IPC Mix v2');

  const removed = await invoke('nebula:merged:delete', { id: createdId });
  assert.equal(removed.data, true);
  const afterDelete = await invoke('nebula:merged:list');
  assert.equal(afterDelete.data.length, 0);

  console.log(`✔ playlist-merge-regression passed (2000 tracks merged in ${elapsed}ms)`);
} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}
