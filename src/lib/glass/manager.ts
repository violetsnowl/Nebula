import { displacementTiles, type DisplacementTiles } from './displacement';
import { effectiveTierParams, glassThemeCssVars, tierBezel, type GlassTheme, type GlassTier, type PerfLevel } from './materials';

/**
 * GlassManager（docs/design/NEBULA_UI_SYSTEM.md §3.6）：
 * 为每个注册的玻璃面创建一个 SVG 滤镜（位移贴图 + RGB 三通道色散）：G1、G2，以及 G3 的两侧面板。
 * 位移贴图是九宫格（4 角 + 4 边 + 中性底，P4 修正）：尺寸变化时每一帧只移动这些块，不重画贴图，
 * 所以宽度动画（Dock 小球展开成胶囊、搜索胶囊展开）全程折射都和真实形状对齐，不会出现"拉出一个球头、最后猛地一变"。
 * 通过元素上的 `--glass-filter: url(#id)` 交给 CSS 的 backdrop-filter 使用（材质画在 ::before 上）。
 * G3 的小弹层（菜单、气泡、播放条弹层）不注册：太小，折射只会显脏；磨砂主题或降级后 G3 的折射为 0，滤镜自动摘掉。
 *
 * 主题切换：applyGlassTheme 写根节点档位变量 + 更新所有滤镜的折射 scale（只改 scale 不需要重建贴图）。
 */

const SVG_NS = 'http://www.w3.org/2000/svg';
const XLINK_NS = 'http://www.w3.org/1999/xlink';

type TileName = 'tl' | 'tr' | 'bl' | 'br' | 'top' | 'bottom' | 'left' | 'right';
const TILE_NAMES: TileName[] = ['tl', 'tr', 'bl', 'br', 'top', 'bottom', 'left', 'right'];

interface FilterNodes {
  filter: SVGFilterElement;
  tiles: Record<TileName, SVGFEImageElement>;
  r: SVGFEDisplacementMapElement;
  g: SVGFEDisplacementMapElement;
  b: SVGFEDisplacementMapElement;
}

interface Surface {
  el: HTMLElement;
  tier: GlassTier;
  nodes: FilterNodes;
  /** 当前使用的九宫格贴图（缓存对象变了才换图）。 */
  tileSet: DisplacementTiles | null;
  /** 角块边长。 */
  R: number;
  ready: boolean;
}

let defs: SVGDefsElement | null = null;
let seq = 0;
let currentTheme: GlassTheme = 'liquid';
/** 性能降级档位（§3.7）：由 setGlassPerfLevel 写入。 */
let perfLevel: PerfLevel = 0;
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
  // 九宫格位移贴图：中性底（128 = 不位移）+ 4 角 + 4 边，合成为 map
  filter.appendChild(svgEl('feFlood', { 'flood-color': 'rgb(128,128,128)', 'flood-opacity': '1', result: 'base' }));
  const tiles = {} as Record<TileName, SVGFEImageElement>;
  TILE_NAMES.forEach((name) => {
    const img = svgEl('feImage', { x: '0', y: '0', width: '0', height: '0', preserveAspectRatio: 'none', result: `t-${name}` });
    filter.appendChild(img);
    tiles[name] = img;
  });
  const merge = svgEl('feMerge', { result: 'map' });
  merge.appendChild(svgEl('feMergeNode', { in: 'base' }));
  TILE_NAMES.forEach((name) => merge.appendChild(svgEl('feMergeNode', { in: `t-${name}` })));
  filter.appendChild(merge);
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
  return { filter, tiles, r, g, b };
}

