import type { AccountInfo, PlaylistSummary } from '../types';
import type { QishuiLogin } from './qishuiLogin';

export interface LoginAdapter {
  platform: string;
  name: string;
  kind: 'qr' | 'oauth' | 'window' | 'device' | 'unavailable';
  /** device（设备码）类登录另带 userCode / verificationUrl / expiresIn / interval，设备码本身不下发。 */
  createQr?: () => Promise<{ unikey: string; payload: string; imageDataUrl?: string; userCode?: string; verificationUrl?: string; expiresIn?: number; interval?: number }>;
  pollLogin?: (unikey: string) => Promise<{ ok: boolean; message: string; final?: boolean }>;
  getAccount?: () => Promise<AccountInfo | null>;
  getMyPlaylists?: () => Promise<PlaylistSummary[]>;
  unavailableReason?: string;
}

export { NeteaseLogin } from './neteaseLogin';
export { KugouLogin } from './kugouLogin';
export { QishuiLogin } from './qishuiLogin';
export { QqLogin, hash33 } from './qqLogin';
export { KuwoLogin, kuwoAvatarUrl } from './kuwoLogin';
export { BodianLogin, bodianSelfFromPlaylists } from './bodianLogin';
export { YtmusicLogin, revokeYtmusicToken } from './ytmusicLogin';
export { AppleMusicLogin } from './applemusicLogin';

export function createKugouLoginAdapter(kugouLogin: {
  getAccount: () => Promise<AccountInfo | null>;
  getMyPlaylists?: () => Promise<PlaylistSummary[]>;
}): LoginAdapter {
  return {
    platform: 'kugou',
    name: '酷狗音乐',
    kind: 'window',
    getAccount: () => kugouLogin.getAccount(),
    getMyPlaylists: kugouLogin.getMyPlaylists,
    unavailableReason: undefined,
  };
}

export function createKuwoLoginAdapter(kuwoLogin: {
  getAccount: () => Promise<AccountInfo | null>;
  getMyPlaylists?: () => Promise<PlaylistSummary[]>;
}): LoginAdapter {
  return {
    platform: 'kuwo',
    name: '酷我音乐',
    kind: 'window',
    getAccount: () => kuwoLogin.getAccount(),
    getMyPlaylists: kuwoLogin.getMyPlaylists,
    unavailableReason: undefined,
  };
}

/** Apple Music：官方页面登录（页面引擎在内嵌弹窗里显示 music.apple.com），登录态在页面分区里。 */
export function createAppleMusicLoginAdapter(appleLogin: {
  getAccount: () => Promise<AccountInfo | null>;
  getMyPlaylists?: () => Promise<PlaylistSummary[]>;
}): LoginAdapter {
  return {
    platform: 'applemusic',
    name: 'Apple Music',
    kind: 'window',
    getAccount: () => appleLogin.getAccount(),
    getMyPlaylists: appleLogin.getMyPlaylists,
    unavailableReason: undefined,
  };
}

/**
 * 汽水音乐：扫码登录（二维码由签名引擎生成，显示在账号面板里，和酷狗 / 波点同一套）。
 * 二次验证（2046）的验证页由 QishuiLogin 经内嵌弹窗显示；checkQrConnect 同一时间只有一次在跑，
 * 渲染进程每 2 秒轮询一次也不会重复触发验证。
 */
export function createQishuiLoginAdapter(
  qishuiLogin: Pick<QishuiLogin, 'getQrCode' | 'checkQrConnect' | 'getAccount'>,
  extra: { getMyPlaylists?: () => Promise<PlaylistSummary[]> } = {},
): LoginAdapter {
  return {
    platform: 'qishui',
    name: '汽水音乐',
    kind: 'qr',
    createQr: async () => {
      const { token, scanUrl } = await qishuiLogin.getQrCode();
      return { unikey: token, payload: scanUrl };
    },
    pollLogin: async (token) => {
      try {
        const data = await qishuiLogin.checkQrConnect(token);
        // 成功判定以 qishuiLogin 内部单一真源为准（含凭证校验 + cookie 持久化）
        if (data._loginOk === true) return { ok: true, message: '汽水音乐登录成功' };
        if (data.status === 'scanned') return { ok: false, message: '已扫码，请在手机上确认' };
        return { ok: false, message: '用汽水音乐 App 扫码登录' };
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        return { ok: false, message: `验证异常：${reason}（持续重试中…）` };
      }
    },
    getAccount: () => qishuiLogin.getAccount(),
    getMyPlaylists: extra.getMyPlaylists,
  };
}
