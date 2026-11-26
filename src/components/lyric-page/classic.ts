import type { SectionKind } from '../../lib/listen/sections';
import { PH, PW, type Place, type Tpl } from './types';

/** 经典版式（样张 M）：只给每句一个位置和字号。原来在 LyricPage.tsx 里，样张 N 起挪到这里。 */

const stackTop = (n: number, step: number, fs: number) => PH / 2 - ((n - 1) * step) / 2 - fs * 0.6;

// ———— 横排 ————
const H: Record<string, Tpl> = {
  // 左栏：左对齐一栏，翻译作旁注排在右栏
  left: { id: 'left', place: (i, n, f) => ({ left: 190, top: stackTop(n, 80 * f, 42 * f) + i * 80 * f, fs: 42 * f, tr: 'side' }), room: () => 950 },
  // 右栏：右对齐一栏，翻译排在下面
  right: { id: 'right', place: (i, n, f) => ({ right: 190, top: stackTop(n, 96 * f, 44 * f) + i * 96 * f, fs: 44 * f, tr: 'under' }), room: () => 1150 },
  // 居中轴
  axis: { id: 'axis', place: (i, n, f) => ({ center: true, top: stackTop(n, 100 * f, 48 * f) + i * 100 * f, fs: 48 * f, tr: 'under' }), room: () => 1250 },
  // 阶梯：每行往右错开
  stairs: { id: 'stairs', place: (i, n, f) => ({ left: 190 + i * 56, top: stackTop(n, 108 * f, 64 * f) + i * 108 * f, fs: 64 * f, tr: 'under' }), room: (i) => PW - 150 - (190 + i * 56) },
  // 反阶梯：右对齐，每行往左错开
  stairsR: { id: 'stairsR', place: (i, n, f) => ({ right: 190 + i * 56, top: stackTop(n, 108 * f, 64 * f) + i * 108 * f, fs: 64 * f, tr: 'under' }), room: (i) => PW - 150 - (190 + i * 56) },
  // 首句大字：第一句压满一行，其余小字跟在下面
  headline: {
    id: 'headline',
    place: (i, n, f) => {
      if (i === 0) return { left: 180, top: 210 - (n > 4 ? 40 : 0), fs: 88 * f, tr: 'under' };
      return { left: 190, top: 210 - (n > 4 ? 40 : 0) + 150 * f + (i - 1) * 66 * f, fs: 34 * f, tr: 'side' };
    },
    room: (i) => (i === 0 ? PW - 330 : 950),
  },
  // 上下分置：前半句组在左上，后半在右下
  split: {
    id: 'split',
    place: (i, n, f) => {
      const h = Math.ceil(n / 2);
      if (i < h) return { left: 190, top: 190 + i * 82 * f, fs: 44 * f, tr: 'under' };
      return { right: 190, top: PH - 150 - (n - h) * 82 * f + (i - h) * 82 * f, fs: 44 * f, tr: 'under' };
    },
    room: () => 1050,
  },
  // 两栏交错：单句在左栏、双句在右栏，逐句往下走
  columns: {
    id: 'columns',
    place: (i, n, f) => ({ left: i % 2 ? 840 : 190, top: stackTop(n, 74 * f, 40 * f) + i * 74 * f, fs: 40 * f, tr: 'under' }),
    room: () => 600,
  },
  // 散点：一句一个位置往右下错开，留白最多（桥段）
  scatter: {
    id: 'scatter',
    italic: true,
    place: (i, n, f, w) => ({ left: Math.max(150, Math.min(200 + (i % 3) * 340, PW - 150 - w * f)), top: 230 + i * Math.min(180, 440 / Math.max(1, n - 1)), fs: 54 * f, tr: 'under' }),
    room: () => PW - 300,
  },
  // 右下斜体（预副歌）
  corner: {
    // 与大胆版式「转角」（bold-c.ts 的 corner）区分：同名时「相邻两页不重复」会把下一页的转角误跳过（2026-11-25 真实数据审查发现）
    id: 'cornerR',
    italic: true,
    place: (i, n, f) => ({ right: 190, top: Math.min(470, PH - 130 - n * 96 * f) + i * 96 * f, fs: 44 * f, tr: 'under' }),
    room: () => 1260,
  },
  // 左上斜体（预副歌的另一套）
  cornerL: {
    id: 'cornerL',
    italic: true,
    place: (i, _n, f) => ({ left: 190, top: 180 + i * 90 * f, fs: 42 * f, tr: 'under' }),
    room: () => 1150,
  },
  // 居中小字（尾声）
  coda: { id: 'coda', place: (i, n, f) => ({ center: true, top: PH / 2 - 20 - (n - 1) * 55 + i * 110, fs: 38 * f, tr: 'under' }), room: () => 1300 },
};

// ———— 竖排（中文歌，从右往左一列一句；right = 这一列的右边） ————
const vCol = (right: number, top: number, fs: number): Place => ({ left: right - fs, top, fs, tr: 'under' });
const V: Record<string, Tpl> = {
  rightStart: { id: 'v-right', place: (i, _n, f) => vCol(1290 - i * 104 * f, 200, 50 * f), room: () => PH - 270 },
  group: { id: 'v-group', place: (i, n, f) => vCol(PW / 2 + ((n - 1) * 136 * f) / 2 + 36 * f - i * 136 * f, 130, 72 * f), room: () => PH - 200 },
  steps: { id: 'v-steps', place: (i, _n, f) => vCol(1240 - i * 112 * f, 150 + i * 56, 50 * f), room: (i) => PH - 220 - i * 56 },
  leftStart: { id: 'v-left', place: (i, n, f) => vCol(380 + (n - 1 - i) * 100 * f + 48 * f, 220, 48 * f), room: () => PH - 290 },
  headline: {
    id: 'v-headline',
    place: (i, _n, f) => (i === 0 ? vCol(1250, 130, 92 * f) : vCol(1250 - 160 * f - (i - 1) * 80 * f, 300, 40 * f)),
    room: (i) => (i === 0 ? PH - 200 : PH - 370),
  },
  pre: { id: 'v-pre', place: (i, _n, f) => vCol(700 - i * 90 * f, 300, 44 * f), room: () => PH - 370 },
  scatter: { id: 'v-scatter', place: (i, _n, f) => vCol(1120 - i * 190 * f, 170 + i * 70, 52 * f), room: (i) => PH - 240 - i * 70 },
  coda: { id: 'v-coda', place: (i, n, f) => vCol(PW / 2 + ((n - 1) * 96 * f) / 2 + 20 - i * 96 * f, 330, 42 * f), room: () => PH - 400 },
};

/** 每种段落的经典版式（第几次轮到经典版式就用第几套）。 */
export const CLASSIC_H: Record<SectionKind, Tpl[]> = {
  verse: [H.left!, H.right!, H.headline!, H.columns!, H.axis!],
  pre: [H.corner!, H.cornerL!],
  chorus: [H.stairs!, H.stairsR!, H.headline!, H.axis!],
  bridge: [H.scatter!, H.split!],
  outro: [H.coda!, H.right!],
};
export const CLASSIC_V: Record<SectionKind, Tpl[]> = {
  verse: [V.rightStart!, V.steps!, V.leftStart!],
  pre: [V.pre!, V.leftStart!],
  chorus: [V.group!, V.headline!, V.steps!],
  bridge: [V.scatter!],
  outro: [V.coda!],
};
/** 唱片纹之类强制横排的页、中文歌没有横排经典版式可退时用。 */
export const CLASSIC_FALLBACK_H = H.left!;
