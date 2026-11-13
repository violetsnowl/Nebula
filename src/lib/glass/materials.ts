/**
 * 光学材质参数（docs/design/NEBULA_UI_SYSTEM.md §3）。
 * 磨砂 / 液态是同一个光学模型的两组参数；组件只引用档位变量（--g1-* / --g2-* / --g3-*），不写材质数值。
 */

export type GlassTheme = 'liquid' | 'frost';
/** G1 主玻璃（播放条 / Dock 窗口 / 搜索）· G2 透镜球（≤48px 圆形按钮）· G3 浓玻璃（弹层 / 菜单 / 弹窗，不折射）。 */
export type GlassTier = 'g1' | 'g2' | 'g3';

export interface TierParams {
  /** 边缘折射位移（px）；SVG 位移贴图 scale = 2 × refraction。 */
  refraction: number;
  /** RGB 色散比例：三通道 scale 依次 × (1, 1 − d, 1 − 2d)。 */
  dispersion: number;
  /** 散射（backdrop blur，px）。 */
  blur: number;
  /** 内侧亮边强度。 */
  rim: number;
  /** 中性压暗（只用黑）。 */
  tint: number;
  /** 透射增饱和。 */
  sat: number;
}

const LIQUID_G1: TierParams = { refraction: 26, dispersion: 0.05, blur: 2.25, rim: 0.52, tint: 0.1, sat: 1.65 };
const FROST_G1: TierParams = { refraction: 6, dispersion: 0, blur: 16, rim: 0.4, tint: 0.08, sat: 1.4 };
const DENSE_G3: TierParams = { refraction: 0, dispersion: 0, blur: 18, rim: 0.4, tint: 0.28, sat: 1.4 };

export const GLASS_THEMES: Record<GlassTheme, Record<GlassTier, TierParams>> = {
  liquid: {
    g1: LIQUID_G1,
    g2: { ...LIQUID_G1, refraction: LIQUID_G1.refraction * 0.6, dispersion: LIQUID_G1.dispersion * 0.6, blur: 1 },
    g3: DENSE_G3,
  },
  frost: {
    g1: FROST_G1,
    g2: FROST_G1,
    g3: DENSE_G3,
  },
};

const STORAGE_KEY = 'music-nebula.glass-theme';

/** 默认液态（用户 2026-11 确认）；存储不可用时也回落到液态。 */
export function loadGlassTheme(): GlassTheme {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'frost' ? 'frost' : 'liquid';
  } catch {
    return 'liquid';
  }
}

export function saveGlassTheme(theme: GlassTheme): void {
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    /* ignore */
  }
}

/**
 * 性能降级档位（NEBULA_UI_SYSTEM §3.7），依次叠加：
 * 0 = 完整；1 = 关色散；2 = 再关 G2 折射；3 = 再关 G1 折射，G1 / G2 退回磨砂参数；4 = 再停环境光漂移（由 CSS 处理）。
 */
export type PerfLevel = 0 | 1 | 2 | 3 | 4;

/** 某个主题、某个档位在当前降级档位下实际使用的参数。 */
export function effectiveTierParams(theme: GlassTheme, tier: GlassTier, level: PerfLevel = 0): TierParams {
  let p = GLASS_THEMES[theme][tier];
  if (level >= 3 && tier !== 'g3') p = { ...FROST_G1, refraction: 0 };
  if (level >= 2 && tier === 'g2') p = { ...p, refraction: 0 };
  if (level >= 1) p = { ...p, dispersion: 0 };
  return p;
}

/** 主题参数 → 根节点 CSS 变量（--g1-blur / --g1-tint / --g1-rim / --g1-sat …）。 */
export function glassThemeCssVars(theme: GlassTheme, level: PerfLevel = 0): Record<string, string> {
  const out: Record<string, string> = {};
  (Object.keys(GLASS_THEMES[theme]) as GlassTier[]).forEach((tier) => {
    const p = effectiveTierParams(theme, tier, level);
    out[`--${tier}-blur`] = `${p.blur}px`;
    out[`--${tier}-tint`] = String(p.tint);
    out[`--${tier}-rim`] = String(p.rim);
    out[`--${tier}-sat`] = String(p.sat);
  });
  return out;
}
