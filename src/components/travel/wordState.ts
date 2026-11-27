import type { EngineLine } from '../../lib/listen/model';
import type { UnitRt, Vars } from '../../lib/listen/words';
import type { GLine } from './glyphAtlas';

/**
 * 逐字层接到 3D（TRAVEL_HANDOFF §9.3「逐字层不变」）：扫光、波浪、长音放大与白光、尾韵的时间与幅度
 * 直接调用 `words.ts` 的 `waveOf` / `unitFrame`（只调用、不改），它们原本把结果写成 DOM 的样式变量；
 * 这里给它一个「记录器」代替 DOM 节点，记下写了什么，渲染时读出数值。
 */
export class Rec {
  private m: Record<string, string> = {};
  g = false;
  set(name: string, val: string): void {
    this.m[name] = val;
  }
  glow(on: boolean): void {
    this.g = on;
  }
  rest(): void {
    this.m['--lift'] = '0';
    this.m['--sc'] = '1';
    this.g = false;
  }
  /** 扫光进度 0–1 */
  get p(): number {
    return parseFloat(this.m['--p'] ?? '0') || 0;
  }
  /** 浮起（em） */
  get lift(): number {
    return parseFloat(this.m['--lift'] ?? '0') || 0;
  }
  get sc(): number {
    return parseFloat(this.m['--sc'] ?? '1') || 1;
  }
  /** 白光强度 0–1（`--gc` 里的百分比） */
  get glowK(): number {
    if (!this.g) return 0;
    const m = /(\d+(?:\.\d+)?)%,\s*transparent\)\s*$/.exec(this.m['--gc'] ?? '');
    return m ? parseFloat(m[1]!) / 100 : 0;
  }
}

export interface WordRt {
  rts: UnitRt[];
  recs: Rec[];
  chs: (Rec[] | null)[];
}

/** 给一句建逐字层的运行时（坐标用主字号的 em，fs = 1，与 waveOf 的量纲一致）。没有逐字时间返回 null。 */
export function wordRt(line: EngineLine, g: GLine): WordRt | null {
  if (!line.units) return null;
  const recs: Rec[] = [];
  const chs: (Rec[] | null)[] = [];
  const rts: UnitRt[] = line.units.map((u, k) => {
    const gu = g.units[k]!;
    const rec = new Rec();
    // 拉丁长音按字母拆开（同 renderUnits）
    const ch = u.emph && !u.cjk ? [...u.t].map(() => new Rec()) : null;
    recs.push(rec);
    chs.push(ch);
    return { u, v: rec as unknown as Vars, chs: ch as unknown as Vars[] | null, w: gu.w, left: gu.left, fs: 1, lineW: g.width };
  });
  return { rts, recs, chs };
}
