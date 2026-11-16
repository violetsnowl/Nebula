/**
 * 没有封面图时的占位底色（#129，用户反馈：糖果色占位在星云里太跳）。
 * 原来是 70% 饱和的双色渐变；改成低饱和的深色渐变，只留一点色相差别，几首没封面的歌放在一起不会一模一样。
 * 卡片、卡片发光、播放条缩略图、听音空间大封面、搜索缩略图共用这一处。
 */
export function placeholderBg(hue1 = 220, hue2 = 280): string {
  return `linear-gradient(135deg, hsl(${hue1} 16% 32%), hsl(${hue2} 13% 15%))`;
}

/** 小缩略图（搜索结果）用的纯色版本，和上面渐变的中段同一档。 */
export function placeholderFill(hue = 220): string {
  return `hsl(${hue} 14% 24%)`;
}
