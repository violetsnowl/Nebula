import type { EngineLine } from '../../lib/listen/model';
import { measureUnits, renderUnits, restUnit, unitFrame, waveOf, type UnitRt } from '../../lib/listen/words';
import type { FlySide } from '../../lib/listen/flyTransition';
import type { GLine } from './glyphAtlas';
import { segAtOut, type Seg, type V3 } from './pathText';
import type { Warp } from './moves';

/**
 * 穿行第二版（WebGL2）↔ 听音空间 / 漫游的 DOM 替身桥（TRAVEL_HANDOFF §9.10 第 5 项）：
 * WebGL2 画布里的字没有 DOM 节点，转场时按当前句每个词 / 字在三维曲线（含环 / 星座 / 立起 / 卷起变形）
 * 投影到屏幕上的实时位置、精确基线中点、三维透视宽高压扁（sx / sy）与倾角，在隐藏宿主 `.tv-fly-host` 里
 * 临时生成对应 DOM 单元交给 `flyTransition.ts` 飞行。落地最后阶段与 WebGL2 字形平滑交叉淡化，落地后立刻清空宿主。
 */

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const smooth = (x: number) => {
  const t = clamp(x, 0, 1);
  return t * t * (3 - 2 * t);
};
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

/** 计算句中排版坐标 em 在当前曲线与招式变形下的屏幕中心、字号、旋转角、三维透视压扁与可见度。 */
function projectUnit(
  em: number,
  invW: number,
  sg: Seg,
  fs: number,
  centerYEm: number,
  wRatio: number,
  warp: Warp | null,
  cam: FlyCam,
): { x: number; y: number; fsPx: number; rot: number; sx: number; sy: number; vis: number } {
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
  // 切向投影到屏幕得到二维倾角与水平透视缩短（例如斜坡 / 拐角 / 环的偏航角）
  const dz2 = Math.max(cam.near * 1.5, wz + tg[2] * fs - cam.pZ);
  const s2 = cam.F / dz2;
  const dxT = cam.pcx + (wx + tg[0] * fs - cam.pX) * s2 - sx;
  const dyT = cam.pcy + (wy + tg[1] * fs - cam.pY) * s2 - sy;
  const rot = clamp(Math.atan2(dyT, dxT) * RAD2DEG, -50, 50);
  const lenX = Math.hypot(dxT, dyT);
  // 竖向投影到屏幕得到竖向透视缩短（例如「立起」招式倒伏角）
  const dzD = Math.max(cam.near * 1.5, wz + dn[2] * fs - cam.pZ);
  const sD = cam.F / dzD;
  const dxD = cam.pcx + (wx + dn[0] * fs - cam.pX) * sD - sx;
  const dyD = cam.pcy + (wy + dn[1] * fs - cam.pY) * sD - sy;
  const lenY = Math.hypot(dxD, dyD);
  const scaleX = clamp((lenX / Math.max(1, fsPx)) * wRatio, 0.35, 1.35);
  const scaleY = clamp(lenY / Math.max(1, fsPx), 0.35, 1.35);
  return { x: sx, y: sy, fsPx, rot, sx: scaleX, sy: scaleY, vis };
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
  const scales: Array<{ sx: number; sy: number }> = [];
  const wRatios: number[] = [];
  const cyEms: number[] = [];
  let rts: UnitRt[] | null = null;
  let wholeEl: HTMLElement | null = null;
  // 实测 DOM 行框中点相对字母基线的偏移（em）：避免把 WebGL2 字形贴图带中点(-0.375em)硬套给 DOM 导致落地上下跳动
  let domCyEm = -0.32;

  const applySlot = (
    slot: HTMLElement,
    side: FlySide,
    scObj: { sx: number; sy: number },
    x: number,
    y: number,
    fsPx: number,
    rot: number,
    scaleX: number,
    scaleY: number,
    vis: number,
    st: 'future' | 'cur' | 'past',
  ) => {
    slot.style.left = `${x.toFixed(2)}px`;
    slot.style.top = `${y.toFixed(2)}px`;
    slot.style.fontSize = `${fsPx.toFixed(2)}px`;
    slot.style.transform = `translate(-50%, -50%) rotate(${rot.toFixed(2)}deg) scale(${scaleX.toFixed(4)}, ${scaleY.toFixed(4)})`;
    slot.classList.toggle('is-cur', st === 'cur');
    slot.classList.toggle('is-past', st === 'past');
    slot.classList.toggle('is-grad', st === 'cur' && !!rts);
    side.rot = rot;
    side.opacity = vis;
    scObj.sx = scaleX;
    scObj.sy = scaleY;
  };

  const syncWords = (curRts: UnitRt[], nextT: number, nextScheme: 'accent' | 'mono', nextState: 'future' | 'cur' | 'past') => {
    const ghost = GHOST[nextScheme === 'mono' ? 'mono' : 'cover'];
    const singing = nextState === 'cur' && nextT <= line.e + 0.3;
    const rawWave = singing ? waveOf(curRts, line.dens, nextT) : null;
    const waveK = smooth((nextT - (line.s - 0.05)) / 0.15);
    const wave = rawWave ? (c: number) => rawWave(c) * waveK : null;
    for (const rt of curRts) {
      if (nextState === 'cur') {
        unitFrame(rt, nextT, nextScheme, singing, wave, line.dens);
        rt.v.set('--un', ghost);
        rt.chs?.forEach((c) => c.set('--un', ghost));
      } else {
        restUnit(rt);
      }
    }
  };

  if (line.units?.length && g.units.length === line.units.length) {
    const tmp = document.createElement('div');
    tmp.className = 'tv-fly-tmp';
    host.appendChild(tmp);
    rts = renderUnits(tmp, line.units);
    measureUnits(rts);
    const probe = document.createElement('span');
    probe.style.cssText = 'display:inline-block;width:0;height:0;vertical-align:baseline;overflow:hidden';
    tmp.appendChild(probe);
    const tmpFs = parseFloat(getComputedStyle(tmp).fontSize) || 72;
    const baseY = probe.getBoundingClientRect().bottom;
    const rawChildren = [...tmp.children].filter((el) => el !== probe) as HTMLElement[];
    const rects = rawChildren.map((el) => el.getBoundingClientRect());
    if (rects[0] && rects[0].height > 0) {
      domCyEm = clamp((rects[0].top + rects[0].height / 2 - baseY) / tmpFs, -0.55, -0.15);
    }
    syncWords(rts, t, scheme, state);
    const seg1 = segs.length > 1 ? segs[1]! : null;
    const splitUi = seg1 ? seg1.from : 1e9;
    for (let ui = 0; ui < rawChildren.length; ui++) {
      const uEl = rawChildren[ui]!;
      const gu = g.units[ui]!;
      const ur = rects[ui];
      const uCy = ur && ur.height > 0 ? clamp((ur.top + ur.height / 2 - baseY) / tmpFs, -0.55, -0.15) : domCyEm;
      cyEms.push(uCy);
      const domWEm = (ur?.width || 0) / tmpFs;
      const wr = domWEm > 0.05 && gu.w > 0.05 ? clamp(gu.w / domWEm, 0.85, 1.15) : 1;
      wRatios.push(wr);
      const sg = ui >= splitUi ? seg1! : seg0;
      const em = gu.left + gu.w / 2;
      const pr = projectUnit(em, invW, sg, fs, uCy, wr, warp, cam);
      const slot = document.createElement('div');
      slot.className = 'tv-fly-slot';
      slot.appendChild(uEl);
      host.appendChild(slot);
      const scObj = { sx: pr.sx, sy: pr.sy };
      const side: FlySide = {
        el: uEl,
        ctx: state === 'cur' ? 'lpm-c is-grad' : 'lpm-c',
        rot: pr.rot,
        vert: false,
        opacity: pr.vis,
        adj: () => ({ dx: 0, dy: 0, sx: scObj.sx, sy: scObj.sy }),
      };
      applySlot(slot, side, scObj, pr.x, pr.y, pr.fsPx, pr.rot, pr.sx, pr.sy, pr.vis, state);
      units.push(uEl);
      slots.push(slot);
      sides.push(side);
      scales.push(scObj);
    }
    tmp.remove();
  } else {
    // 整句无逐字时间轴：单个 .fl-whole，与歌词栏 .ly-main.ly-whole 一一对应
    const tmp = document.createElement('div');
    tmp.className = 'tv-fly-tmp';
    wholeEl = document.createElement('span');
    wholeEl.className = `fl-whole${t >= line.s ? ' is-on' : ''}`;
    wholeEl.textContent = line.text;
    const probe = document.createElement('span');
    probe.style.cssText = 'display:inline-block;width:0;height:0;vertical-align:baseline;overflow:hidden';
    tmp.append(wholeEl, probe);
    host.appendChild(tmp);
    const tmpFs = parseFloat(getComputedStyle(tmp).fontSize) || 72;
    const baseY = probe.getBoundingClientRect().bottom;
    const wr0 = wholeEl.getBoundingClientRect();
    if (wr0.height > 0) domCyEm = clamp((wr0.top + wr0.height / 2 - baseY) / tmpFs, -0.55, -0.15);
    const domWEm = wr0.width / tmpFs;
    const wr = domWEm > 0.05 && g.width > 0.05 ? clamp(g.width / domWEm, 0.85, 1.15) : 1;
    wRatios.push(wr);
    const em = g.width / 2;
    const pr = projectUnit(em, invW, seg0, fs, domCyEm, wr, warp, cam);
    const slot = document.createElement('div');
    slot.className = 'tv-fly-slot';
    slot.appendChild(wholeEl);
    host.appendChild(slot);
    tmp.remove();
    const scObj = { sx: pr.sx, sy: pr.sy };
    const side: FlySide = {
      el: wholeEl,
      ctx: 'lpm-c',
      rot: pr.rot,
      vert: false,
      opacity: pr.vis,
      adj: () => ({ dx: 0, dy: 0, sx: scObj.sx, sy: scObj.sy }),
    };
    applySlot(slot, side, scObj, pr.x, pr.y, pr.fsPx, pr.rot, pr.sx, pr.sy, pr.vis, state);
    units.push(wholeEl);
    slots.push(slot);
    sides.push(side);
    scales.push(scObj);
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
        syncWords(rts, nextT, nextScheme, nextState);
        const s1 = nextSegs.length > 1 ? nextSegs[1]! : null;
        const splitUi = s1 ? s1.from : 1e9;
        for (let ui = 0; ui < slots.length; ui++) {
          const gu = g.units[ui]!;
          const sg = ui >= splitUi ? s1! : s0;
          const em = gu.left + gu.w / 2;
          const pr = projectUnit(em, invW, sg, fs, cyEms[ui] ?? domCyEm, wRatios[ui] ?? 1, nextWarp, nextCam);
          applySlot(slots[ui]!, sides[ui]!, scales[ui]!, pr.x, pr.y, pr.fsPx, pr.rot, pr.sx, pr.sy, pr.vis, nextState);
        }
      } else if (wholeEl && slots[0] && sides[0] && scales[0]) {
        wholeEl.classList.toggle('is-on', nextT >= line.s);
        const pr = projectUnit(g.width / 2, invW, s0, fs, domCyEm, wRatios[0] ?? 1, nextWarp, nextCam);
        applySlot(slots[0], sides[0], scales[0], pr.x, pr.y, pr.fsPx, pr.rot, pr.sx, pr.sy, pr.vis, nextState);
      }
    },
    clear() {
      host.innerHTML = '';
    },
  };
}
