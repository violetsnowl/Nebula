import { deco, fitTo, glyphs, lift, norm, put, px, segment, syncClone, wordBounds } from './kit';
import { PH, PW, type PageHooks, type TCtx, type TLine, type Tpl } from './types';

/**
 * 样张 O 第一批（2026-11-25 用户认可）：断层、回声滚筒。横排（拉丁、日韩）和竖排（中文）两种。
 * 两套的图形都会动，但只在唱腔触发的那一刻动一次：断层 = 声音越过断口；滚筒 = 换句。其余时间不逐帧重算。
 * 坐标一律是 1600 × 900 的逻辑像素。
 */

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const easeIO = (x: number) => {
  const t = clamp(x, 0, 1);
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
};
const allTimed = (c: TCtx) => c.lines.every((l) => l.units.length > 0 && l.eu?.length === l.units.length);

/** 一个字本身的范围（页内逻辑像素，扣掉上色留白）。 */
interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}
function unitBox(c: TCtx, u: HTMLElement): Box {
  const pr = c.page.getBoundingClientRect();
  const S = pr.width / PW || 1;
  const r = u.getBoundingClientRect();
  const cs = getComputedStyle(u);
  const n = (v: string) => parseFloat(v) || 0;
  return {
    x: (r.left - pr.left) / S + n(cs.paddingLeft),
    y: (r.top - pr.top) / S + n(cs.paddingTop),
    w: r.width / S - n(cs.paddingLeft) - n(cs.paddingRight),
    h: r.height / S - n(cs.paddingTop) - n(cs.paddingBottom),
  };
}

// ———— 断层（桥段）：声音每越过一次断口，另一半就顺着断口错开一截 ————
/** 横排断口：顶 → 底的 x；竖排断口：左 → 右的 y（样张 O）。句子够不着时整条断口往回挪。 */
const FX: [number, number] = [940, 700];
const FY: [number, number] = [252, 600];

/** 横排每句最好的断行处（两行里较长那行最短）；-1 = 断不了。 */
function rowCut(c: TCtx, l: TLine, bx: Box[]): number {
  const n = bx.length;
  const ok = c.cjk ? wordBounds(l) : null;
  let best = -1;
  let w = Infinity;
  for (let i = 1; i < n; i++) {
    if (ok ? !ok.has(i) : !l.eu![i - 1]!.sp) continue;
    const a = bx[i - 1]!.x + bx[i - 1]!.w - bx[0]!.x;
    const b = bx[n - 1]!.x + bx[n - 1]!.w - bx[i]!.x;
    // 第一行略长更好看（断口压在第一行上）
    const m = Math.max(a, b * 1.12);
    if (m < w) {
      w = m;
      best = i;
    }
  }
  return best;
}

