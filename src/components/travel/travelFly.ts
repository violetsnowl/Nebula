import type { EngineLine } from '../../lib/listen/model';
import { Vars, measureUnits, renderUnits, restUnit, unitFrame, waveOf, type UnitRt } from '../../lib/listen/words';
import type { FlySide } from '../../lib/listen/flyTransition';
import type { GLine } from './glyphAtlas';
import { segAtOut, type Seg, type V3 } from './pathText';
import type { Warp } from './moves';

/**
 * 穿行第二版（WebGL2）↔ 听音空间 / 漫游的 DOM 替身桥（TRAVEL_HANDOFF §9.10 第 5 项）：
 * WebGL2 画布里的字没有 DOM 节点，转场时按当前句每个词 / 字在三维曲线（含环 / 星座 / 立起 / 卷起变形）
 * 投影到屏幕上的实时位置、精确基线中点、对称三维透视压扁（sx / sy）、倾角以及多字母词的逐字母弧度弯曲，
 * 在隐藏宿主 `.tv-fly-host` 里临时生成对应 DOM 单元交给 `flyTransition.ts` 飞行。落地后经锁位交叉淡化无声交接。
 */

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const smooth = (x: number) => {
  const t = clamp(x, 0, 1);
  return t * t * (3 - 2 * t);
};
const DEG2RAD = Math.PI / 180;
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
  update: (segs: Seg[], warp: Warp | null, cam: FlyCam, t: number, scheme: 'accent' | 'mono', state: 'future' | 'cur' | 'past', curveK?: number) => void;
  /** 仅供 QA 探针调用：把最新 3D 投影坐标写回隐藏宿主 DOM 槽位，平时帧循环走 FlySide.place 零重排。 */
  syncSlots: () => void;
  clear: () => void;
}

const _p: V3 = [0, 0, 0];
const _t: V3 = [0, 0, 0];
const _d: V3 = [0, 0, 0];

/** 计算句中排版坐标 em 在当前曲线与招式变形下的屏幕中心、字号、旋转角与可见度（等比缩放避免旋转斜切，透视缩短由逐字母定位承担）。 */
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
  // 对称投影 [-0.5em, +0.5em]，准确求出切向倾角
  const hFs = 0.5 * fs;
  const sTL = cam.F / Math.max(cam.near * 1.5, wz - tg[2] * hFs - cam.pZ);
  const sTR = cam.F / Math.max(cam.near * 1.5, wz + tg[2] * hFs - cam.pZ);
  const dxT = (wx + tg[0] * hFs - cam.pX) * sTR - (wx - tg[0] * hFs - cam.pX) * sTL;
  const dyT = (wy + tg[1] * hFs - cam.pY) * sTR - (wy - tg[1] * hFs - cam.pY) * sTL;
  const rot = clamp(Math.atan2(dyT, dxT) * RAD2DEG, -85, 85);
  return { x: sx, y: sy, fsPx, rot, vis };
}

/** 轻量投影单个字母的屏幕中心与切向倾角（供多字母词在飞行中逐字母弯成 3D 弧线并自动贴合偏航透视缩短）。 */
function projectChar(
  em: number,
  invW: number,
  sg: Seg,
  fs: number,
  centerYEm: number,
  warp: Warp | null,
  cam: FlyCam,
): { x: number; y: number; rot: number } {
  const sMid = (em - sg.e0 - sg.w / 2) * fs;
  segAtOut(sg, sMid, _p, _t, _d);
  let p: V3 = _p;
  let tg: V3 = _t;
  let dn: V3 = _d;
  if (warp) {
    const w = warp(em, em * invW, p, tg, dn);
    p = w.p;
    tg = w.t;
    dn = w.d;
  }
  const cy0 = centerYEm * fs;
  const wx = p[0] + dn[0] * cy0;
  const wy = p[1] + dn[1] * cy0;
  const wz = p[2] + dn[2] * cy0;
  const s = cam.F / Math.max(cam.near * 1.5, wz - cam.pZ);
  const x = cam.pcx + (wx - cam.pX) * s;
  const y = cam.pcy + (wy - cam.pY) * s;
  const hFs = 0.25 * fs;
  const sL = cam.F / Math.max(cam.near * 1.5, wz - tg[2] * hFs - cam.pZ);
  const sR = cam.F / Math.max(cam.near * 1.5, wz + tg[2] * hFs - cam.pZ);
  const dx = (wx + tg[0] * hFs - cam.pX) * sR - (wx - tg[0] * hFs - cam.pX) * sL;
  const dy = (wy + tg[1] * hFs - cam.pY) * sR - (wy - tg[1] * hFs - cam.pY) * sL;
  const rot = clamp(Math.atan2(dy, dx) * RAD2DEG, -85, 85);
  return { x, y, rot };
}

