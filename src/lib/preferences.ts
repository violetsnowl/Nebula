/** 读取用户上次选择的音质档位（localStorage）。 */
export function preferredQuality(): string {
  try {
    return localStorage.getItem('music-nebula.quality') ?? '';
  } catch {
    return '';
  }
}

const SOURCE_OVERRIDE_KEY = 'music-nebula.source-overrides';
const MAX_SOURCE_OVERRIDES = 500;

function readSourceOverrides(): Record<string, string> {
  try {
    const raw = localStorage.getItem(SOURCE_OVERRIDE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
}

/** 读取用户为某首歌手动指定的播放平台（`${source}:${sourceId}` → platform）。 */
export function getPreferredSource(trackKey: string): string {
  if (!trackKey) return '';
  const v = readSourceOverrides()[trackKey];
  return typeof v === 'string' ? v : '';
}

/** 保存或清除某首歌的手动播放平台选择（切回原平台时传 null 清除）。 */
export function setPreferredSource(trackKey: string, platform: string | null): void {
  if (!trackKey) return;
  try {
    const map = readSourceOverrides();
    if (!platform) {
      delete map[trackKey];
    } else {
      delete map[trackKey];
      map[trackKey] = platform;
      const keys = Object.keys(map);
      if (keys.length > MAX_SOURCE_OVERRIDES) {
        for (const k of keys.slice(0, keys.length - MAX_SOURCE_OVERRIDES)) delete map[k];
      }
    }
    localStorage.setItem(SOURCE_OVERRIDE_KEY, JSON.stringify(map));
  } catch {
    /* 私密模式 */
  }
}
