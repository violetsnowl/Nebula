import fs from 'node:fs';
import path from 'node:path';

/** 用户手动换歌词的选择：pick = 指定的歌词来源（缺省 = 自动合并）；offsetMs = 整份歌词的时间微调（正数 = 推后）。 */
export interface LyricOverride {
  pick?: { platform: string; sourceId: string };
  offsetMs?: number;
}
type OverrideEntry = LyricOverride & { at: number };

/** 微调范围与档位：±5 秒、0.1 秒一档。 */
export const LYRIC_OFFSET_MAX_MS = 5000;
export const LYRIC_OFFSET_STEP_MS = 100;
const MAX_ENTRIES = 2000;

/** 夹到 ±5 秒并取整到 0.1 秒；不是有限数字当 0。 */
export function clampLyricOffset(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(-LYRIC_OFFSET_MAX_MS, Math.min(LYRIC_OFFSET_MAX_MS, Math.round(n / LYRIC_OFFSET_STEP_MS) * LYRIC_OFFSET_STEP_MS)) || 0;
}
const validPick = (p: unknown): p is { platform: string; sourceId: string } =>
  !!p && typeof p === 'object' && typeof (p as any).platform === 'string' && !!(p as any).platform && (p as any).platform.length <= 40 &&
  typeof (p as any).sourceId === 'string' && !!(p as any).sourceId && (p as any).sourceId.length <= 200;
const validEntry = (v: unknown): v is OverrideEntry => {
  if (!v || typeof v !== 'object') return false;
  const e = v as OverrideEntry;
  if (!Number.isFinite(e.at)) return false;
  if (e.pick !== undefined && !validPick(e.pick)) return false;
  if (e.offsetMs !== undefined && !Number.isFinite(e.offsetMs)) return false;
  return true;
};

/**
 * 手动换歌词的选择，存 userData/lyric-overrides.json（schema 1）。key = 实际供流那首的 `platform:sourceId`。
 * 写法学 LyricCache：原子写、加载失败当空、最多 2000 条按时间淘汰。
 */
export class LyricOverrides {
  private data: Record<string, OverrideEntry> = Object.create(null);
  private file: string;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private saving: Promise<void> = Promise.resolve();
  constructor(dir: string) {
    this.file = path.join(dir, 'lyric-overrides.json');
    this.load();
  }

  get(key: string): LyricOverride | null {
    const e = this.data[key];
    if (!e) return null;
    return { ...(e.pick ? { pick: { ...e.pick } } : {}), ...(e.offsetMs ? { offsetMs: e.offsetMs } : {}) };
  }

  /** null、或 pick 为空且 offset 为 0：删掉这一条。 */
  set(key: string, value: LyricOverride | null): void {
    const pick = value?.pick && validPick(value.pick) ? { platform: value.pick.platform, sourceId: value.pick.sourceId } : undefined;
    const offsetMs = clampLyricOffset(value?.offsetMs);
    if (!pick && !offsetMs) {
      if (key in this.data) { delete this.data[key]; this.schedule(); }
      return;
    }
    this.data[key] = { ...(pick ? { pick } : {}), ...(offsetMs ? { offsetMs } : {}), at: Date.now() };
    const keys = Object.keys(this.data).sort((a, b) => this.data[a]!.at - this.data[b]!.at);
    keys.slice(0, Math.max(0, keys.length - MAX_ENTRIES)).forEach((k) => delete this.data[k]);
    this.schedule();
  }

  private load(): void {
    try {
      if (fs.statSync(this.file).size > 8 * 1024 * 1024) return;
      const value = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (value?.schema !== 1 || !value.entries || typeof value.entries !== 'object') return;
      const rows = Object.entries(value.entries).filter(([, v]) => validEntry(v)) as Array<[string, OverrideEntry]>;
      rows.sort((a, b) => a[1].at - b[1].at).slice(-MAX_ENTRIES).forEach(([k, v]) => { this.data[k] = v; });
    } catch { /* 缺失 / 损坏当空 */ }
  }
  private schedule(): void {
    if (this.timer) return;
    this.timer = setTimeout(() => { this.timer = null; void this.flush(); }, 400);
    this.timer.unref?.();
  }
  async flush(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const snapshot = JSON.stringify({ schema: 1, entries: this.data });
    this.saving = this.saving.catch(() => {}).then(async () => {
      try {
        await fs.promises.mkdir(path.dirname(this.file), { recursive: true });
        const tmp = `${this.file}.${process.pid}.tmp`;
        await fs.promises.writeFile(tmp, snapshot, 'utf8');
        await fs.promises.rename(tmp, this.file);
      } catch { console.warn('[LyricOverrides] 保存失败'); }
    });
    await this.saving;
  }
}
