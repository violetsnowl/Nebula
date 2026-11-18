import { createRequire } from 'node:module';
import type { CookieStore } from '../cookieStore';
import type { AccountInfo } from '../types';
import {
  BODIAN_AUTH_REJECT_CODES,
  BodianApi,
  bodianDevId,
  parseBodianSession,
  type BodianTransport,
} from '../adapters/bodianAdapter';

const require_ = createRequire(__filename);

export const BODIAN_AUTH_EXPIRED = '波点登录已过期，请重新登录';

/** 二维码里写入的落地页（与官方 PC 客户端一致，手机端扫码后打开 App 确认）。 */
const QR_LANDING = 'https://bodian-oia.kuwo.cn/bodian/download.html?pageName=login_pc&pt=3&id=';
/** qrCodeStatus 的 status：1 等待扫码 / 确认，3 已确认，2 实测是不存在 / 已过期的二维码。 */
const QR_WAITING = 1;
const QR_CONFIRMED = 3;
const QR_EXPIRED = 2;

/**
 * playlist/userCreate 的每个歌单都带作者：author { id, name, icon, isVip }，以及平铺的 creatorId / creatorName / creatorIcon。
 * 取第一个作者是本人的歌单；头像多为 QQ / 微信第三方头像，统一升 https。
 */
export function bodianSelfFromPlaylists(data: unknown, uid: string): { nickname: string; avatarUrl: string; isVip: boolean } | null {
  const lists = (data as { playLists?: unknown })?.playLists;
  if (!Array.isArray(lists)) return null;
  for (const p of lists as Array<Record<string, any>>) {
    const author = p?.author ?? {};
    if (pick(author.id, p?.creatorId) !== String(uid)) continue;
    const icon = pick(author.icon, p?.creatorIcon);
    return {
      nickname: pick(author.name, p?.creatorName),
      avatarUrl: /^https?:\/\//i.test(icon) ? icon.replace(/^http:\/\//i, 'https://') : '',
      isVip: Number(author.isVip) === 1,
    };
  }
  return null;
}

function pick(...values: unknown[]): string {
  for (const v of values) {
    const s = String(v ?? '').trim();
    if (s) return s;
  }
  return '';
}

/**
 * 波点登录：手机端扫码。
 * - createQr：login/qrCode 取二维码 ID，本地生成二维码图片；
 * - pollLogin：轮询 login/qrCodeStatus，确认后（状态里没有凭证时）用 users/login（authType 10）换取 uid + token，连同设备 ID 存入 CookieStore；
 * - getAccount：用 playlist/userCreate 真实核验票据（-101 判过期，网络异常不判登出），再尽力读 users/login 取昵称 / 头像 / 会员。
 */
export class BodianLogin {
  private api: BodianApi;
  constructor(private cookies: CookieStore, transport?: BodianTransport) {
    this.api = new BodianApi(cookies, transport);
  }

  async createQr(): Promise<{ unikey: string; payload: string; imageDataUrl?: string }> {
    const res = await this.api.call('/api/ucenter/login/qrCode', { session: null, signed: true });
    const code = pick(res.data?.qrCode);
    if (res.code !== 200 || !code) throw new Error(`获取波点二维码失败 (错误码 ${res.code || 'unknown'})`);
    const payload = `${QR_LANDING}${encodeURIComponent(code)}`;
    let imageDataUrl: string | undefined;
    try {
      const QRCode = require_('qrcode') as { toDataURL: (t: string, o?: object) => Promise<string> };
      imageDataUrl = await QRCode.toDataURL(payload, { margin: 1 });
    } catch {
      /* 前端会回退用 payload 本地渲染二维码 */
    }
    return { unikey: code, payload, imageDataUrl };
  }