export const fault: Tpl = {
  id: 'fault',
  bold: true,
  fits: (c) => c.lines.length >= 3 && c.lines.length <= 4 && allTimed(c) && c.lines.every((l) => glyphs(l.text) <= (c.cjk ? 10 : 32) && glyphs(l.text) >= (c.cjk ? 3 : 8)),
  layout: (c) => {
    const n = c.lines.length;
    for (const l of c.lines) {
      l.el.classList.add('lt-fault');
      put(l, 0, 0, 100);
    }
    if (c.vert) {
      let f = 93;
      for (const l of c.lines) f = Math.min(f, (100 * 750) / Math.max(1, c.size(l.tx).h));
      c.lines.forEach((l, i) => put(l, 1330 - (4 - n) * 110 - i * 296, 48, f));
      return;
    }
    // 横排：每句一两行、最多五行，选能让字号最大的断法
    const bx = c.lines.map((l) => l.units.map((u) => unitBox(c, u)));
    const cuts = c.lines.map((l, i) => rowCut(c, l, bx[i]!));
    const span = (i: number, a: number, b: number) => bx[i]![b]!.x + bx[i]![b]!.w - bx[i]![a]!.x;
    let best = { fs: 0, mask: 0, rows: n };
    for (let mask = 0; mask < 1 << n; mask++) {
      let rows = 0;
      let wide = 1;
      let bad = false;
      c.lines.forEach((l, i) => {
        const z = l.units.length - 1;
        if (mask & (1 << i)) {
          if (cuts[i]! < 0) bad = true;
          else {
            rows += 2;
            wide = Math.max(wide, span(i, 0, cuts[i]! - 1), span(i, cuts[i]!, z));
          }
        } else {
          rows += 1;
          wide = Math.max(wide, span(i, 0, z));
        }
      });
      if (bad || rows > 5) continue;
      const fs = Math.min(146, (100 * 1430) / wide, 680 / (rows * 0.9315));
      if (fs > best.fs + 0.5) best = { fs, mask, rows };
    }
    const fs = best.fs || 80;
    const P = fs * 0.9315;
    // 行数少时整块往下放一点，别全挤在上半页
    let y = 58 + Math.max(0, 680 - best.rows * P) * 0.42;
    c.lines.forEach((l, i) => {
      const two = !!(best.mask & (1 << i));
      if (two) segment(l, [cuts[i]!], () => 'lp-row');
      put(l, 112, y, fs);
      y += (two ? 2 : 1) * P;
    });
    const per = n > 3 ? 2 : 3;
    c.lines.forEach((l, i) => lift(c, l, 116 + Math.floor(i / per) * 300, Math.min(y, 742) + 4 + (i % per) * 27));
  },
  finish: (c) => {
    const vert = c.vert;
    const boxes = new Map<HTMLElement, Box>();
    for (const l of c.lines) for (const u of l.units) boxes.set(u, unitBox(c, u));
    /** 一句按读向排好的几行（竖排就是一列）。 */
    const rowsOf = (l: TLine): HTMLElement[][] => {
      const segs = [...l.tx.querySelectorAll<HTMLElement>(':scope > .lp-seg')];
      return segs.length ? segs.map((s) => l.units.filter((u) => s.contains(u))) : [l.units];
    };
    // —— 断口的位置：每句都要越过断口一截，够不着就整条往回挪 ——
    const [p1, p2] = vert ? FY : FX;
    const L = vert ? PW : PH;
    const at0 = (v: number) => p1 + ((p2 - p1) * v) / L;
    let reach = Infinity;
    for (const l of c.lines) {
      let m = -Infinity;
      for (const r of rowsOf(l)) {
        const b = boxes.get(r[r.length - 1]!)!;
        m = Math.max(m, vert ? b.y + b.h - at0(b.x + b.w / 2) : b.x + b.w - at0(b.y + b.h / 2));
      }
      reach = Math.min(reach, m);
    }
    const shift = clamp(Math.min(0, reach - 110), vert ? -230 : -430, 0);
    const a = p1 + shift;
    const z = p2 + shift;
    const at = (v: number) => a + ((z - a) * v) / L;
    // —— 每句越过断口的时刻：压在断口上的那个字，按断口在字里的位置插值 ——
    const cross: number[] = [];
    for (const l of c.lines) {
      let hit = -1;
      for (const r of rowsOf(l)) {
        for (const u of r) {
          const b = boxes.get(u)!;
          const q = vert ? at(b.x + b.w / 2) : at(b.y + b.h / 2);
          const s = vert ? b.y : b.x;
          const len = vert ? b.h : b.w;
          // 断口落在词缝里：算前一个字唱完那一刻
          if (q >= s && q <= s + len + (vert ? 0 : len * 0.1 + 40)) {
            const e = l.eu![l.units.indexOf(u)]!;
            hit = e.s + (e.e - e.s) * clamp((q - s) / Math.max(1, len), 0, 1);
            break;
          }
        }
        if (hit >= 0) break;
      }
      if (hit >= 0) cross.push(hit);
    }
    // —— 错开的那半：一块不透明的色纸，里面是所有句子的第二份；顺着断口方向平移 ——
    const slab = deco(c, 'lp-slab');
    slab.setAttribute('aria-hidden', 'true');
    const B = 1200;
    const edge = document.createElement('i');
    edge.className = vert ? 'lp-slab-edge is-v' : 'lp-slab-edge';
    const deg = vert ? (Math.atan2(z - a, PW) * 180) / Math.PI : (Math.atan2(a - z, PH) * 180) / Math.PI;
    Object.assign(edge.style, vert ? { left: px(-B), top: px(a - 60), transformOrigin: `${B}px 60px` } : { left: px(a - 60), top: px(-B), transformOrigin: `60px ${B}px` });
    edge.style.transform = `rotate(${deg.toFixed(4)}deg)`;
    const body = document.createElement('div');
    body.className = 'lp-slab-in';
    body.style.clipPath = vert
      ? `polygon(0 ${px(B + at(-B))}, 4000px ${px(B + at(4000 - B))}, 4000px 3300px, 0 3300px)`
      : `polygon(${px(B + at(-B))} 0, 4000px 0, 4000px 3300px, ${px(B + at(3300 - B))} 3300px)`;
    const box = document.createElement('div');
    box.className = 'lp-slab-box';
    body.appendChild(box);
    slab.append(edge, body);
    const pairs = c.lines.flatMap((l) => {
      const out = [l.el, ...(l.tr && l.tr.parentElement !== l.el ? [l.tr] : [])].map((el) => {
        const copy = el.cloneNode(true) as HTMLElement;
        box.appendChild(copy);
        return { from: el, copy };
      });
      return out;
    });
    // 总错开量不超过行距的四成
    const fs = parseFloat(c.lines[0]!.tx.style.fontSize) || 100;
    const total = vert ? 92 : Math.min(54, fs * 0.9315 * 0.4);
    const vec: [number, number] = vert ? [-1, -(z - a) / PW] : [(z - a) / PH, 1];
    const side = new Map<HTMLElement, boolean>();
    for (const [u, b] of boxes) side.set(u, vert ? b.y + b.h / 2 > at(b.x + b.w / 2) : b.x + b.w / 2 > at(b.y + b.h / 2));
    let last = -1;
    let k = 0;
    const hooks: PageHooks = {
      frame: (t) => {
        for (const p of pairs) syncClone(p.from, p.copy);
        let n = 0;
        for (const x of cross) if (t >= x) n++;
        if (n === last) return;
        last = n;
        k = cross.length ? (total * n) / cross.length : 0;
        slab.style.transform = `translate(${px(vec[0] * k)}, ${px(vec[1] * k)})`;
      },
      fly: (u) => (k && side.get(u) ? { dx: vec[0] * k, dy: vec[1] * k, sx: 1, sy: 1 } : null),
    };
    return hooks;
  },
};