function applyScales(s: Surface): void {
  const p = effectiveTierParams(currentTheme, s.tier, perfLevel);
  // 折射被降级关掉时，backdrop-filter 里干脆不挂 SVG 滤镜（scale = 0 的滤镜仍要跑一遍）
  if (p.refraction <= 0) s.el.style.setProperty('--glass-filter', 'blur(0px)');
  else s.el.style.setProperty('--glass-filter', `url(#${s.nodes.filter.id})`);
  const scale = s.ready ? p.refraction * 2 : 0;
  s.nodes.r.setAttribute('scale', String(scale));
  s.nodes.g.setAttribute('scale', String(scale * (1 - p.dispersion)));
  s.nodes.b.setAttribute('scale', String(scale * (1 - 2 * p.dispersion)));
}

function setRect(img: SVGFEImageElement, x: number, y: number, w: number, h: number): void {
  img.setAttribute('x', String(x));
  img.setAttribute('y', String(y));
  img.setAttribute('width', String(Math.max(0, w)));
  img.setAttribute('height', String(Math.max(0, h)));
}

/** 按当前尺寸摆放九宫格（每次尺寸变化都调用，只改属性，很便宜）；高度或圆角变了才换贴图。 */
function rebuild(s: Surface): void {
  const w = Math.round(s.el.offsetWidth);
  const h = Math.round(s.el.offsetHeight);
  if (w < 8 || h < 8) return;
  const radius = Math.min(parseFloat(getComputedStyle(s.el).borderTopLeftRadius) || 0, w / 2, h / 2);
  const t = displacementTiles(h, radius, tierBezel(s.tier, h));
  if (!t) return;
  if (t !== s.tileSet) {
    s.tileSet = t;
    s.R = t.R;
    TILE_NAMES.forEach((name) => {
      s.nodes.tiles[name].setAttribute('href', t[name]);
      s.nodes.tiles[name].setAttributeNS(XLINK_NS, 'xlink:href', t[name]);
    });
  }
  const R = Math.min(s.R, Math.floor(w / 2), Math.floor(h / 2));
  const T = s.nodes.tiles;
  setRect(T.tl, 0, 0, R, R);
  setRect(T.tr, w - R, 0, R, R);
  setRect(T.bl, 0, h - R, R, R);
  setRect(T.br, w - R, h - R, R, R);
  setRect(T.top, R, 0, w - 2 * R, R);
  setRect(T.bottom, R, h - R, w - 2 * R, R);
  setRect(T.left, 0, R, R, h - 2 * R);
  setRect(T.right, w - R, R, R, h - 2 * R);
  if (!s.ready) {
    s.ready = true;
    applyScales(s);
  }
}

/**
 * 注册一个玻璃面；返回注销函数。
 * 贴图生成前折射 scale 保持 0，避免首帧用空贴图造成整体偏移。
 */
export function registerGlass(el: HTMLElement, tier: GlassTier): () => void {
  if (typeof document === 'undefined') return () => {};
  const id = `nebula-glass-${++seq}`;
  const nodes = createFilter(id);
  ensureDefs().appendChild(nodes.filter);
  const s: Surface = { el, tier, nodes, tileSet: null, R: 0, ready: false };
  surfaces.add(s);
  applyScales(s);
  rebuild(s);
  // 不防抖：每一帧尺寸变化都立即重新摆放九宫格（只改属性），宽度动画全程折射连续
  const ro = new ResizeObserver(() => rebuild(s));
  ro.observe(el);
  return () => {
    ro.disconnect();
    nodes.filter.remove();
    surfaces.delete(s);
    el.style.removeProperty('--glass-filter');
  };
}

/** 切换材质主题：写根节点档位变量 + data-glass 属性 + 更新所有折射滤镜。 */
export function applyGlassTheme(theme: GlassTheme): void {
  currentTheme = theme;
  applyAll();
}

/** 性能降级（§3.7）：按档位关色散 / G2 折射 / G1 折射并退回磨砂参数。 */
export function setGlassPerfLevel(level: PerfLevel): void {
  perfLevel = level;
  applyAll();
}

function applyAll(): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  Object.entries(glassThemeCssVars(currentTheme, perfLevel)).forEach(([k, v]) => root.style.setProperty(k, v));
  root.dataset.glass = currentTheme;
  surfaces.forEach(applyScales);
}
