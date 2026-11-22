import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const b = require('../dist-main/index.cjs');
let n = 0;
const test = async (name, fn) => { await fn(); n++; console.log('通过 ' + name); };

/** 搜歌替身：只实现 searchSongs。 */
const songAdapter = (platform, titles, delay = 0) => ({
  searchSongs: async (kw, pageSize) => {
    if (delay) await new Promise((r) => setTimeout(r, delay));
    return titles.slice(0, pageSize).map((t, i) => ({
      id: `${platform}:${i}`,
      platform,
      sourceId: `${platform}-${i}`,
      title: t,
      artist: `${platform} 歌手`,
      album: '',
      cover: '',
      duration: 200,
    }));
  },
});

/** 歌手替身：只实现 searchArtists。 */
const artistAdapter = (platform, names) => ({
  searchArtists: async (kw, pageSize) =>
    names.slice(0, pageSize).map((name, i) => ({ platform, id: `${platform}-${i}`, name, avatar: '' })),
});

await test('搜歌：六个平台都参与，结果按平台交错', async () => {
  const svc = new b.LyricService({
    netease: songAdapter('netease', ['A1', 'A2', 'A3']),
    qq: songAdapter('qq', ['B1', 'B2', 'B3']),
    kugou: songAdapter('kugou', ['C1', 'C2', 'C3']),
    kuwo: songAdapter('kuwo', ['D1', 'D2', 'D3']),
    bodian: songAdapter('bodian', ['E1', 'E2', 'E3']),
  });
  const list = await svc.searchSongs('测试', 6);
  const platforms = new Set(list.map((t) => t.platform));
  assert.equal(list.length, 6);
  assert.equal(platforms.size, 5, '五个平台都要有');
  // 前五条必须一家一条（交错），不能某家连占
  assert.equal(new Set(list.slice(0, 5).map((t) => t.platform)).size, 5);
});

await test('搜歌：快的平台不能把慢的平台挤掉', async () => {
  const svc = new b.LyricService({
    netease: songAdapter('netease', ['慢歌1', '慢歌2', '慢歌3'], 40),
    kugou: songAdapter('kugou', ['快歌1', '快歌2', '快歌3'], 0),
    kuwo: songAdapter('kuwo', ['快歌4', '快歌5', '快歌6'], 0),
  });
  const list = await svc.searchSongs('测试', 6);
  assert.ok(list.some((t) => t.platform === 'netease'), '慢的网易云也要出现');
});

await test('搜歌：单家抛错不影响其他家', async () => {
  const svc = new b.LyricService({
    netease: { searchSongs: async () => { throw new Error('boom'); } },
    qq: songAdapter('qq', ['B1']),
  });
  const list = await svc.searchSongs('测试', 6);
  assert.ok(list.length >= 1);
  assert.equal(list[0].platform, 'qq');
});

await test('搜歌：没有 searchSongs 的适配器被跳过，不报错', async () => {
  const svc = new b.LyricService({ netease: songAdapter('netease', ['A1']), kugou: {} });
  const list = await svc.searchSongs('测试', 6);
  assert.equal(list.length, 1);
});

await test('搜歌：去重后不会出现同一个 id 两次', async () => {
  const dup = songAdapter('qq', ['同一首', '同一首']);
  dup.searchSongs = async () => [
    { id: 'qq:x', platform: 'qq', sourceId: 'x', title: '同一首', artist: 'A', album: '', cover: '', duration: 200 },
    { id: 'qq:x', platform: 'qq', sourceId: 'x', title: '同一首', artist: 'A', album: '', cover: '', duration: 200 },
  ];
  const svc = new b.LyricService({ qq: dup });
  const list = await svc.searchSongs('测试', 6);
  assert.equal(list.length, 1);
});

await test('搜歌：命中词的 <em> 高亮标签被清掉', async () => {
  const svc = new b.LyricService({
    qq: { searchSongs: async () => [{ id: 'q1', platform: 'qq', sourceId: 'q1', title: '<em>晴天</em>', artist: '<em>周杰伦</em>', album: '', cover: '', duration: 200 }] },
  });
  const list = await svc.searchSongs('测试', 6);
  assert.equal(list[0].title, '晴天');
  assert.equal(list[0].artist, '周杰伦');
});

await test('搜歌手：酷狗参与（#224）', async () => {
  const svc = new b.LyricService({
    netease: artistAdapter('netease', ['网易云结果']),
    qq: artistAdapter('qq', ['QQ结果']),
    kugou: artistAdapter('kugou', ['酷狗结果']),
  });
  const list = await svc.searchArtists('周杰伦', 5);
  assert.equal(list.length, 3);
  assert.ok(list.some((a) => a.platform === 'kugou'));
});

await test('搜歌手：单家抛错不影响其他家', async () => {
  const svc = new b.LyricService({
    netease: { searchArtists: async () => { throw new Error('boom'); } },
    qq: artistAdapter('qq', ['QQ结果']),
  });
  const list = await svc.searchArtists('测试', 5);
  assert.equal(list.length, 1);
});

console.log(`在线搜索回归 ${n}/${n}`);
