import fs from 'node:fs';
import path from 'node:path';
import type { MergedPlaylistRecord, MergedPlaylistSummary } from '../types';

interface StoreSchema {
  version: 1;
  items: MergedPlaylistRecord[];
}

function toSummary(record: MergedPlaylistRecord): MergedPlaylistSummary {
  const { tracks: _tracks, ...summary } = record;
  return summary;
}

/**
 * 整合歌单本机持久化仓库（userData/merged-playlists.json）。
 * 列表接口剥离 `tracks` 控制传递体积；写入采用临时文件原子替换避免断电损坏。
 */
export class MergedPlaylistStore {
  private filePath: string;
  private items: MergedPlaylistRecord[] = [];
  private loaded = false;

  constructor(dirPath: string, fileName = 'merged-playlists.json') {
    this.filePath = path.join(dirPath, fileName);
  }

  private ensureLoaded(): void {
    if (this.loaded) return;
    this.loaded = true;
    try {
      if (!fs.existsSync(this.filePath)) return;
      const raw = fs.readFileSync(this.filePath, 'utf8');
      const parsed = JSON.parse(raw) as Partial<StoreSchema>;
      if (Array.isArray(parsed?.items)) {
        this.items = parsed.items.filter(
          (item): item is MergedPlaylistRecord =>
            !!item &&
            typeof item.id === 'string' &&
            typeof item.name === 'string' &&
            Array.isArray(item.sources) &&
            Array.isArray(item.tracks),
        );
      }
    } catch {
      this.items = [];
    }
  }

  private flush(): void {
    const dir = path.dirname(this.filePath);
    fs.mkdirSync(dir, { recursive: true });
    const tmp = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    const payload: StoreSchema = { version: 1, items: this.items };
    fs.writeFileSync(tmp, JSON.stringify(payload), 'utf8');
    try {
      fs.renameSync(tmp, this.filePath);
    } catch {
      // Windows 上极少场景 rename 被占时退回复制并删临时文件，确保不丢失写入。
      fs.copyFileSync(tmp, this.filePath);
      fs.rmSync(tmp, { force: true });
    }
  }

  list(): MergedPlaylistSummary[] {
    this.ensureLoaded();
    return [...this.items]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map(toSummary);
  }

  get(id: string): MergedPlaylistRecord | null {
    this.ensureLoaded();
    return this.items.find((item) => item.id === id) ?? null;
  }

  save(record: MergedPlaylistRecord): MergedPlaylistSummary {
    this.ensureLoaded();
    const idx = this.items.findIndex((item) => item.id === record.id);
    if (idx >= 0) this.items[idx] = record;
    else this.items.unshift(record);
    this.flush();
    return toSummary(record);
  }

  rename(id: string, name: string): MergedPlaylistSummary | null {
    this.ensureLoaded();
    const trimmed = String(name || '').trim();
    if (!trimmed) throw new Error('歌单名称不能为空');
    const target = this.items.find((item) => item.id === id);
    if (!target) return null;
    target.name = trimmed;
    target.updatedAt = Date.now();
    this.flush();
    return toSummary(target);
  }

  remove(id: string): boolean {
    this.ensureLoaded();
    const before = this.items.length;
    this.items = this.items.filter((item) => item.id !== id);
    if (this.items.length === before) return false;
    this.flush();
    return true;
  }
}