  async pollLogin(unikey: string): Promise<{ ok: boolean; message: string; nickname?: string }> {
    let status: Awaited<ReturnType<BodianApi['call']>>;
    try {
      status = await this.api.call('/api/ucenter/login/qrCodeStatus', { session: null, signed: true, params: { qrCode: unikey } });
    } catch (err) {
      return { ok: false, message: `网络波动（${err instanceof Error ? err.message : String(err)}），正在重试…` };
    }
    if (status.code !== 200) return { ok: false, message: `二维码状态异常（错误码 ${status.code}），请刷新二维码` };
    const state = Number(status.data?.status);
    if (state === QR_EXPIRED) {
      return { ok: false, message: '二维码已过期，请刷新' };
    }
    if (state === QR_WAITING) return { ok: false, message: '等待扫码…' };
    if (state !== QR_CONFIRMED) return { ok: false, message: '已扫码，请在手机上确认' };

    // 已确认：状态里直接带凭证就用，否则用二维码换取。
    let login: Record<string, any>;
    const direct = status.data ?? {};
    if (pick(direct.uid, direct.userId, direct.id) && pick(direct.token, direct.userToken)) {
      login = direct;
    } else {
      try {
        const res = await this.api.call('/api/ucenter/users/login', {
          session: null, signed: true, method: 'POST',
          body: { authType: 10, qrCode: unikey },
        });
        if (res.code === 200 && res.data) login = res.data;
        else return { ok: false, message: `换取登录凭证失败（${res.msg || res.code}），请刷新二维码` };
      } catch (err) {
        return { ok: false, message: `换取登录凭证时网络波动（${err instanceof Error ? err.message : String(err)}），正在重试…` };
      }
    }
    const uid = pick(login.id, login.uid, login.userId);
    const token = pick(login.token, login.userToken);
    if (!/^\d+$/.test(uid) || !token || /[;\s]/.test(token)) return { ok: false, message: '波点没有返回有效的登录凭证，请刷新二维码' };
    const nickname = pick(login.userInfo?.nickname, login.nickname);
    this.cookies.set('bodian', `uid=${uid}; token=${token}; devid=${bodianDevId()}`, undefined, nickname || undefined);
    return { ok: true, message: `登录成功${nickname ? '：' + nickname : ''}`, nickname: nickname || undefined };
  }

  /** 真实请求一次 playlist/userCreate 核验票据，再尽力读资料。 */
  async getAccount(): Promise<AccountInfo | null> {
    const rec = this.cookies.get('bodian');
    if (!rec?.cookies) return null;
    const session = parseBodianSession(this.cookies.getHeader('bodian'));
    if (!session) return { loggedIn: false, authStatus: 'missing', error: '波点登录信息不完整，请重新登录' };

    let authStatus: 'valid' | 'unknown' = 'unknown';
    let nickname = rec.nickname || '';
    let avatarUrl = '';
    let isVip = false;
    try {
      const res = await this.api.userCreate(session);
      if (BODIAN_AUTH_REJECT_CODES.has(res.code)) {
        console.warn(`[BodianLogin] 票据失效 错误码=${res.code}`);
        return { loggedIn: false, authStatus: 'expired', error: BODIAN_AUTH_EXPIRED };
      }
      if (res.code === 200) {
        authStatus = 'valid';
        // 资料取自自建歌单的作者字段（users/login 的 GET 读资料实测一律 HTTP 500，#184）。
        const me = bodianSelfFromPlaylists(res.data, session.uid);
        if (me) {
          nickname = me.nickname || nickname;
          avatarUrl = me.avatarUrl;
          isVip = me.isVip;
        }
      } else console.warn(`[BodianLogin] 核验接口返回错误码=${res.code}，按未知处理`);
    } catch (err) {
      // 网络异常：不能判登出，也不能确认有效。
      console.warn('[BodianLogin] 票据核验请求失败，按未知处理:', err instanceof Error ? err.message : '');
    }
    const vipType = isVip ? 1 : 0;
    return {
      loggedIn: true,
      authStatus,
      userId: session.uid,
      nickname: nickname || '波点用户',
      avatarUrl: /^https?:\/\//i.test(avatarUrl) ? avatarUrl : undefined,
      vipType,
      isVip,
      isSvip: false,
    };
  }
}
