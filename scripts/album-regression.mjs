import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const b = require('../dist-main/index.cjs');
let n = 0;
const test = async (name, fn) => { await fn(); n++; console.log('通过 ' + name); };

// ── 专辑名匹配（纯函数）────────────────────────────────────────────
await test('专辑名匹配：去掉括注与标点后比较，包含关系也算', () => {
  assert.equal(b.albumTitleKey('范特西'), b.albumTitleKey('范特西 (Remastered)'));
  assert.equal(b.albumTitleKey('OK Computer'), 'ok computer');
});

await test('专辑歌手：多写法都认，不同歌手不认', () => {
  assert.equal(b.albumArtistHit('周杰伦', '周杰伦'), true);
  // 合作名单：一边写全
  assert.equal(b.albumArtistHit('周杰伦/费玉清', '周杰伦'), true);
  assert.equal(b.albumArtistHit('周杰伦', '周杰伦/费玉清'), true);
  // 频道名 / 后缀
  assert.equal(b.albumArtistHit('Jay Chou Official', 'Jay Chou'), true);
  // 完全不同的歌手
  assert.equal(b.albumArtistHit('YKFireVibes', '周杰伦'), false);
  // 空值不算对上（避免「没有歌手字段」被当成匹配）
  assert.equal(b.albumArtistHit('', '周杰伦'), false);
  assert.equal(b.albumArtistHit('周杰伦', undefined), false);
});

await test('专辑候选打分：同名同歌手排在同名不同歌手之前', () => {
  const albums = [
    { platform: 'netease', id: '1', name: '范特西 - 流行Pop x 周杰伦 Type Beat', cover: '', artist: 'YKFireVibes', year: 2025 },
    { platform: 'qq', id: '2', name: '范特西', cover: '', artist: '周杰伦', year: 2001, songCount: 10 },
    { platform: 'netease', id: '3', name: '范特西', cover: '', artist: 'PGXiao', year: 2024 },
  ];
  const ranked = b.rankAlbumCandidates(albums, { name: '范特西', artist: '周杰伦', year: 2001, songCount: 10 });
  assert.ok(ranked.length >= 2);
  assert.equal(ranked[0].album.id, '2', '真正的《范特西 / 周杰伦》必须排第一');
  assert.equal(ranked[0].artistHit, true);
  // 同名但歌手不对的仍保留在后面（降权不排除），名字只是包含的更不能挤到前面
  const others = ranked.slice(1).map((r) => r.album.id);
  assert.ok(others.includes('3'));
});

await test('专辑候选打分：名字只碰巧包含也要有资格，但排在完全同名后', () => {
  const albums = [
    { platform: 'netease', id: '1', name: '依然范特西', cover: '', artist: '周杰伦' },
    { platform: 'qq', id: '2', name: '范特西', cover: '', artist: '周杰伦' },
  ];
  const ranked = b.rankAlbumCandidates(albums, { name: '范特西', artist: '周杰伦' });
  assert.equal(ranked[0].album.id, '2');
});

await test('专辑候选打分：完全无关的专辑不进结果', () => {
  const albums = [{ platform: 'netease', id: '9', name: '完全不同的专辑', cover: '', artist: '周杰伦' }];
  assert.equal(b.rankAlbumCandidates(albums, { name: '范特西', artist: '周杰伦' }).length, 0);
});

// ── 专辑详情兜底（假适配器，不联网）──────────────────────────────────
/** 造一个最小的适配器替身；只实现被测到的方法。 */
const fakeAdapter = (over = {}) => ({
  fetchAlbumDetail: null,
  searchAlbums: null,
  ...over,
});

await test('专辑详情：本平台有曲目时不转译，标 fallback=false', async () => {
  const calls = [];
  const netease = fakeAdapter({
    fetchAlbumDetail: async (id) => ({ platform: 'netease', id, name: '范特西', cover: '', artist: '周杰伦', tracks: [{ title: '双截棍' }] }),
    searchAlbums: async () => { calls.push('netease-search'); return []; },
  });
  const svc = new b.LyricService({ netease, qq: fakeAdapter() });
  const d = await svc.fetchAlbumDetail('netease', '123');
  assert.equal(d.tracks.length, 1);
  assert.equal(d.source.fallback, false);
  assert.equal(d.source.platform, 'netease');
  assert.deepEqual(calls, [], '本平台成功时不应发起搜索');
});

await test('专辑详情：本平台没有详情接口（酷狗等）→ 按名字转到网易云，标来源', async () => {
  const netease = fakeAdapter({
    searchAlbums: async (kw) => {
      assert.equal(kw, '范特西');
      return [
        { platform: 'netease', id: 'bad', name: '范特西 - Type Beat', cover: '', artist: 'YKFireVibes' },
        { platform: 'netease', id: 'good', name: '范特西', cover: '', artist: '周杰伦' },
      ];
    },
    fetchAlbumDetail: async (id) => {
      // 先试到的是低价候选（Type Beat），取不到曲目；必须往下试到真正的《范特西》
      if (id === 'bad') return { platform: 'netease', id, name: '范特西 - Type Beat', cover: '', artist: 'YKFireVibes', tracks: [] };
      return { platform: 'netease', id, name: '范特西', cover: '', artist: '周杰伦', tracks: [{ title: '双截棍' }, { title: '简单爱' }] };
    },
  });
  const svc = new b.LyricService({ netease, qq: fakeAdapter(), kugou: fakeAdapter() });
  const d = await svc.fetchAlbumDetail('kugou', 'kg-album-1', { name: '范特西', artist: '周杰伦' });
  assert.ok(d, '必须拿到兜底结果');
  assert.equal(d.tracks.length, 2);
  assert.equal(d.source.platform, 'netease');
  assert.equal(d.source.fallback, true, '跨平台取到的要标 fallback');
});

