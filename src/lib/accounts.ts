import type { DesktopPlaylistSummary } from './playlist/ipcClient';

/** 全局多平台账号状态（可多平台同时登录）。 */
export interface AccountState {
  platform: string;
  loggedIn: boolean;
  nickname?: string;
  avatarUrl?: string;
  isVip?: boolean;
  isSvip?: boolean;
  /**
   * 登录失效（#157）：本地还留着这个平台的登录，但平台确认它已过期（expired）或票据缺失（missing）。
   * 此时 loggedIn 为 false；账号区、歌单面板、播放条据此提示「登录已过期」，而不是装作从没登录过。
   */
  auth?: 'expired' | 'missing';
  playlists: DesktopPlaylistSummary[];
  loading: boolean;
}

export function emptyAccount(platform: string): AccountState {
  return { platform, loggedIn: false, playlists: [], loading: false };
}