// ———— 回声滚筒（尾声、重复副歌）：反复唱的短句一行行裹在滚筒上，换句转一格 ————
const H_LEN = 1556;
const V_LEN = 772;

type U = { t: string; sp: boolean };

/** 一句显示出来的样子：拉丁词之间补空格（引擎的正文把空格去掉了）。 */
function shown(us: readonly U[] | null | undefined, text: string, vert: boolean): string {
  if (!us?.length) return text.trim();
  return us.map((u, i) => u.t + (u.sp && i < us.length - 1 && !vert ? ' ' : '')).join('');
}

/** 一句拆成滚筒上的几格：竖排按句中的停顿拆列（每列至少 3 个字，否则不拆）；横排一句一格。from = 这一格第一个字的下标。 */
function parts(us: readonly U[] | null | undefined, text: string, vert: boolean): { from: number; text: string }[] {
  if (!vert || !us?.length) return [{ from: 0, text: shown(us, text, vert) }];
  const out: { from: number; text: string }[] = [];
  let cur = 0;
  us.forEach((u, i) => {
    if ((u.sp && i < us.length - 1) || i === us.length - 1) {
      out.push({ from: cur, text: us.slice(cur, i + 1).map((x) => x.t).join('') });
      cur = i + 1;
    }
  });
  return out.length > 1 && out.every((q) => glyphs(q.text) >= 3) ? out : [{ from: 0, text: shown(us, text, true) }];
}

/** 全曲滚筒格：顺序、属于第几句、规范写法。 */
interface Cell {
  line: number;
  text: string;
  key: string;
}
function songCells(c: TCtx): Cell[] {
  return c.song.flatMap((l, i) => parts(l.units, l.text, c.vert).map((q) => ({ line: i, text: q.text, key: norm(q.text) })));
}

