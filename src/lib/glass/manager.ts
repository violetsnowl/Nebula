import { displacementMapUrl } from './displacement';
import { GLASS_THEMES, glassThemeCssVars, type GlassTheme, type GlassTier } from './materials';

/**
 * GlassManager（docs/design/NEBULA_UI_SYSTEM.md §3.6）：
 * 为每个 G1 / G2 玻璃面创建一个 SVG 滤镜（位移贴图 + RGB 三通道色散），尺寸变化时重建贴图；
 * 通过元素上的 `--glass-filter: url(#id)` 交给 CSS 的 backdrop-filter 使用。G3 不折射，不注册滤镜。
 *
 * 主题切换：applyGlassTheme 写根节点档位变量 + 更新所有滤镜的折射 scale（只改 scale 不需要重建贴图）。
 */

const SVG_NS = 'http://www.w3.org/2000/svg';
const XLINK_NS = 'http://www.w3.org/1999/xlink';
const RESIZE_DEBOUNCE_MS = 120;

interface FilterNodes {
  filter: SVGFilterElement;
  map: SVGFEImageElement;
  r: SVGFEDisplacementMapElement;
  g: SVGFEDisplacementMapElement;
  b: SVGFEDisplacementMapElement;
}

interface Surface {
  el: HTMLElement;
  tier: GlassTier;
  nodes: FilterNodes;
  key: string;
  ready: boolean;
  timer: number;
}

let defs: SVGDefsElement | null = null;
let seq = 0;
let currentTheme: GlassTheme = 'liquid';
const surfaces = new Set<Surface>();

function svgEl<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string>): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, tag);
  Object.entries(attrs).forEach(([k, v]) => node.setAttribute(k, v));
  return node;
}

function ensureDefs(): SVGDefsElement {
  if (defs && defs.isConnected) return defs;
  const svg = svgEl('svg', { width: '0', height: '0', 'aria-hidden': 'true', focusable: 'false' });
  svg.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;pointer-events:none';
  defs = svgEl('defs', {});
  svg.appendChild(defs);
  document.body.appendChild(svg);
  return defs;
}

const CHANNEL_MATRIX = {
  r: '1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0',
  g: '0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0',
  b: '0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0',
};

function createFilter(id: string): FilterNodes {
  const filter = svgEl('filter', {
    id,
    x: '0',
    y: '0',
    width: '100%',
    height: '100%',
    'color-interpolation-filters': 'sRGB',
  });
  const map = svgEl('feImage', { x: '0', y: '0', width: '1', height: '1', preserveAspectRatio: 'none', result: 'map' });
  filter.appendChild(map);
  const channel = (c: 'r' | 'g' | 'b') => {
    const dm = svgEl('feDisplacementMap', {
      in: 'SourceGraphic',
      in2: 'map',
      scale: '0',
      xChannelSelector: 'R',
      yChannelSelector: 'G',
      result: `d${c}`,
    });
    filter.appendChild(dm);
    filter.appendChild(svgEl('feColorMatrix', { in: `d${c}`, type: 'matrix', values: CHANNEL_MATRIX[c], result: c }));
    return dm;
  };
  const r = channel('r');
  const g = channel('g');
  const b = channel('b');
  filter.appendChild(svgEl('feBlend', { in: 'r', in2: 'g', mode: 'screen', result: 'rg' }));
  filter.appendChild(svgEl('feBlend', { in: 'rg', in2: 'b', mode: 'screen' }));
  return { filter, map, r, g, b };
}

function applyScales(s: Surface): void {
  const p = GLASS_THEMES[currentTheme][s.tier];
  const scale = s.ready ? p.refraction * 2 : 0;
  s.nodes.r.setAttribute('scale', String(scale));
  s.nodes.g.setAttribute('scale', String(scale * (1 - p.dispersion)));
  s.nodes.b.setAttribute('scale', String(scale * (1 - 2 * p.dispersion)));
}

function rebuild(s: Surface): void {
  const w = Math.round(s.el.offsetWidth);
  const h = Math.round(s.el.offsetHeight);
  if (w < 8 || h < 8) return;
  const radius = parseFloat(getComputedStyle(s.el).borderTopLeftRadius) || 0;
  const key = `${w}x${h}x${radius}`;
  if (key === s.key) return;
  s.key = key;
  const url = displacementMapUrl(w, h, radius);
  if (!url) return;
  s.nodes.map.setAttribute('href', url);
  s.nodes.map.setAttributeNS(XLINK_NS, 'xlink:href', url);
  s.nodes.map.setAttribute('width', String(w));
  s.nodes.map.setAttribute('height', String(h));
  if (!s.ready) {
    s.ready = true;
    applyScales(s);
  }
}

/**
 * 注册一个玻璃面；返回注销函数。G3 只返回空注销（不折射）。
 * 贴图生成前折射 scale 保持 0，避免首帧用空贴图造成整体偏移。
 */
export function registerGlass(el: HTMLElement, tier: GlassTier): () => void {
  if (tier === 'g3' || typeof document === 'undefined') return () => {};
  const id = `nebula-glass-${++seq}`;
  const nodes = createFilter(id);
  ensureDefs().appendChild(nodes.filter);
  const s: Surface = { el, tier, nodes, key: '', ready: false, timer: 0 };
  surfaces.add(s);
  applyScales(s);
  rebuild(s);
  el.style.setProperty('--glass-filter', `url(#${id})`);
  const ro = new ResizeObserver(() => {
    window.clearTimeout(s.timer);
    s.timer = window.setTimeout(() => rebuild(s), RESIZE_DEBOUNCE_MS);
  });
  ro.observe(el);
  return () => {
    ro.disconnect();
    window.clearTimeout(s.timer);
    nodes.filter.remove();
    surfaces.delete(s);
    el.style.removeProperty('--glass-filter');
  };
}

/** 切换材质主题：写根节点档位变量 + data-glass 属性 + 更新所有折射滤镜。 */
export function applyGlassTheme(theme: GlassTheme): void {
  currentTheme = theme;
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  Object.entries(glassThemeCssVars(theme)).forEach(([k, v]) => root.style.setProperty(k, v));
  root.dataset.glass = theme;
  surfaces.forEach(applyScales);
}
