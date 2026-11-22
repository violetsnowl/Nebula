import type { TCtx, TLine } from './types';

/** 大胆版式共用的小工具：装饰元素、分段、按字数撑满、挑词。 */

type Style = Partial<Record<keyof CSSStyleDeclaration, string>>;

/** 页上的装饰（细线、大字、沟槽、格子、色块）：都带 .lp-deco，重排前由引擎整批清掉。 */
export function deco(c: TCtx, cls: string, style?: Style, parent: HTMLElement = c.page): HTMLElement {
  const d = document.createElement('div');
  d.className = `lp-deco ${cls}`;
  if (style) Object.assign(d.style, style);
  parent.appendChild(d);
  return d;
}

export const px = (v: number) => `${Math.round(v * 100) / 100}px`;

/** 把一句放到 (left, top)，字号 fs（逻辑像素）。 */
export function put(l: TLine, left: number, top: number, fs?: number): void {
  l.el.style.left = px(left);
  l.el.style.top = px(top);
  if (fs != null) l.tx.style.fontSize = px(fs);
}

/** 撤销分段：把 .lp-seg 里的字和空格原样放回 .lp-tx。 */
export function flatten(l: TLine): void {
  const segs = [...l.tx.querySelectorAll<HTMLElement>(':scope > .lp-seg')];
  if (!segs.length) return;
  for (const s of segs) {
    while (s.firstChild) l.tx.insertBefore(s.firstChild, s);
    s.remove();
  }
}

/**
 * 把一句的字分成几段（行 / 列 / 横竖两截），每段一个 .lp-seg 块。cuts = 第 2、3…段第一个字的下标（升序）。
 * 引擎量字时按段累计位置（波浪的演唱位置跨段也只往前走）。cls(k) = 第 k 段额外的类名（.lp-seg-v = 这一段竖排）。
 */
export function segment(l: TLine, cuts: number[], cls: (k: number) => string = () => ''): HTMLElement[] {
  flatten(l);
  const segs: HTMLElement[] = [];
  const mk = (k: number) => {
    const s = document.createElement('span');
    s.className = `lp-seg ${cls(k)}`.trim();
    segs.push(s);
    return s;
  };
  let cur = mk(0);
  let ui = 0;
  const nodes = [...l.tx.childNodes];
  l.tx.textContent = '';
  for (const n of nodes) {
    if (n instanceof HTMLElement && n.classList.contains('u')) {
      if (cuts.includes(ui) && ui > 0) cur = mk(segs.length);
      ui++;
    }
    cur.appendChild(n);
  }
  for (const s of segs) l.tx.appendChild(s);
  return segs;
}

/** 字母数（拉丁按字母、中日韩按字；空格不算）。 */
export const glyphs = (s: string) => [...s.replace(/\s+/g, '')].length;

/** 一句在哪个字处断成两截：拉丁取最靠近字母数一半的词缝（优先逗号后），中日韩优先全角空格 / 标点、再按分词取中点。-1 = 太短不断。 */
export function splitAt(l: TLine, cjk: boolean, min: number): number {
  const us = l.units;
  if (us.length < 2 || glyphs(l.text) <= min) return -1;
  const lens = us.map((u) => glyphs(u.textContent ?? ''));
  const total = lens.reduce((a, b) => a + b, 0);
  // 句中自带的停顿：全角空格（中日韩句子常见）或逗号后
  for (let i = 1; i < us.length; i++) {
    const prev = us[i - 1]!.textContent ?? '';
    const gapNode = us[i - 1]!.nextSibling;
    const cjkGap = cjk && (!!l.eu?.[i - 1]?.sp || (gapNode?.nodeType === 3 && /\s/.test(gapNode.textContent ?? '')));
    if (/[,，、;；]$/.test(prev) || cjkGap) {
      const before = lens.slice(0, i).reduce((a, b) => a + b, 0);
      if (before >= total * 0.3 && before <= total * 0.7) return i;
    }
  }
  const bounds = cjk ? wordBounds(l) : null;
  let best = -1;
  let bd = Infinity;
  let acc = 0;
  for (let i = 1; i < us.length; i++) {
    acc += lens[i - 1]!;
    if (bounds && !bounds.has(i)) continue;
    const d = Math.abs(acc - total / 2);
    if (d < bd) {
      bd = d;
      best = i;
    }
  }
  return best;
}

