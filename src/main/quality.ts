/**
 * 跨平台音质阶梯。各平台的档位标识互不相同（网易云 lossless、QQ flac、酷狗 320 …），
 * 用户的偏好只存一个标识，兜底到别的平台取链时要换成那个平台的同级档位，否则偏好会被静默忽略。
 *
 * 阶梯只收「保真度」档位；环绕声效果版（网易云 jyeffect 高清环绕声 / sky 沉浸环绕声 / dolby 杜比全景声）
 * 是另一种混音，不在阶梯上：只有用户明确选了它才播，不能当作「更高音质」自动落上去。
 */

const RANK: Record<string, number> = {
  standard: 1,
  higher: 1,
  '128k': 1,
  '128': 1,
  sq: 1, // 酷狗按码率回报：< 320k
  exhigh: 2,
  '320k': 2,
  '320': 2,
  hq: 2,
  lossless: 3,
  flac: 3,
  hires: 4,
  jymaster: 5,
};

/** 环绕声效果版（不是保真度档位）。 */
export const EFFECT_LEVELS = new Set(['jyeffect', 'sky', 'dolby']);

export function qualityRank(level: string | undefined): number {
  return level ? (RANK[level] ?? 0) : 0;
}

/**
 * 把一个档位标识换成目标平台列表里的同级档位：同级优先，没有就取比它低的最高一档，再没有取最低档。
 * 认不出的标识或效果版原样返回（由各平台自己处理）。
 */
export function mapQualityTo(levels: string[], level: string | undefined): string | undefined {
  if (!level || levels.includes(level)) return level;
  const want = qualityRank(level);
  if (!want) return level;
  const ranked = levels.filter((l) => qualityRank(l) > 0).sort((a, b) => qualityRank(b) - qualityRank(a));
  return ranked.find((l) => qualityRank(l) <= want) ?? ranked[ranked.length - 1] ?? level;
}
