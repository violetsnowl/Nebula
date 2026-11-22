/**
 * 主舞台歌词升级（2026-11-22，fe/next，样张 M「漫游歌词 · 升级」）的共享状态：
 * 漫游歌词层（LyricsLayer）每帧用段落引擎（sections.ts）算出来写进这里，舞台帧循环（useStage）读它：
 *   - 段落开合：副歌时星云从沉降里浮起一点、亮一点，主歌收着；
 *   - 间奏让位：间奏里星云几乎回到原样；
 *   - 字照亮空间：正在唱的字附近的卡片提亮。
 * 对象引用恒定，字段原地更新。on = false 时一切按旧样子（实验室里的开关，默认开）。
 */
export interface StageShapeBus {
  on: boolean;
  /** 段落开合 0–1（sections.stageAt 的 lift 归一化：主歌 .2 → 0，最后一次副歌 1 → 1）。 */
  open: number;
  /** 间奏让位 0–1。 */
  gap: number;
  /** 沉降的压暗程度相对旧值的倍数（旧值 = 1）。 */
  sinkDepth: number;
  /** 沉降的下沉、缩小幅度相对旧值的倍数。 */
  sinkPos: number;
  /** 光源（正在唱的字）在屏幕上的位置与强度 0–1。 */
  lx: number;
  ly: number;
  lk: number;
}

export const stageShapeBus: StageShapeBus = { on: false, open: 0, gap: 0, sinkDepth: 1, sinkPos: 1, lx: 0, ly: 0, lk: 0 };

/**
 * 版面的转场（用户 2026-11-22 提议，第二版「逐字飞入」）：进入 / 离开聆听时，最近开始唱的那一句逐字飞到版面上
 * 对应的字（竖排时一个个字落进那一列）。替身由 LyricPage 画；飞行期间漫游歌词里的这句（含它离场的那一份）和字幕要藏起来，
 * LyricsLayer 按 morphS（这句的开始时间）认出是哪句。
 */
export interface PageBus {
  /** 逐字飞行进行中。 */
  morph: boolean;
  /** 被接手那句的开始时间（秒）。 */
  morphS: number;
  /** 替身是从字幕（播放条上方那行）起飞的：字幕也要藏起来。 */
  caption: boolean;
}

export const pageBus: PageBus = { morph: false, morphS: 0, caption: false };

const clamp01 =(v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * 由引擎的 lift（.2–1）和 gap 算沉降倍数（样张 M 定的值）：
 *   亮度：主歌压到 .30、最后一次副歌只压到 .64（旧值固定 .38），间奏里只剩一成五；
 *   位置：主歌比旧值略沉（1.07 倍），副歌浮起一半，间奏里完全浮起。
 */
export function shapeSink(lift: number, gap: number): { open: number; sinkDepth: number; sinkPos: number } {
  const open = clamp01((lift - 0.2) / 0.8);
  const g = clamp01(gap);
  return {
    open,
    sinkDepth: ((0.7 - 0.34 * open) * (1 - 0.85 * g)) / 0.62,
    sinkPos: (1.07 - 0.5 * open) * (1 - g),
  };
}