/** 中日韩分词：返回「词首字」的下标集合（按 .u 计）。没有 Intl.Segmenter 时每个字都算词首。 */
export function wordBounds(l: TLine): Set<number> {
  const out = new Set<number>([0]);
  const Seg = (Intl as unknown as { Segmenter?: new (l?: string, o?: { granularity: string }) => { segment: (s: string) => Iterable<{ index: number }> } }).Segmenter;
  const ts = l.units.map((u) => u.textContent ?? '');
  if (!Seg) {
    ts.forEach((_, i) => out.add(i));
    return out;
  }
  const joined = ts.join('');
  const starts: number[] = [];
  let off = 0;
  for (const t of ts) {
    starts.push(off);
    off += t.length;
  }
  for (const s of new Seg(undefined, { granularity: 'word' }).segment(joined)) {
    const k = starts.indexOf(s.index);
    if (k >= 0) out.add(k);
  }
  return out;
}

/** 唱得最久的那个词（中日韩扩到所在的词，最多 3 个字）：返回 .u 的下标区间 [a, b]。 */
export function heldRange(l: TLine, cjk: boolean): [number, number] | null {
  const eu = l.eu;
  if (!eu?.length || eu.length !== l.units.length) return null;
  let k = 0;
  let best = -1;
  eu.forEach((u, i) => {
    const d = u.e - u.s + glyphs(u.t) * 0.001;
    if (d > best) {
      best = d;
      k = i;
    }
  });
  if (!cjk) return [k, k];
  const b = wordBounds(l);
  let a = k;
  while (a > 0 && !b.has(a)) a--;
  let z = k;
  while (z + 1 < l.units.length && !b.has(z + 1)) z++;
  return z - a <= 2 ? [a, z] : [k, k];
}

/** 先按 100px 量自然尺寸，再把字号定成让它沿某个方向正好撑满 len。返回定下的字号。 */
export function fitTo(c: TCtx, el: HTMLElement, len: number, vert: boolean, max = 400): number {
  el.style.fontSize = '100px';
  const s = c.size(el);
  const n = vert ? s.h : s.w;
  const fs = n > 0 ? Math.min(max, (100 * len) / n) : 40;
  el.style.fontSize = px(fs);
  return fs;
}

/** 把翻译挪到页上（脱离 .lp-line，引擎照样按句子状态给它 is-on）。 */
export function lift(c: TCtx, l: TLine, left: number, top: number, cls = ''): HTMLElement | null {
  if (!l.tr) return null;
  c.page.appendChild(l.tr);
  l.tr.className = `lp-tr is-free ${cls}`.trim();
  l.tr.style.left = px(left);
  l.tr.style.top = px(top);
  return l.tr;
}

/** 词的规范写法：小写、去掉标点（比较重复词用）。 */
export const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}']/gu, '');

/** 一句里组成 hook 的字（拉丁 = 等于它的词；中日韩 = 连起来等于它的几个字）。 */
export function hookRuns(l: TLine, hook: string, cjk: boolean): number[][] {
  const ts = l.units.map((u) => norm(u.textContent ?? ''));
  const out: number[][] = [];
  if (!cjk) {
    ts.forEach((t, i) => {
      if (t === hook) out.push([i]);
    });
    return out;
  }
  const n = [...hook].length;
  for (let i = 0; i + n <= ts.length; i++) if (ts.slice(i, i + n).join('') === hook) out.push(Array.from({ length: n }, (_, k) => i + k));
  return out;
}

/** 把原元素的逐帧状态（行内变量、类名，含子节点）同步到它的克隆上（色场的「色块里那一份」用）。 */
export function syncClone(from: HTMLElement, to: HTMLElement): void {
  if (to.style.cssText !== from.style.cssText) to.style.cssText = from.style.cssText;
  if (to.className !== from.className) to.className = from.className;
  const fc = from.children;
  const tc = to.children;
  for (let i = 0; i < fc.length && i < tc.length; i++) syncClone(fc[i] as HTMLElement, tc[i] as HTMLElement);
}

/** 一句在 t 时的状态（同引擎：唱完 0.9s 内仍算「正在唱」）。 */
export const stateAt = (l: TLine, t: number): 'future' | 'cur' | 'past' => (t > l.te + 0.9 ? 'past' : t >= l.ts - 0.05 ? 'cur' : 'future');

/** 第 i 个字在 t 时唱到几成（0–1）；整句没有逐字时间时按整句。 */
export function unitP(l: TLine, i: number, t: number): number {
  const u = l.eu?.[i];
  const s = u ? u.s : l.ts;
  const e = u ? u.e : l.te;
  return Math.max(0, Math.min(1, (t - s) / Math.max(0.001, e - s)));
}