/** key 在一句里出现几次（规范写法里数，短句常嵌在长句里：「So burn slow, burn slow」里有两遍 burn slow）。 */
function occ(line: string, key: string): number {
  if (!key) return 0;
  let n = 0;
  for (let i = line.indexOf(key); i >= 0; i = line.indexOf(key, i + key.length)) n++;
  return n;
}

/** 这一页反复唱的短句：本页至少两遍、全曲四遍以上，取遍数最多的。返回规范写法和显示文字。 */
function drumPhrase(c: TCtx): { key: string; text: string } | null {
  const to = c.first + c.lines.length;
  const keys = c.song.map((l) => norm(l.text));
  let best: { key: string; text: string } | null = null;
  let score = 0;
  for (const x of songCells(c)) {
    if (x.line < c.first || x.line >= to || !x.key) continue;
    let here = 0;
    let tot = 0;
    keys.forEach((k, i) => {
      const n = occ(k, x.key);
      tot += n;
      if (i >= c.first && i < to) here += n;
    });
    if (here < 2 || tot < 4) continue;
    const s = here * 10 + tot;
    if (s > score) {
      score = s;
      best = { key: x.key, text: x.text };
    }
  }
  return best;
}

interface Item {
  el: HTMLElement;
  echo: 'a' | 'b' | null;
  /** 开唱（秒）。 */
  ts: number;
  /** 这一格沿筒面的长度、字号、中心。 */
  h: number;
  cap: number;
  s: number;
}
const drumSegs = new WeakMap<HTMLElement, HTMLElement[]>();

