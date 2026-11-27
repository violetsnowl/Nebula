import type { EngineLine } from '../../lib/listen/model';
import { measureUnits, renderUnits, restUnit, unitFrame, type UnitRt } from '../../lib/listen/words';
import type { FlySide } from '../../lib/listen/flyTransition';
import type { GLine } from './glyphAtlas';
import { segAtOut, type Seg, type V3 } from './pathText';
import type { Warp } from './moves';

/**
 * 穿行第二版（WebGL2）↔ 听音空间的 DOM 替身桥（TRAVEL_HANDOFF §9.10 第 5 项，方案 2A）：
 * WebGL2 画布里的字没有 DOM 节点，转场时按当前句每个词 / 字在三维曲线（含环 / 星座 / 立起 / 卷起变形）
 * 投影到屏幕上的实时位置、字号与倾角，在隐藏宿主 `.tv-fly-host` 里临时生成对应 DOM 单元交给 `flyTransition.ts` 飞行。
 * 飞行期间 WebGL2 隐去这一句，落地后立刻清空宿主，零常驻 DOM 开销。
 */

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const RAD2DEG = 180 / Math.PI;
const GHOST = {
  cover: 'rgba(255,255,255,.34)',
  mono: 'color-mix(in srgb, color-mix(in srgb, var(--lc-a) 58%, #fff) 34%, transparent)',
} as const;

export interface FlyCam {
  pcx: number;
  pcy: number;
  pX: number;
  pY: number;
  pZ: number;
  F: number;
  near: number;
}

export interface TravelFlySession {
  lineIdx: number;
  text: string;
  units: HTMLElement[];
  sides: FlySide[];
  update: (segs: Seg[], warp: Warp | null, cam: FlyCam, t: number, scheme: 'accent' | 'mono', state: 'future' | 'cur' | 'past') => void;
  clear: () => void;
}

const _p: V3 = [0, 0, 0];
const _t: V3 = [0, 0, 0];
const _d: V3 = [0, 0, 0];

/** 计算句中排版坐标 em 在当前曲线与招式变形下的屏幕中心、字号、旋转角与可见度。 */
function projectUnit(
  em: number,
  invW: number,
  sg: Seg,
  fs: number,
  centerYEm: number,
  warp: Warp | null,
  cam: FlyCam,
): { x: number; y: number; fsPx: number; rot: number; vis: number } {
  const sMid = (em - sg.e0 - sg.w / 2) * fs;
  segAtOut(sg, sMid, _p, _t, _d);
  let p: V3 = _p;
  let tg: V3 = _t;
  let dn: V3 = _d;
  let vis = 1;
  if (warp) {
    const w = warp(em, em * invW, p, tg, dn);
    p = w.p;
    tg = w.t;
    dn = w.d;
    vis = w.vis;
  }
  const cy0 = centerYEm * fs;
  const wx = p[0] + dn[0] * cy0;
  const wy = p[1] + dn[1] * cy0;
  const wz = p[2] + dn[2] * cy0;
  const dz = Math.max(cam.near * 1.5, wz - cam.pZ);
  const s = cam.F / dz;
  const sx = cam.pcx + (wx - cam.pX) * s;
  const sy = cam.pcy + (wy - cam.pY) * s;
  const fsPx = clamp(fs * s, 12, 180);
  // 切向投影到屏幕得到二维倾角
  const dz2 = Math.max(cam.near * 1.5, wz + tg[2] * fs - cam.pZ);
  const s2 = cam.F / dz2;
  const sx2 = cam.pcx + (wx + tg[0] * fs - cam.pX) * s2;
  const sy2 = cam.pcy + (wy + tg[1] * fs - cam.pY) * s2;
  const rot = clamp(Math.atan2(sy2 - sy, sx2 - sx) * RAD2DEG, -50, 50);
  return { x: sx, y: sy, fsPx, rot, vis };
}