interface CharCurve {
  /** 每个字母对应的 DOM 元素（普通多字母词自建 .ch 或长音词复用 rt.chs） */
  vars: Vars[];
  /** 每个字母在未弯曲词内相对词中心的自然 X 偏移（em） */
  straightX: number[];
  /** 是否为非长音词自建的 .ch（需要按字母把词的扫光梯度拆写到各 .ch） */
  extra: boolean;
  /** 上一次写入的量化字符串缓存，避免无变化时触发脏戳与克隆重解析 */
  lastCx: string[];
  lastCy: string[];
  lastCr: string[];
  lastK: number;
  lastPState: number;
}

type RevEl = HTMLElement & { __tvRev?: number };

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
  initCurveK = 1,
): TravelFlySession | null {
  host.innerHTML = '';
  const invW = 1 / Math.max(0.5, g.width);
  const seg0 = segs[0];
  if (!seg0) return null;

  const units: HTMLElement[] = [];
  const slots: HTMLElement[] = [];
  const sides: FlySide[] = [];
  const places: Array<{ x: number; y: number; f: number; rot: number; st: 'future' | 'cur' | 'past' }> = [];
  const cyEms: number[] = [];
  const charCurves: Array<CharCurve | null> = [];
  let rts: UnitRt[] | null = null;
  let wholeEl: HTMLElement | null = null;
  let revSeq = 1;
  let updFrame = 0;
  let lastScheme: 'accent' | 'mono' | '' = '';
  let lastState: 'future' | 'cur' | 'past' | '' = '';
  // 实测 DOM 行框中点相对字母基线的偏移（em）：避免把 WebGL2 字形贴图带中点(-0.375em)硬套给 DOM 导致落地上下跳动
  let domCyEm = -0.32;

  const bumpRev = (el: HTMLElement) => {
    (el as RevEl).__tvRev = ++revSeq;
  };

  const writeSlotDom = (slot: HTMLElement, p: { x: number; y: number; f: number; rot: number; st: 'future' | 'cur' | 'past' }) => {
    slot.style.left = `${p.x.toFixed(2)}px`;
    slot.style.top = `${p.y.toFixed(2)}px`;
    slot.style.fontSize = `${p.f.toFixed(2)}px`;
    slot.style.transform = `translate(-50%, -50%) rotate(${p.rot.toFixed(2)}deg)`;
    slot.classList.toggle('is-cur', p.st === 'cur');
    slot.classList.toggle('is-past', p.st === 'past');
    slot.classList.toggle('is-grad', p.st === 'cur' && !!rts);
  };

  const applyCharCurve = (
    ui: number,
    uEl: HTMLElement,
    sg: Seg,
    pr: { x: number; y: number; fsPx: number; rot: number },
    nextWarp: Warp | null,
    nextCam: FlyCam,
    curveK: number,
    force = false,
  ) => {
    const cc = charCurves[ui];
    if (!cc) return;
    // 弯曲度已满（如 220ms 锁位交叉淡化期）且非强制帧时降频刷新，避免每帧对 40+ 字母重算投影与写样式
    if (!force && cc.lastK >= 0.999 && curveK >= 0.999 && updFrame % 3 !== 0) return;
    if (!force && cc.lastK <= 0.002 && curveK <= 0.002) return;
    const gu = g.units[ui]!;
    const nL = Math.min(cc.vars.length, gu.edges.length - 1);
    let dirty = false;
    if (curveK <= 0.002) {
      for (let j = 0; j < nL; j++) {
        if (cc.lastCx[j] !== '0' || cc.lastCy[j] !== '0' || cc.lastCr[j] !== '0deg') {
          const v = cc.vars[j]!;
          v.set('--cx', '0');
          v.set('--cy', '0');
          v.set('--cr', '0deg');
          cc.lastCx[j] = '0';
          cc.lastCy[j] = '0';
          cc.lastCr[j] = '0deg';
          dirty = true;
        }
      }
      cc.lastK = 0;
      if (dirty) bumpRev(uEl);
      return;
    }
    const uCy = cyEms[ui] ?? domCyEm;
    const rad = -pr.rot * DEG2RAD;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const invFs = 1 / Math.max(1, pr.fsPx);
    for (let j = 0; j < nL; j++) {
      const emJ = gu.left + (gu.edges[j]! + gu.edges[j + 1]!) * 0.5;
      const cp = projectChar(emJ, invW, sg, fs, uCy, nextWarp, nextCam);
      const dx = cp.x - pr.x;
      const dy = cp.y - pr.y;
      const lx = (dx * cos - dy * sin) * invFs;
      const ly = (dx * sin + dy * cos) * invFs;
      // 量化到 ~0.25px / 0.2°，肉眼无感但可过滤绝大多数微小镜头抖动写入
      const cxS = (Math.round((lx - cc.straightX[j]!) * curveK * 250) / 250).toFixed(3);
      const cyS = (Math.round(ly * curveK * 250) / 250).toFixed(3);
      const crS = `${(Math.round((cp.rot - pr.rot) * curveK * 5) / 5).toFixed(1)}deg`;
      if (cxS !== cc.lastCx[j] || cyS !== cc.lastCy[j] || crS !== cc.lastCr[j]) {
        const v = cc.vars[j]!;
        v.set('--cx', cxS);
        v.set('--cy', cyS);
        v.set('--cr', crS);
        cc.lastCx[j] = cxS;
        cc.lastCy[j] = cyS;
        cc.lastCr[j] = crS;
        dirty = true;
      }
    }
    cc.lastK = curveK;
    if (dirty) bumpRev(uEl);
  };

  const syncWords = (curRts: UnitRt[], nextT: number, nextScheme: 'accent' | 'mono', nextState: 'future' | 'cur' | 'past') => {
    const ghost = GHOST[nextScheme === 'mono' ? 'mono' : 'cover'];
    const singing = nextState === 'cur' && nextT <= line.e + 0.3;
    const rawWave = singing ? waveOf(curRts, line.dens, nextT) : null;
    const waveK = smooth((nextT - (line.s - 0.05)) / 0.15);
    const wave = rawWave ? (c: number) => rawWave(c) * waveK : null;
    const modeChanged = nextScheme !== lastScheme || nextState !== lastState;
    lastScheme = nextScheme;
    lastState = nextState;
    for (let ui = 0; ui < curRts.length; ui++) {
      const rt = curRts[ui]!;
      const u = rt.u;
      // 远离当前演唱时间窗的词在波浪与扫光上已完全静止，跳过 DOM 写入与克隆脏戳
      const nearActive = modeChanged || (nextState === 'cur' && nextT >= u.s - 2.2 && nextT <= u.e + 1.8);
      if (!nearActive) continue;
      if (nextState === 'cur') {
        unitFrame(rt, nextT, nextScheme, singing, wave, line.dens);
        rt.v.set('--un', ghost);
        rt.chs?.forEach((c) => c.set('--un', ghost));
        const cc = charCurves[ui];
        if (cc?.extra) {
          const gu = g.units[ui]!;
          const wTotal = Math.max(1e-4, gu.w);
          const pWord = clamp((nextT - u.s) / Math.max(0.001, u.e - u.s), 0, 1);
          const pState = pWord <= 0 ? -1 : pWord >= 1 ? 1 : 0;
          if (modeChanged || pState === 0 || pState !== cc.lastPState) {
            cc.lastPState = pState;
            const fW = 0.26;
            const pW = pWord * (1 + 2 * fW) - fW;
            const st = rt.v.el.style;
            const sung = st.getPropertyValue('--sung');
            const edge = st.getPropertyValue('--edge');
            const nL = Math.min(cc.vars.length, gu.edges.length - 1);
            for (let j = 0; j < nL; j++) {
              const g0 = gu.edges[j]! / wTotal;
              const g1 = gu.edges[j + 1]! / wTotal;
              const dw = Math.max(1e-4, g1 - g0);
              const fL = fW / dw;
              const pL = clamp(((pW - g0) / dw + fL) / (1 + 2 * fL), 0, 1);
              const cv = cc.vars[j]!;
              cv.set('--sung', sung);
              cv.set('--edge', edge);
              cv.set('--un', ghost);
              cv.set('--p', pL.toFixed(4));
            }
          }
        }
      } else {
        restUnit(rt);
      }
      bumpRev(rt.v.el);
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
    const rawChildren = [...tmp.children].filter((el) => el !== probe) as HTMLElement[];
    // 给非长音多字母拉丁词也拆出 .ch 子节点，方便飞行中逐字母平滑贴合 3D 弧线（不改动 words.ts）
    const extraLists: Array<Vars[] | null> = [];
    for (let ui = 0; ui < rawChildren.length; ui++) {
      const uEl = rawChildren[ui]!;
      const rt = rts[ui]!;
      const gu = g.units[ui]!;
      const chars = Array.from(rt.u.t);
      if (!rt.chs && !rt.u.cjk && chars.length > 1 && chars.length === gu.edges.length - 1) {
        uEl.textContent = '';
        uEl.classList.add('has-ch');
        const list = chars.map((ch) => {
          const sp = document.createElement('span');
          sp.className = 'ch';
          sp.textContent = ch;
          uEl.appendChild(sp);
          return new Vars(sp);
        });
        extraLists.push(list);
      } else {
        extraLists.push(null);
      }
    }
    const baseY = probe.getBoundingClientRect().bottom;
    const rects = rawChildren.map((el) => el.getBoundingClientRect());
    if (rects[0] && rects[0].height > 0) {
      domCyEm = clamp((rects[0].top + rects[0].height / 2 - baseY) / tmpFs, -0.55, -0.15);
    }
    for (let ui = 0; ui < rawChildren.length; ui++) {
      const rt = rts[ui]!;
      const gu = g.units[ui]!;
      const ur = rects[ui]!;
      const chList = extraLists[ui] ?? rt.chs;
      if (chList && chList.length > 1 && chList.length === gu.edges.length - 1) {
        const wordMid = ur.left + ur.width * 0.5;
        const straightX = chList.map((v) => {
          const r = v.el.getBoundingClientRect();
          return (r.left + r.width * 0.5 - wordMid) / tmpFs;
        });
        const isExtra = !!extraLists[ui];
        if (isExtra) {
          const wTotal = Math.max(1e-4, gu.w);
          for (let j = 0; j < chList.length; j++) {
            const dw = Math.max(1e-4, (gu.edges[j + 1]! - gu.edges[j]!) / wTotal);
            chList[j]!.set('--f', `${((0.26 / dw) * 100).toFixed(1)}%`);
          }
        }
        charCurves.push({
          vars: chList,
          straightX,
          extra: isExtra,
          lastCx: new Array(chList.length).fill(''),
          lastCy: new Array(chList.length).fill(''),
          lastCr: new Array(chList.length).fill(''),
          lastK: -1,
          lastPState: 99,
        });
      } else {
        charCurves.push(null);
      }
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
      const sg = ui >= splitUi ? seg1! : seg0;
      const em = gu.left + gu.w / 2;
      const pr = projectUnit(em, invW, sg, fs, uCy, warp, cam);
      applyCharCurve(ui, uEl, sg, pr, warp, cam, initCurveK, true);
      bumpRev(uEl);
      const slot = document.createElement('div');
      slot.className = 'tv-fly-slot';
      slot.appendChild(uEl);
      host.appendChild(slot);
      const pObj = { x: pr.x, y: pr.y, f: pr.fsPx, rot: pr.rot, st: state };
      writeSlotDom(slot, pObj);
      const side: FlySide = {
        el: uEl,
        ctx: state === 'cur' ? 'lpm-c is-grad' : 'lpm-c',
        rot: pr.rot,
        vert: false,
        opacity: pr.vis,
        place: () => pObj,
      };
      units.push(uEl);
      slots.push(slot);
      sides.push(side);
      places.push(pObj);
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
    const em = g.width / 2;
    const pr = projectUnit(em, invW, seg0, fs, domCyEm, warp, cam);
    bumpRev(wholeEl);
    const slot = document.createElement('div');
    slot.className = 'tv-fly-slot';
    slot.appendChild(wholeEl);
    host.appendChild(slot);
    tmp.remove();
    const pObj = { x: pr.x, y: pr.y, f: pr.fsPx, rot: pr.rot, st: state };
    writeSlotDom(slot, pObj);
    const side: FlySide = {
      el: wholeEl,
      ctx: 'lpm-c',
      rot: pr.rot,
      vert: false,
      opacity: pr.vis,
      place: () => pObj,
    };
    units.push(wholeEl);
    slots.push(slot);
    sides.push(side);
    places.push(pObj);
  }

  return {
    lineIdx,
    text: line.text,
    units,
    sides,
    update(nextSegs, nextWarp, nextCam, nextT, nextScheme, nextState, curveK = 1) {
      const s0 = nextSegs[0];
      if (!s0) return;
      updFrame++;
      if (rts) {
        syncWords(rts, nextT, nextScheme, nextState);
        const s1 = nextSegs.length > 1 ? nextSegs[1]! : null;
        const splitUi = s1 ? s1.from : 1e9;
        for (let ui = 0; ui < places.length; ui++) {
          const gu = g.units[ui]!;
          const sg = ui >= splitUi ? s1! : s0;
          const em = gu.left + gu.w / 2;
          const pr = projectUnit(em, invW, sg, fs, cyEms[ui] ?? domCyEm, nextWarp, nextCam);
          applyCharCurve(ui, units[ui]!, sg, pr, nextWarp, nextCam, curveK);
          const pObj = places[ui]!;
          pObj.x = pr.x;
          pObj.y = pr.y;
          pObj.f = pr.fsPx;
          pObj.rot = pr.rot;
          pObj.st = nextState;
          sides[ui]!.rot = pr.rot;
          sides[ui]!.opacity = pr.vis;
        }
      } else if (wholeEl && places[0] && sides[0]) {
        const on = nextT >= line.s;
        if (wholeEl.classList.contains('is-on') !== on) {
          wholeEl.classList.toggle('is-on', on);
          bumpRev(wholeEl);
        }
        const pr = projectUnit(g.width / 2, invW, s0, fs, domCyEm, nextWarp, nextCam);
        const pObj = places[0];
        pObj.x = pr.x;
        pObj.y = pr.y;
        pObj.f = pr.fsPx;
        pObj.rot = pr.rot;
        pObj.st = nextState;
        sides[0].rot = pr.rot;
        sides[0].opacity = pr.vis;
      }
    },
    syncSlots() {
      for (let i = 0; i < slots.length; i++) writeSlotDom(slots[i]!, places[i]!);
    },
    clear() {
      host.innerHTML = '';
    },
  };
}