export const drum: Tpl = {
  id: 'drum',
  bold: true,
  fits: (c) =>
    c.lines.length >= 2 &&
    c.lines.length <= 6 &&
    allTimed(c) &&
    c.lines.every((l) =>
      parts(l.eu, l.text, c.vert).every((q) => {
        const g = glyphs(q.text);
        return c.vert ? g >= 3 && g <= 10 : c.cjk ? g >= 3 && g <= 18 : g >= 6 && g <= 40;
      }),
    ) &&
    drumPhrase(c) != null,
  layout: (c) => {
    for (const l of c.lines) {
      l.el.classList.add('lt-drum', 'lt-heavy');
      if (c.vert) {
        l.el.classList.add('lt-drumv');
        // 按停顿拆列：每一列是一段（.lp-seg）
        const cuts = parts(l.eu, l.text, true).map((q) => q.from).filter((i) => i > 0);
        const segs = segment(l, cuts, () => 'lp-op');
        put(l, 0, 0);
        for (const s of segs) {
          const fs = fitTo(c, s, V_LEN, true, 250);
          s.style.left = '0px';
          s.style.top = px(14 + (V_LEN - c.size(s).h) / 2);
          s.dataset.fs = String(fs);
        }
        drumSegs.set(l.el, segs);
        continue;
      }
      l.tx.classList.add('lp-op');
      const fs = fitTo(c, l.tx, H_LEN, false, 340);
      put(l, (PW - c.size(l.tx).w) / 2, 0, fs);
      if (l.tr) l.tr.className = 'lp-tr is-drum';
    }
  },
  finish: (c) => {
    const phrase = drumPhrase(c);
    if (!phrase) return;
    const vert = c.vert;
    const R = vert ? 812 : 404;
    const CY = 432;
    const CX = 800;
    const GAP = vert ? 26 : 18;
    const CAP = c.cjk ? 0.92 : 0.727;
    const to = c.first + c.lines.length;
    // 页外的遍数。横排：每句里唱了几遍这个短句就补几行；竖排：连同一起反复的半句（它们本来就一列接一列）
    let before: Cell[];
    let after: Cell[];
    if (vert) {
      const cells = songCells(c);
      const count = new Map<string, number>();
      for (const x of cells) count.set(x.key, (count.get(x.key) ?? 0) + 1);
      const isEcho = (x: Cell) => (count.get(x.key) ?? 0) >= 2 && glyphs(x.text) <= 10 && glyphs(x.text) >= 3;
      before = cells.filter((x) => x.line < c.first && isEcho(x)).slice(-7);
      after = cells.filter((x) => x.line >= to && isEcho(x)).slice(0, 6);
    } else {
      const rep = (i: number): Cell[] => Array.from({ length: occ(norm(c.song[i]!.text), phrase.key) }, () => ({ line: i, text: phrase.text, key: phrase.key }));
      before = c.song.flatMap((_, i) => (i < c.first ? rep(i) : [])).slice(-4);
      after = c.song.flatMap((_, i) => (i >= to ? rep(i) : [])).slice(0, 4);
    }
    const items: Item[] = [];
    const add = (el: HTMLElement, fs: number, echo: Item['echo'], ts: number, tr: boolean) => {
      const cap = vert ? fs * 0.96 : fs * CAP;
      items.push({ el, echo, ts, h: cap + GAP + (tr ? 22 : 0), cap, s: 0 });
    };
    const echoEl = (x: Cell, k: 'a' | 'b') => {
      const d = deco(c, `lp-drow lp-rot echo-${k}${vert ? ' is-v' : ''}`);
      d.setAttribute('aria-hidden', 'true');
      d.textContent = x.text.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
      const fs = fitTo(c, d, vert ? V_LEN : H_LEN, vert, vert ? 250 : 340);
      if (vert) d.style.top = px(14 + (V_LEN - c.size(d).h) / 2);
      else d.style.left = px((PW - c.size(d).w) / 2);
      add(d, fs, k, 0, false);
    };
    const own = new Map<HTMLElement, Item>();
    for (const x of before) echoEl(x, 'a');
    for (const l of c.lines) {
      if (vert) {
        for (const s of drumSegs.get(l.el) ?? []) {
          const us = l.units.filter((u) => s.contains(u));
          if (!us.length) continue;
          s.classList.add('lp-rot');
          add(s, Number(s.dataset.fs) || 100, null, l.eu![l.units.indexOf(us[0]!)]!.s, false);
          for (const u of us) own.set(u, items[items.length - 1]!);
        }
      } else {
        l.el.classList.add('lp-rot');
        add(l.el, parseFloat(l.tx.style.fontSize) || 100, null, l.eu![0]!.s, !!l.tr);
        for (const u of l.units) own.set(u, items[items.length - 1]!);
      }
    }
    for (const x of after) echoEl(x, 'b');
    let s = 0;
    for (const it of items) {
      it.s = s + it.h / 2;
      s += it.h;
    }
    const act = items.filter((it) => !it.echo);
    if (!act.length) return;
    const cosOf = new Map<Item, number>();
    let lastPos = NaN;
    const frame = (t: number) => {
      // 换句时转一格：下一句开始前 0.5s 起，0.65s
      let pos = act[0]!.s;
      for (let i = 1; i < act.length; i++) {
        const x = (t - (act[i]!.ts - 0.5)) / 0.65;
        if (x > 0) pos += (act[i]!.s - act[i - 1]!.s) * easeIO(x);
      }
      if (pos === lastPos) return;
      lastPos = pos;
      for (const it of items) {
        const ph = (it.s - pos) / R;
        const vis = Math.abs(ph) < 1.5;
        it.el.style.visibility = vis ? '' : 'hidden';
        it.el.toggleAttribute('data-edge', Math.abs(ph) > 1.2);
        const cs = Math.cos(ph);
        cosOf.set(it, Math.max(0.02, cs));
        if (!vis) continue;
        it.el.style.setProperty('--do', (it.echo ? 0.34 + 0.6 * cs : 0.36 + 0.64 * cs).toFixed(3));
        it.el.style.transform = vert
          ? `translate(${px(CX - R * Math.sin(ph) - it.cap / 1.92)}, 0) scaleX(${cs.toFixed(4)})`
          : `translate(0, ${px(CY + R * Math.sin(ph) - it.cap / 2)}) scaleY(${cs.toFixed(4)})`;
      }
    };
    frame(-1);
    return {
      frame,
      fly: (u) => {
        const it = own.get(u);
        if (!it) return null;
        const k = cosOf.get(it) ?? 1;
        return vert ? { dx: 0, dy: 0, sx: k, sy: 1 } : { dx: 0, dy: 0, sx: 1, sy: k };
      },
    };
  },
};
