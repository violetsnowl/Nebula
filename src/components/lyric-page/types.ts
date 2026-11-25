import type { EngineUnit } from '../../lib/listen/model';
import type { SectionKind } from '../../lib/listen/sections';

/**
 * 版面的版式接口（NEBULA_UI_SYSTEM §7.1b）。版式分两类：
 *   - 经典版式（样张 M）：只给每句一个位置和字号（place / room），整页按最挤的那句统一缩放；
 *   - 大胆版式（样张 N，2026-11-22 用户定稿）：自己接管整页。分两步——
 *       layout：「平排」——不旋转、不弯曲，只定位置、字号、分行 / 分段；引擎随后按平排的样子量每个字的位置（波浪用）；
 *       finish：量完之后再旋转、沿弧线摆、加装饰（细线、大字、沟槽、格子、色块），可返回逐帧钩子与撤销函数。
 * 坐标一律是 1600 × 900 的逻辑像素；量尺寸用 ctx.size（未变换、带小数）。
 */

export const PW = 1600;
export const PH = 900;

/** 经典版式里一句的位置。 */
export interface Place {
  left?: number;
  right?: number;
  /** 居中：left = 0、width = 画幅宽、文字居中。 */
  center?: boolean;
  top: number;
  fs: number;
  /** 翻译排在哪：右栏旁注 / 原文下面。 */
  tr: 'side' | 'under';
}

/** 版式看到的一句。 */
export interface TLine {
  /** .lp-line：绝对定位在页上。 */
  el: HTMLElement;
  /** .lp-tx：字都在这里（逐字句是一串 .u，整句是一个 .lp-whole）。 */
  tx: HTMLElement;
  /** 翻译；版式可以把它挪出 .lp-line（引擎按所属句子的状态给它加 is-on）。 */
  tr: HTMLElement | null;
  /** 逐字句的 .u（顺序同演唱顺序）；整句为空。 */
  units: HTMLElement[];
  whole: HTMLElement | null;
  eu: EngineUnit[] | null;
  text: string;
  /** 开始 / 结束（秒）。 */
  ts: number;
  te: number;
  /** 这一句的读向（竖排）；一句跨两个方向时由 .lp-seg-v / .lp-seg-h 分段决定每个字。版式可改。 */
  vert: boolean;
  /** 整句的倾斜（度）：转场的替身按它落位。版式可改。 */
  rot: number;
}

export interface TCtx {
  page: HTMLElement;
  lines: TLine[];
  kind: SectionKind;
  /** 这一页竖排（中文歌默认竖排；版式可强制横排）。 */
  vert: boolean;
  /** 中日韩：没有大小写和斜体，一个字就能当一个词。 */
  cjk: boolean;
  lang: 'zh' | 'ja' | 'ko' | 'en';
  /** 开了翻译且这一页有译文。 */
  hasTr: boolean;
  /** 这首歌副歌里重复最多的词（出血大字用）；没有为 null。 */
  hook: string | null;
  /** 这一页是全曲最后一个副歌页（色场只给它）。 */
  lastChorus: boolean;
  /** 量元素未变换时的尺寸（逻辑像素，带小数）。 */
  size: (el: HTMLElement) => { w: number; h: number };
}

export interface PageHooks {
  /** 页面显示时每帧调用，t = 播放位置（秒）。 */
  frame?: (t: number) => void;
  /** 重排之前撤销 finish 做的结构改动（比如沿弧线摆字时包的外壳）。 */
  undo?: () => void;
}

export interface Tpl {
  id: string;
  /** 大胆版式：一首歌里最多出现一次。 */
  bold?: boolean;
  /** 强制这一页的方向（唱片纹只能横着走）；不写 = 跟歌。 */
  dir?: 'h' | 'v';
  italic?: boolean;
  /** 经典版式：f = 整页字号缩放（长句塞不下时 < 1）；w = 这句按原字号量出的宽（横排）。 */
  place?: (i: number, n: number, f: number, w: number) => Place;
  /** 经典版式：第 i 句最多能占多宽（横排）/ 多高（竖排）。 */
  room?: (i: number, n: number) => number;
  /** 这一页能不能用这套（句数、翻译、能不能断句……）。 */
  fits?: (c: TCtx) => boolean;
  layout?: (c: TCtx) => void;
  finish?: (c: TCtx) => PageHooks | void;
}
