import { useCallback, useEffect, useState } from 'react';
import type { AccountState } from '../../lib/accounts';
import {
  hasDesktopAPI,
  type DesktopMergedPlaylistResponse,
} from '../../lib/playlist/ipcClient';
import type { MergeSourceRef, MergedPlaylistSummary } from '../../lib/playlistTypes';

function toRightsSnapshot(
  accounts: Record<string, AccountState>,
): Record<string, { loggedIn?: boolean; isVip?: boolean; isSvip?: boolean }> {
  const out: Record<string, { loggedIn?: boolean; isVip?: boolean; isSvip?: boolean }> = {};
  for (const [platform, state] of Object.entries(accounts)) {
    out[platform] = {
      loggedIn: state.loggedIn,
      isVip: state.isVip,
      isSvip: state.isSvip,
    };
  }
  return out;
}

function formatMergeNotice(res: DesktopMergedPlaylistResponse, verb: string): string {
  const overlap = res.stats?.overlapPairSummary;
  if (overlap) return `${verb}（共 ${res.record.trackCount} 首，${overlap}）`;
  if (res.record.dedupCount > 0) {
    return `${verb}（共 ${res.record.trackCount} 首，自动去重 ${res.record.dedupCount} 首）`;
  }
  return `${verb}（共 ${res.record.trackCount} 首）`;
}

export interface MergeActionResult {
  ok: boolean;
  response?: DesktopMergedPlaylistResponse;
  notice?: string;
  error?: string;
}

/**
 * 整合歌单领域状态（属于 `playlistImport` 域，遵守 check-arch 域隔离）：
 * 管理本机持久化整合歌单列表，封装生成 / 刷新快照 / 重命名 / 删除 IPC 调用。
 */
export function useMergedPlaylists() {
  const [mergedPlaylists, setMergedPlaylists] = useState<MergedPlaylistSummary[]>([]);
  const [mergeBusy, setMergeBusy] = useState(false);
  const [mergeError, setMergeError] = useState('');
  const [mergeNotice, setMergeNotice] = useState('');

  const reloadMerged = useCallback(async () => {
    if (!hasDesktopAPI() || !window.nebulaAPI?.mergedList) return;
    try {
      const res = await window.nebulaAPI.mergedList();
      if (res.ok && Array.isArray(res.data)) setMergedPlaylists(res.data);
    } catch {
      /* 启动读取失败不影响主舞台使用 */
    }
  }, []);

  useEffect(() => {
    void reloadMerged();
  }, [reloadMerged]);

  const clearMergeFeedback = useCallback(() => {
    setMergeError('');
    setMergeNotice('');
  }, []);

  const createMerged = useCallback(
    async (
      sources: MergeSourceRef[],
      name: string,
      accounts: Record<string, AccountState>,
    ): Promise<MergeActionResult> => {
      if (!hasDesktopAPI() || !window.nebulaAPI?.mergedCreate) {
        return { ok: false, error: '当前环境不支持整合歌单' };
      }
      setMergeBusy(true);
      setMergeError('');
      setMergeNotice('');
      try {
        const res = await window.nebulaAPI.mergedCreate({
          name: name.trim() || undefined,
          sources,
          accounts: toRightsSnapshot(accounts),
        });
        if (!res.ok) {
          const msg = res.error || '整合歌单生成失败';
          setMergeError(msg);
          return { ok: false, error: msg };
        }
        const created = res.data.record;
        setMergedPlaylists((prev) => [created, ...prev.filter((item) => item.id !== created.id)]);
        const notice = formatMergeNotice(res.data, '整合成功');
        setMergeNotice(notice);
        return { ok: true, response: res.data, notice };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setMergeError(msg);
        return { ok: false, error: msg };
      } finally {
        setMergeBusy(false);
      }
    },
    [],
  );

  const refreshMerged = useCallback(
    async (id: string, accounts: Record<string, AccountState>): Promise<MergeActionResult> => {
      if (!hasDesktopAPI() || !window.nebulaAPI?.mergedRefresh) {
        return { ok: false, error: '当前环境不支持刷新整合歌单' };
      }
      setMergeBusy(true);
      setMergeError('');
      setMergeNotice('');
      try {
        const res = await window.nebulaAPI.mergedRefresh(id, toRightsSnapshot(accounts));
        if (!res.ok) {
          const msg = res.error || '刷新整合快照失败，已保留原歌单';
          setMergeError(msg);
          return { ok: false, error: msg };
        }
        const updated = res.data.record;
        setMergedPlaylists((prev) => [updated, ...prev.filter((item) => item.id !== updated.id)]);
        const notice = formatMergeNotice(res.data, '已更新快照');
        setMergeNotice(notice);
        return { ok: true, response: res.data, notice };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setMergeError(msg);
        return { ok: false, error: msg };
      } finally {
        setMergeBusy(false);
      }
    },
    [],
  );

  const renameMerged = useCallback(async (id: string, name: string): Promise<boolean> => {
    if (!hasDesktopAPI() || !window.nebulaAPI?.mergedRename) return false;
    setMergeError('');
    const res = await window.nebulaAPI.mergedRename(id, name);
    if (!res.ok) {
      setMergeError(res.error || '重命名失败');
      return false;
    }
    const updated = res.data;
    setMergedPlaylists((prev) => prev.map((item) => (item.id === id ? updated : item)));
    return true;
  }, []);

  const deleteMerged = useCallback(async (id: string): Promise<boolean> => {
    if (!hasDesktopAPI() || !window.nebulaAPI?.mergedDelete) return false;
    setMergeError('');
    const res = await window.nebulaAPI.mergedDelete(id);
    if (!res.ok || !res.data) {
      setMergeError(res.ok ? '删除失败' : res.error || '删除失败');
      return false;
    }
    setMergedPlaylists((prev) => prev.filter((item) => item.id !== id));
    setMergeNotice('');
    return true;
  }, []);

  return {
    mergedPlaylists,
    mergeBusy,
    mergeError,
    mergeNotice,
    reloadMerged,
    clearMergeFeedback,
    createMerged,
    refreshMerged,
    renameMerged,
    deleteMerged,
  };
}
