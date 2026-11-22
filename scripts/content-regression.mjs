import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const b = require('../dist-main/index.cjs');
let n = 0;
const test = async (name, fn) => { await fn(); n++; console.log('通过 ' + name); };

/** 一首完整的曲目（录制身份字段齐全，便于 recordingMatch 通过）。 */
const track = (platform, over = {}) => ({
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

const comments = (count) => ({
  hot: Array.from({ length: count }, (_, i) => ({ id: `h${i}`, nickname: 'u', content: '好听', liked: 0 })),
  latest: [],
  total: count,
  hasMore: false,
});

await test('评论：本平台没有接口时，按同一录音转到网易云并标来源', async () => {
  const netease = {
    searchSongs: async () => [track('netease')],
    fetchComments: async () => comments(5),
  };
  const svc = new b.LyricService({ netease, kuwo: {} });
  const r = await svc.fetchComments(track('kuwo'), 0);
  assert.ok(r, '必须有结果');
  assert.equal(r.hot.length, 5);
  assert.equal(r.source.platform, 'netease');
  assert.equal(r.source.fallback, true, '跨平台取到的要标 fallback');
});

await test('评论：本平台有接口但返回空，也要转别家（不能给空白页）', async () => {
  const netease = { searchSongs: async () => [track('netease')], fetchComments: async () => comments(3) };
  const kuwo = { fetchComments: async () => ({ hot: [], latest: [], total: 0, hasMore: false }) };
  const svc = new b.LyricService({ netease, kuwo });
  const r = await svc.fetchComments(track('kuwo'), 0);
  assert.equal(r.source.platform, 'netease');
  assert.equal(r.source.fallback, true);
});

await test('评论：本平台有数据时不转（fallback=false）', async () => {
  let searched = false;
  const netease = { searchSongs: async () => { searched = true; return []; } };
  const kuwo = { fetchComments: async () => comments(8) };
  const svc = new b.LyricService({ netease, kuwo });
  const r = await svc.fetchComments(track('kuwo'), 0);
  assert.equal(r.hot.length, 8);
  assert.equal(r.source.fallback, false);
  assert.equal(searched, false, '本平台成功时不应再去搜别家');
});

await test('评论：第 2 页沿用第 0 页定下的来源，不来回切平台', async () => {
  const seen = [];
  const netease = {
    searchSongs: async () => [track('netease')],
    fetchComments: async (id, page) => { seen.push(`netease:${page}`); return comments(2); },
  };
  const kuwo = { fetchComments: async (id, page) => { seen.push(`kuwo:${page}`); return { hot: [], latest: [], total: 0, hasMore: false }; } };
  const svc = new b.LyricService({ netease, kuwo });
  await svc.fetchComments(track('kuwo'), 0);
  await svc.fetchComments(track('kuwo'), 1);
  // 第 1 页只能打网易云，不能又回到酷我
  assert.equal(seen.filter((s) => s.startsWith('kuwo')).length, 1, '酷我只在第 0 页问过一次');
  assert.ok(seen.includes('netease:1'));
});

await test('评论：两边都取不到时返回 null，不编造', async () => {
  const netease = { searchSongs: async () => [], fetchComments: async () => null };
  const svc = new b.LyricService({ netease, spotify: {} });
  assert.equal(await svc.fetchComments(track('spotify'), 0), null);
});

await test('歌曲详情：本平台没有详情接口时，按同一录音转到网易云，制作人员一起带过来', async () => {
  const netease = {
    searchSongs: async () => [track('netease')],
    fetchSongDetail: async () => ({
      platform: 'netease',
      title: '晴天',
      artists: [{ id: '1', name: '周杰伦' }],
      album: { id: 'a1', name: '叶惠美', cover: '' },
      credits: [{ role: '作词', name: '周杰伦' }, { role: '作曲', name: '周杰伦' }],
    }),
  };
  const svc = new b.LyricService({ netease, applemusic: {} });
  const d = await svc.fetchSongDetail(track('applemusic'), { withCredits: true });
  assert.ok(d, '必须有详情');
  assert.equal(d.album.name, '叶惠美');
  assert.equal(d.credits.length, 2);
  assert.equal(d.source.platform, 'netease');
  assert.equal(d.source.fallback, true);
});

await test('歌曲详情：本平台有详情时不转', async () => {
  const netease = {
    fetchSongDetail: async () => ({
      platform: 'netease',
      title: '晴天',
      artists: [{ id: '1', name: '周杰伦' }],
      album: { id: 'a1', name: '叶惠美', cover: '' },
      credits: [{ role: '作词', name: '周杰伦' }],
    }),
  };
  const svc = new b.LyricService({ netease });
  const d = await svc.fetchSongDetail(track('netease'), { withCredits: true });
  assert.equal(d.source.fallback, false);
  assert.equal(d.album.name, '叶惠美');
});

console.log(`内容页兜底回归 ${n}/${n}`);
