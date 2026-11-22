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
  const groups = await svc.searchSongs('测试', 6);
  assert.equal(groups.length, 6);
  assert.equal(new Set(groups.map((g) => g.primary.platform)).size, 5, '五个平台都要有');
});

await test('搜歌：快的平台不能把慢的平台挤掉', async () => {
  const svc = new b.LyricService({
    netease: songAdapter('netease', ['慢歌1', '慢歌2', '慢歌3'], 40),
    kugou: songAdapter('kugou', ['快歌1', '快歌2', '快歌3'], 0),
    kuwo: songAdapter('kuwo', ['快歌4', '快歌5', '快歌6'], 0),
  });
  const groups = await svc.searchSongs('测试', 6);
  assert.ok(groups.some((g) => g.sources.some((s) => s.platform === 'netease')), '慢的网易云也要出现');
});

await test('搜歌：单家抛错不影响其他家', async () => {
  const svc = new b.LyricService({
    netease: { searchSongs: async () => { throw new Error('boom'); } },
    qq: songAdapter('qq', ['B1']),
  });
  const groups = await svc.searchSongs('测试', 6);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].primary.platform, 'qq');
});

await test('搜歌：没有 searchSongs 的适配器被跳过，不报错', async () => {
  const svc = new b.LyricService({ netease: songAdapter('netease', ['A1']), kugou: {} });
  const groups = await svc.searchSongs('测试', 6);
  assert.equal(groups.length, 1);
});

await test('搜歌：同一平台重复条目在合并后只算一个来源', async () => {
  const dup = songAdapter('qq', ['同一首', '同一首']);
  dup.searchSongs = async () => [
    { id: 'qq:x', platform: 'qq', sourceId: 'x', title: '同一首', artist: 'A', album: '', cover: '', duration: 200 },
    { id: 'qq:x', platform: 'qq', sourceId: 'x', title: '同一首', artist: 'A', album: '', cover: '', duration: 200 },
  ];
  const svc = new b.LyricService({ qq: dup });
  const groups = await svc.searchSongs('测试', 6);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].sources.length, 1);
});

await test('搜歌：命中词的 <em> 高亮标签被清掉', async () => {
  const svc = new b.LyricService({
    qq: { searchSongs: async () => [{ id: 'q1', platform: 'qq', sourceId: 'q1', title: '<em>晴天</em>', artist: '<em>周杰伦</em>', album: '', cover: '', duration: 200 }] },
  });
  const groups = await svc.searchSongs('测试', 6);
  assert.equal(groups[0].primary.title, '晴天');
  assert.equal(groups[0].primary.artist, '周杰伦');
});

// ── 搜歌：同一录音合并（#227）────────────────────────────────────────
const song = (platform, over = {}) => ({
  id: `${platform}:x`,
  platform,
  sourceId: `${platform}-x`,
  title: '晴天',
  artist: '周杰伦',
  album: '叶惠美',
  cover: '',
  duration: 269,
  ...over,
});

await test('合并：同一首歌在五个平台只出现一条，来源都在且按平台排序', async () => {
  const svc = new b.LyricService({
    netease: { searchSongs: async () => [song('netease', { sourceId: 'n1' })] },
    qq: { searchSongs: async () => [song('qq', { sourceId: 'q1' })] },
    kugou: { searchSongs: async () => [song('kugou', { sourceId: 'k1' })] },
    kuwo: { searchSongs: async () => [song('kuwo', { sourceId: 'u1' })] },
    bodian: { searchSongs: async () => [song('bodian', { sourceId: 'b1' })] },
  });
  const groups = await svc.searchSongs('晴天', 8);
  assert.equal(groups.length, 1, '五条同一录音必须并成一条');
  assert.deepEqual(
    groups[0].sources.map((s) => s.platform),
    ['netease', 'qq', 'kugou', 'kuwo', 'bodian'],
    '组内按平台偏好排序',
  );
  assert.equal(groups[0].primary.platform, 'netease', '默认来源是排序第一的那家');
});

await test('合并：Live 版不会被并进录音室版', async () => {
  const svc = new b.LyricService({
    netease: { searchSongs: async () => [song('netease', { sourceId: 'n1' })] },
    qq: { searchSongs: async () => [song('qq', { sourceId: 'q1', title: '晴天 (Live)' })] },
  });
  const groups = await svc.searchSongs('晴天', 8);
  assert.equal(groups.length, 2, '版本不同必须分开');
});

await test('合并：不同歌手不合并', async () => {
  const svc = new b.LyricService({
    netease: { searchSongs: async () => [song('netease', { sourceId: 'n1' })] },
    kugou: { searchSongs: async () => [song('kugou', { sourceId: 'k1', artist: '舟子' })] },
  });
  const groups = await svc.searchSongs('晴天', 8);
  assert.equal(groups.length, 2);
});

await test('合并：时长差得多的（同名不同录音）不合并', async () => {
  const svc = new b.LyricService({
    netease: { searchSongs: async () => [song('netease', { sourceId: 'n1', duration: 269 })] },
    kugou: { searchSongs: async () => [song('kugou', { sourceId: 'k1', duration: 205 })] },
  });
  const groups = await svc.searchSongs('晴天', 8);
  assert.equal(groups.length, 2);
});

await test('合并：pageSize 按合并后的条目数算，不按原始条数', async () => {
  const one = (platform, id) => ({ searchSongs: async () => [song(platform, { sourceId: id })] });
  const svc = new b.LyricService({
    netease: one('netease', 'n1'),
    qq: one('qq', 'q1'),
    kugou: one('kugou', 'k1'),
    kuwo: one('kuwo', 'u1'),
    bodian: one('bodian', 'b1'),
  });
  const groups = await svc.searchSongs('晴天', 3);
  assert.equal(groups.length, 1, '五个来源合并后只有一条，不能因为原始 5 条就被截断');
});

await test('合并：纯函数 groupSearchResults 与接口结果一致', async () => {
  const groups = b.groupSearchResults(
    [song('kuwo', { sourceId: 'u' }), song('netease', { sourceId: 'n' }), song('qq', { sourceId: 'q' })],
    10,
  );
  assert.equal(groups.length, 1);
  assert.equal(groups[0].primary.platform, 'netease');
  assert.deepEqual(groups[0].sources.map((s) => s.platform), ['netease', 'qq', 'kuwo']);
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

await test('搜歌手：近似同名一律保留，不合并（用户 2026-11-21 定）', async () => {
  const svc = new b.LyricService({
    netease: artistAdapter('netease', ['周杰伦', '周杰伦.', '周杰伦♚']),
    kugou: artistAdapter('kugou', ['周杰伦']),
  });
  const list = await svc.searchArtists('周杰伦', 8);
  assert.equal(list.length, 4, '三条网易云 + 一条酷狗全部保留，可能是不同的人');
  assert.equal(list.filter((a) => a.name === '周杰伦').length, 2, '同名但平台不同也各留一条');
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