await test('专辑详情：本平台取到空专辑时，用它的专辑名/歌手当线索兜底', async () => {
  const netease = fakeAdapter({
    searchAlbums: async () => [{ platform: 'netease', id: 'n1', name: '范特西', cover: '', artist: '周杰伦' }],
    fetchAlbumDetail: async (id) => ({ platform: 'netease', id, name: '范特西', cover: '', artist: '周杰伦', tracks: [{ title: '双截棍' }] }),
  });
  const qq = fakeAdapter({
    // QQ 返回了专辑信息，但曲目为空（下架 / 无版权）
    fetchAlbumDetail: async (id) => ({ platform: 'qq', id, name: '范特西', cover: '', artist: '周杰伦', tracks: [] }),
  });
  const svc = new b.LyricService({ netease, qq });
  const d = await svc.fetchAlbumDetail('qq', 'qq-mid');
  assert.equal(d.tracks.length, 1);
  assert.equal(d.source.platform, 'netease');
  assert.equal(d.source.fallback, true);
});

await test('专辑详情：两边都没有结果时如实返回本平台未标的空结果，不编造', async () => {
  const netease = fakeAdapter({ searchAlbums: async () => [], fetchAlbumDetail: async () => null });
  const qq = fakeAdapter({ searchAlbums: async () => [], fetchAlbumDetail: async () => ({ platform: 'qq', id: 'x', name: '不存在的专辑', cover: '', artist: '某某', tracks: [] }) });
  const svc = new b.LyricService({ netease, qq });
  const d = await svc.fetchAlbumDetail('qq', 'x');
  // 转译也搜不到时，原样交回本平台的空专辑（曲目 0 首），不伪造来自别家
  assert.equal(d.tracks.length, 0);
  assert.equal(d.source, undefined);
});

await test('专辑详情：兜底时不把别人的同名专辑认过来（歌手对不上且只是包含关系）', async () => {
  const netease = fakeAdapter({
    // 只有「范特西 - Type Beat」这种包含了名字的别人的专辑
    searchAlbums: async () => [{ platform: 'netease', id: 'x', name: '范特西 - Type Beat', cover: '', artist: 'YKFireVibes' }],
    fetchAlbumDetail: async (id) => ({ platform: 'netease', id, name: '范特西 - Type Beat', cover: '', artist: 'YKFireVibes', tracks: [{ title: '伴奏' }] }),
  });
  const svc = new b.LyricService({ netease, qq: fakeAdapter() });
  const d = await svc.fetchAlbumDetail('kugou', 'kg-1', { name: '范特西', artist: '周杰伦' });
  assert.equal(d, null, '歌手不对、名字只是包含的不能当兜底结果');
});

await test('专辑转译（resolveAlbumByTitle）：网易云搜不到时 QQ 顶上', async () => {
  const netease = fakeAdapter({ searchAlbums: async () => [] });
  const qq = fakeAdapter({
    searchAlbums: async (kw) => {
      assert.equal(kw, '范特西 周杰伦', 'QQ 用「专辑名 + 歌手」召回');
      return [{ platform: 'qq', id: 'mid1', name: '范特西', cover: '', artist: '周杰伦', year: 2001 }];
    },
  });
  const svc = new b.LyricService({ netease, qq });
  const a = await svc.resolveAlbumByTitle('范特西', '周杰伦');
  assert.equal(a.platform, 'qq');
  assert.equal(a.id, 'mid1');
});

await test('专辑转译：两家都搜不到返回 null', async () => {
  const svc = new b.LyricService({ netease: fakeAdapter({ searchAlbums: async () => [] }), qq: fakeAdapter({ searchAlbums: async () => [] }) });
  assert.equal(await svc.resolveAlbumByTitle('范特西', '周杰伦'), null);
});

await test('专辑转译：名字对不上但有同名包含时仍能选出来（歌手写法不同）', async () => {
  const netease = fakeAdapter({
    searchAlbums: async () => [{ platform: 'netease', id: 'n1', name: '范特西', cover: '', artist: '周杰倫' }],
  });
  const svc = new b.LyricService({ netease, qq: fakeAdapter({ searchAlbums: async () => [] }) });
  const a = await svc.resolveAlbumByTitle('范特西', '周杰伦');
  assert.equal(a?.id, 'n1', '繁体 / 简体歌手名要能对上');
});

await test('专辑转译：搜索接口抛错时另一家仍可用', async () => {
  const netease = fakeAdapter({ searchAlbums: async () => { throw new Error('boom'); } });
  const qq = fakeAdapter({ searchAlbums: async () => [{ platform: 'qq', id: 'q1', name: '范特西', cover: '', artist: '周杰伦' }] });
  const svc = new b.LyricService({ netease, qq });
  const a = await svc.resolveAlbumByTitle('范特西', '周杰伦');
  assert.equal(a?.id, 'q1');
});

console.log(`专辑页兜底回归 ${n}/${n}`);
