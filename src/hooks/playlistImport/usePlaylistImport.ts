import { useCallback, useEffect, useRef, useState } from 'react';
import type { Track } from '../../lib/catalog';
import { hasDesktopAPI, toFrontendTrack } from '../../lib/playlist/ipcClient';
import { resolvePlaylist } from '../../lib/playlist/adapters';
import type { ImportStatus, PlaylistMeta } from '../../lib/playlistTypes';

export interface ImportCommit {
  adapterName: string;
  tracks: Track[];
  simulated: boolean;
  note?: string;
  /** null 表示这批歌不属于任何平台歌单（本地音乐）：清掉当前歌单身份。 */
  meta: PlaylistMeta | null;
}

interface UsePlaylistImportOptions {
  /** 导入会话开始（清空旧视图/播放器状态），由 App 组合层提供。 */
  onSessionStart: () => void;
  /** 导入成功提交，由 App 组合层接线到 曲库 + 歌单身份 + 渐进揭示。 */
  onImported: (commit: ImportCommit) => void;
}

/** 本地文件夹提示的停留时间。 */
const WARN_MS = 5000;

/**
 * 导入流程领域（docs/project/ARCHITECTURE.md §2）：
 * 手动链接 / 平台歌单 / 本地目录 三入口，只负责解析与状态，不拥有曲库。
 */
export function usePlaylistImport({ onSessionStart, onImported }: UsePlaylistImportOptions) {
  const [importStatus, setImportStatus] = useState<ImportStatus>('idle');
  const [importMessage, setImportMessage] = useState('');
  const [localBusy, setLocalBusy] = useState(false);

  // 本地文件夹的提示（取消 / 空文件夹）只是一句短提示：几秒后自动消失，下一次导入开始时也立刻清掉
  const warnTimerRef = useRef(0);
  const clearWarnTimer = useCallback(() => {
    if (warnTimerRef.current) {
      window.clearTimeout(warnTimerRef.current);
      warnTimerRef.current = 0;
    }
  }, []);
  useEffect(() => clearWarnTimer, [clearWarnTimer]);

  const flashWarn = useCallback(
    (message: string) => {
      clearWarnTimer();
      setImportStatus('warn');
      setImportMessage(message);
      warnTimerRef.current = window.setTimeout(() => {
        warnTimerRef.current = 0;
        // 只有状态还是这条提示时才复位，避免盖掉之后发生的导入状态
        setImportStatus((s) => (s === 'warn' ? 'idle' : s));
        setImportMessage((m) => (m === message ? '' : m));
      }, WARN_MS);
    },
    [clearWarnTimer],
  );

  const importUrl = useCallback(
    async (url: string) => {
      clearWarnTimer();
      setImportStatus('parsing');
      setImportMessage('');
      onSessionStart();
      try {
        const { adapterName, songs, simulated, note } = await resolvePlaylist(url);
        onImported({
          adapterName,
          tracks: songs,
          simulated,
          note,
          meta: { platform: adapterName, id: 'manual', name: '手动链接导入', cover: '' },
        });
      } catch (err) {
        setImportStatus('error');
        setImportMessage(`歌单解析失败：${err instanceof Error ? err.message : String(err)}`);
      }
    },
    [onSessionStart, onImported, clearWarnTimer],
  );

  const importPlaylistId = useCallback(
    async (platform: string, id: string) => {
      if (!hasDesktopAPI()) return;
      clearWarnTimer();
      setImportStatus('parsing');
      setImportMessage('');
      onSessionStart();
      try {
        const res = await window.nebulaAPI!.importPlaylistId(platform, id);
        if (!res.ok) throw new Error(res.error);
        onImported({
          adapterName: res.data.platformName,
          tracks: res.data.tracks.map((t, i) => toFrontendTrack(t, i)),
          simulated: false,
          meta: { platform: res.data.platformName, id, name: res.data.name, cover: res.data.cover },
        });
      } catch (err) {
        setImportStatus('error');
        setImportMessage(`歌单导入失败：${err instanceof Error ? err.message : String(err)}`);
      }
    },
    [onSessionStart, onImported, clearWarnTimer],
  );

  const openLocal = useCallback(async () => {
    if (!hasDesktopAPI()) return;
    clearWarnTimer();
    setLocalBusy(true);
    try {
      const res = await window.nebulaAPI!.openLocalDirectory();
      if (res.ok && res.data?.tracks?.length) {
        setImportStatus('parsing');
        setImportMessage('');
        onSessionStart();
        onImported({
          adapterName: '本地音乐',
          tracks: res.data.tracks.map((t, i) => toFrontendTrack(t, i)),
          simulated: false,
          meta: null,
        });
      } else if (res.ok) {
        flashWarn('所选文件夹未发现可导入的音频文件');
      } else {
        flashWarn(res.error ?? '未选择文件夹');
      }
    } finally {
      setLocalBusy(false);
    }
  }, [onSessionStart, onImported, clearWarnTimer, flashWarn]);

  /** 渐进揭示完成后的收尾（由 App 的 beginImport onDone 调用）。 */
  const complete = useCallback((status: ImportStatus, message: string) => {
    setImportStatus(status);
    setImportMessage(message);
  }, []);

  return { importStatus, importMessage, localBusy, importUrl, importPlaylistId, openLocal, complete };
}
