/**
 * 音质档位的显示名（各平台标识 → 中文全称）与播放条代号（NEBULA_UI_SYSTEM §9.1）。
 * 名称跟各平台官方叫法：网易云 jymaster 超清母带、jyeffect 高清环绕声、sky 沉浸环绕声、dolby 杜比全景声。
 * 后两者和 jyeffect 是环绕声效果版，不是更高保真（见 src/main/quality.ts）。
 */
const LABEL: Record<string, string> = {
  standard: '标准',
  higher: '较高',
  exhigh: '极高',
  lossless: '无损',
  hires: 'Hi-Res',
  jymaster: '超清母带',
  jyeffect: '高清环绕声',
  sky: '沉浸环绕声',
  dolby: '杜比全景声',
  '128k': '标准',
  '320k': '极高',
  flac: '无损',
  '128': '标准',
  '320': '极高',
  sq: '标准',
  hq: '极高',
};

/** 档位标识的中文全称；认不出返回空串（调用方自己决定兜底，绝不把原始英文标识露给用户）。 */
export function qualityName(level: string | undefined): string {
  return level ? (LABEL[level] ?? '') : '';
}

/** 播放条上的代号：无损 = SQ、极高 = HQ；其余保留名称。标签可能带格式后缀（「无损 FLAC」），只看第一段。 */
export function qualityCode(label: string): string {
  const head = label.trim().split(/\s+/)[0] ?? label;
  if (head === '无损') return 'SQ';
  if (head === '极高' || head === 'HQ' || head === '高品') return 'HQ';
  return head;
}

const PLATFORM_NAME: Record<string, string> = {
  netease: '网易云音乐',
  qq: 'QQ 音乐',
  kugou: '酷狗音乐',
  qishui: '汽水音乐',
  kuwo: '酷我音乐',
  bodian: '波点音乐',
  spotify: 'Spotify',
  ytmusic: 'YouTube Music',
  applemusic: 'Apple Music',
};

export function platformName(platform: string | undefined): string {
  return platform ? (PLATFORM_NAME[platform] ?? platform) : '';
}