/** 为穿行第二版的指定句在 `host` 中生成临时 DOM 单元与 `FlySide`，供 `LsFly` / `launchStageToListenFly` 复用。 */
export function createTravelFlySession(
  host: HTMLElement,
  lineIdx: number,
  line: EngineLine,
  g: GLine,
  fs: number,
  segs: Seg[],
  warp: Warp | null,
  cam: FlyCam,
  t: number,
  scheme: 'accent' | 'mono',
  state: 'future' | 'cur' | 'past',
): TravelFlySession | null {
  host.innerHTML = '';
  const invW = 1 / Math.max(0.5, g.width);
  const seg0 = segs[0];
  if (!seg0) return null;

  const units: HTMLElement[] = [];
  const slots: HTMLElement[] = [];
  const sides: FlySide[] = [];
  let rts: UnitRt[] | null = null;
  let wholeEl: HTMLElement | null = null;

  const applySlot = (slot: HTMLElement, side: FlySide, x: number, y: number, fsPx: number, rot: number, vis: number, st: 'future' | 'cur' | 'past') => {
    slot.style.left = `${x.toFixed(2)}px`;
    slot.style.top = `${y.toFixed(2)}px`;
    slot.style.fontSize = `${fsPx.toFixed(2)}px`;
    slot.style.transform = `translate(-50%, -50%) rotate(${rot.toFixed(2)}deg)`;
    slot.classList.toggle('is-cur', st === 'cur');
    slot.classList.toggle('is-past', st === 'past');
    slot.classList.toggle('is-grad', st === 'cur' && !!rts);
    side.rot = rot;
    side.opacity = vis;
  };

  if (line.units?.length && g.units.length === line.units.length) {
    const tmp = document.createElement('div');
    tmp.className = 'tv-fly-tmp';
    host.appendChild(tmp);
    rts = renderUnits(tmp, line.units);
    measureUnits(rts);
    const ghost = GHOST[scheme === 'mono' ? 'mono' : 'cover'];
    const singing = state === 'cur' && t <= line.e + 0.3;
    for (const rt of rts) {
      if (state === 'cur') {
        unitFrame(rt, t, scheme, singing, null, line.dens);
        rt.v.set('--un', ghost);
        rt.chs?.forEach((c) => c.set('--un', ghost));
      } else {
        restUnit(rt);
      }
    }
    const seg1 = segs.length > 1 ? segs[1]! : null;
    const splitUi = seg1 ? seg1.from : 1e9;
    const rawChildren = [...tmp.children] as HTMLElement[];
    for (let ui = 0; ui < rawChildren.length; ui++) {
      const uEl = rawChildren[ui]!;
      const gu = g.units[ui]!;
      const sg = ui >= splitUi ? seg1! : seg0;
      const em = gu.left + gu.w / 2;
      const cyEm = (-gu.baseEm + (gu.bandEm - gu.baseEm)) / 2;
      const pr = projectUnit(em, invW, sg, fs, cyEm, warp, cam);
      const slot = document.createElement('div');
      slot.className = 'tv-fly-slot';
      slot.appendChild(uEl);
      host.appendChild(slot);
      const side: FlySide = {
        el: uEl,
        ctx: state === 'cur' ? 'lpm-c is-grad' : 'lpm-c',
        rot: pr.rot,
        vert: false,
        opacity: pr.vis,
      };
      applySlot(slot, side, pr.x, pr.y, pr.fsPx, pr.rot, pr.vis, state);
      units.push(uEl);
      slots.push(slot);
      sides.push(side);
    }
    tmp.remove();
  } else {
    // 整句无逐字时间轴：单个 .fl-whole，与歌词栏 .ly-main.ly-whole 一一对应
    const em = g.width / 2;
    const gu0 = g.units[0];
    const cyEm = gu0 ? (-gu0.baseEm + (gu0.bandEm - gu0.baseEm)) / 2 : -0.375;
    const pr = projectUnit(em, invW, seg0, fs, cyEm, warp, cam);
    const slot = document.createElement('div');
    slot.className = 'tv-fly-slot';
    wholeEl = document.createElement('span');
    wholeEl.className = `fl-whole${t >= line.s ? ' is-on' : ''}`;
    wholeEl.textContent = line.text;
    slot.appendChild(wholeEl);
    host.appendChild(slot);
    const side: FlySide = {
      el: wholeEl,
      ctx: 'lpm-c',
      rot: pr.rot,
      vert: false,
      opacity: pr.vis,
    };
    applySlot(slot, side, pr.x, pr.y, pr.fsPx, pr.rot, pr.vis, state);
    units.push(wholeEl);
    slots.push(slot);
    sides.push(side);
  }

  return {
    lineIdx,
    text: line.text,
    units,
    sides,
    update(nextSegs, nextWarp, nextCam, nextT, nextScheme, nextState) {
      const s0 = nextSegs[0];
      if (!s0) return;
      if (rts) {
        const ghost = GHOST[nextScheme === 'mono' ? 'mono' : 'cover'];
        const singing = nextState === 'cur' && nextT <= line.e + 0.3;
        for (const rt of rts) {
          if (nextState === 'cur') {
            unitFrame(rt, nextT, nextScheme, singing, null, line.dens);
            rt.v.set('--un', ghost);
            rt.chs?.forEach((c) => c.set('--un', ghost));
          } else {
            restUnit(rt);
          }
        }
        const s1 = nextSegs.length > 1 ? nextSegs[1]! : null;
        const splitUi = s1 ? s1.from : 1e9;
        for (let ui = 0; ui < slots.length; ui++) {
          const gu = g.units[ui]!;
          const sg = ui >= splitUi ? s1! : s0;
          const em = gu.left + gu.w / 2;
          const cyEm = (-gu.baseEm + (gu.bandEm - gu.baseEm)) / 2;
          const pr = projectUnit(em, invW, sg, fs, cyEm, nextWarp, nextCam);
          applySlot(slots[ui]!, sides[ui]!, pr.x, pr.y, pr.fsPx, pr.rot, pr.vis, nextState);
        }
      } else if (wholeEl && slots[0] && sides[0]) {
        wholeEl.classList.toggle('is-on', nextT >= line.s);
        const gu0 = g.units[0];
        const cyEm = gu0 ? (-gu0.baseEm + (gu0.bandEm - gu0.baseEm)) / 2 : -0.375;
        const pr = projectUnit(g.width / 2, invW, s0, fs, cyEm, nextWarp, nextCam);
        applySlot(slots[0]!, sides[0]!, pr.x, pr.y, pr.fsPx, pr.rot, pr.vis, nextState);
      }
    },
    clear() {
      host.innerHTML = '';
    },
  };
}
