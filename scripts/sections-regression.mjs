// 段落引擎回归（src/lib/listen/sections.ts）：副歌 / 预副歌 / 桥段 / 尾声、连唱两遍副歌、单句反复的副歌、
// 间奏、句组大小、某一时刻的舞台状态。全部用合成歌词，离线。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { buildSync } from 'esbuild';

const require = createRequire(import.meta.url);
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'nebula-sections-test-'));
buildSync({ entryPoints: ['src/lib/listen/sections.ts'], bundle: true, platform: 'node', format: 'cjs', outfile: path.join(temp, 'sections.cjs'), logLevel: 'error' });
const S = require(path.join(temp, 'sections.cjs'));

/** 按段落拼歌词：每句 3 秒、句间 0.3 秒；段落之间可插入空档（秒）。 */
function song(parts) {
  const lines = [];
  let t = 1;
  for (const p of parts) {
    if (typeof p === 'number') {
      t += p;
      continue;
    }
    for (const text of p) {
      lines.push({ s: t, e: t + 3, text });
      t += 3.3;
    }
  }
  return lines;
}
const seq = (shape) => shape.sections.map((s) => s.kind[0].toUpperCase() + (s.to - s.from + 1)).join(' ');
/** 互不相似的主歌句子：带种子的伪随机字母（mulberry32），每次运行一样。 */
let seed = 20261122;
const rand = () => {
  seed = (seed + 0x6d2b79f5) >>> 0;
  let t = seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const word = () => Array.from({ length: 3 + Math.floor(rand() * 5) }, () => String.fromCharCode(97 + Math.floor(rand() * 26))).join('');
const verse = (tag, k = 4) => Array.from({ length: k }, () => Array.from({ length: 5 }, word).join(' '));
const CHORUS = ['we are the light tonight', 'burning through the dark', 'hold on to the fire', 'never let it go'];
const PRE = ['and the city falls asleep', 'i can hear you calling'];

let count = 0;
const test = (name, fn) => {
  fn();
  count++;
  console.log('通过 ' + name);
};

try {
  test('主歌-预副歌-副歌-主歌-预副歌-副歌-桥段-副歌-尾声', () => {
    const lines = song([verse('first'), PRE, CHORUS, verse('second'), PRE, CHORUS, verse('bridge', 3), CHORUS, ['fade away now']]);
    const sh = S.analyzeSong(lines);
    assert.equal(sh.confident, true);
    assert.equal(seq(sh), 'V4 P2 C4 V4 P2 C4 B3 C4 O1');
    const ch = sh.sections.filter((s) => s.kind === 'chorus');
    assert.deepEqual(ch.map((s) => [s.occ, s.of]), [[0, 3], [1, 3], [2, 3]]);
    // 越往后越开，最后一次副歌开到最大
    assert.ok(ch[0].lift < ch[1].lift && ch[1].lift < ch[2].lift);
    assert.equal(ch[2].lift, 1);
    const v = sh.sections.find((s) => s.kind === 'verse');
    assert.ok(v.lift < sh.sections.find((s) => s.kind === 'pre').lift);
  });

  test('结尾连唱两遍副歌切成两次出现', () => {
    const lines = song([verse('a'), CHORUS, verse('b'), CHORUS, CHORUS]);
    const sh = S.analyzeSong(lines);
    assert.equal(seq(sh), 'V4 C4 V4 C4 C4');
    assert.equal(sh.sections.at(-1).occ, 2);
  });

  test('同一句反复唱的副歌不会被切成一句一段', () => {
    const hook = ['oh let it burn', 'oh let it burn', 'oh let it burn', 'oh let it burn'];
    const lines = song([verse('a'), hook, verse('b'), hook]);
    const sh = S.analyzeSong(lines);
    assert.equal(seq(sh), 'V4 C4 V4 C4');
  });

  test('个别字不同的副歌仍算同一段（相似度 ≥ .8）', () => {
    const variant = ['we are the light tonight yeah', 'burning through the dark', 'hold on to the fire', 'never let it go'];
    const sh = S.analyzeSong(song([verse('a'), CHORUS, verse('b'), variant]));
    assert.equal(seq(sh), 'V4 C4 V4 C4');
  });

  test('没有成段重复：不认副歌，全部按主歌、开合平稳', () => {
    const sh = S.analyzeSong(song([verse('a', 5), verse('b', 5), verse('c', 5)]));
    assert.equal(sh.confident, false);
    assert.ok(sh.sections.every((s) => s.kind === 'verse' && s.lift === 0.25));
  });

  test('前奏、间奏、尾奏（≥ 4 秒）', () => {
    const lines = song([6, verse('a'), 8, CHORUS, verse('b'), CHORUS]);
    const end = lines.at(-1).e;
    const sh = S.analyzeSong(lines, end + 10);
    assert.deepEqual(sh.gaps.map((g) => g.kind), ['intro', 'interlude', 'tail']);
    assert.ok(Math.abs(sh.gaps[1].e - sh.gaps[1].s - 8.3) < 1e-6);
  });

  test('句组：最多 6 句，段内孤句并进相邻句组', () => {
    // 12 句一段、中间一句前后都有停顿
    const long = song([verse('long', 5), 2.5, ['lonely line in between'], 2.5, verse('more', 6)]);
    const sh = S.analyzeSong(long);
    for (const st of sh.stanzas) assert.ok(st.to - st.from + 1 <= 6);
    assert.ok(sh.stanzas.every((st) => st.to > st.from), '不应有孤句句组');
    // 每句都有句组，且句组按顺序首尾相接
    let next = 0;
    for (const st of sh.stanzas) {
      assert.equal(st.from, next);
      next = st.to + 1;
    }
    assert.equal(next, long.length);
  });

  test('舞台状态：进副歌前开始打开，间奏中让位、下一句前收回', () => {
    const lines = song([verse('a'), 10, CHORUS, verse('b'), CHORUS]);
    const sh = S.analyzeSong(lines);
    const gap = sh.gaps.find((g) => g.kind === 'interlude');
    const mid = (gap.s + gap.e) / 2;
    assert.ok(S.stageAt(sh, lines, mid).gap > 0.95, '间奏中段完全让位');
    assert.equal(S.stageAt(sh, lines, gap.s + 0.1).gap, 0, '刚唱完不立刻让位');
    assert.equal(S.stageAt(sh, lines, gap.e).gap, 0, '下一句开唱时已收回');
    const ch = sh.sections.find((s) => s.kind === 'chorus');
    const before = S.stageAt(sh, lines, ch.s - 2).lift;
    const inside = S.stageAt(sh, lines, ch.s + 2).lift;
    assert.ok(inside > before + 0.3, '副歌比主歌开');
    assert.equal(S.stageAt(sh, lines, ch.s + 2).section, sh.lineSection[ch.from]);
  });

  test('空歌词不报错', () => {
    const sh = S.analyzeSong([]);
    assert.equal(sh.sections.length, 0);
    assert.equal(S.stageAt(sh, [], 3).section, -1);
  });

  console.log(`段落引擎回归全部通过（${count} 项）`);
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
