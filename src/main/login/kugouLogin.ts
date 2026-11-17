import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import type { CookieStore } from '../cookieStore';
import { HttpClient } from '../http';
import type { AccountInfo } from '../types';
import {
  KUGOU_TICKET_MARK,
  KUGOU_TICKET_MOBILE,
  kugouCommonParams,
  kugouMobileHeaders,
  kugouSignedQuery,
  kugouWebSign,
  type KugouListResult,
  parseKugouQrStatus,
  parseKugouTicket,
  requestKugouMyPlaylists,
} from '../adapters/kugouAdapter';

const require_ = createRequire(__filename);

export const KUGOU_AUTH_EXPIRED = '酷狗登录已过期，请重新登录';

const LOGIN_BASE = 'https://login-user.kugou.com';
/** 二维码里写入的落地页（带 appid=1005：让手机端扫码后发的是手机端票据）。 */
const QR_LANDING = 'https://h5.kugou.com/apps/loginQRCode/html/index.html?appid=1005&';
const SRC_APPID = 2919;

/** 解码 KuGoo 复合值：处理 %uXXXX Unicode 编码 + 标准 URI 编码 */
function decodeKuGoo(raw: string): string {
  return decodeURIComponent(
    raw.replace(/%u([0-9a-fA-F]{4})/g, (_, hex) =>
      String.fromCharCode(parseInt(hex, 16))
    )
  );
}

/** 从 cookie 字符串中提取指定字段的值。 */
function extractCookieValue(cookie: string, name: string): string {
  for (const seg of cookie.split(';')) {
    const eq = seg.indexOf('=');
    if (eq <= 0) continue;
    const k = seg.slice(0, eq).trim();
    const v = seg.slice(eq + 1).trim();
    if (k === name) return v;
  }
  return '';
}

/** 设备 mid：对随机 GUID 取 md5 后当 16 进制数转十进制（与官方客户端同一算法）。 */
function newMid(): string {
  return BigInt('0x' + crypto.createHash('md5').update(crypto.randomUUID()).digest('hex')).toString();
}

/**
 * 酷狗登录：手机端扫码（appid 1005）。
 * - createQr：login-user /v2/qrcode 取 key，本地生成二维码图片；
 * - pollLogin：轮询 /v2/get_userinfo_qrcode，成功后把 token、userid、mid、dfid 与手机端标记存入 CookieStore；
 * - getAccount：真实请求一次「我的歌单」核验票据，20017 判过期，网络异常不判登出。
 * 老的网页登录窗口（electron/main.cjs）与网页票据仍可读；网页票据若被酷狗拒绝（20017）会被核验为过期，提示重新扫码。
 */
export class KugouLogin {
  private http: Pick<HttpClient, 'requestJson'>;
  /** 二维码 key → 生成它时用的设备参数；轮询必须沿用同一组 mid/dfid。 */
  private sessions = new Map<string, { mid: string; dfid: string }>();

  constructor(private cookies: CookieStore, http?: Pick<HttpClient, 'requestJson'>) {
    this.http = http ?? new HttpClient(cookies);
  }

  private async loginGet<T>(path: string, mid: string, dfid: string, extra: Record<string, string | number>): Promise<T> {
    const params = kugouCommonParams({ mid, dfid }, extra);
    const qs = kugouSignedQuery(params, (p) => kugouWebSign(p));
    return this.http.requestJson<T>(`${LOGIN_BASE}${path}?${qs}`, {
      platform: 'kugou',
      cookie: '',
      timeoutMs: 15000,
      headers: kugouMobileHeaders(mid, dfid, params.clienttime),
    });
  }

  async createQr(): Promise<{ unikey: string; payload: string; imageDataUrl?: string }> {
    const mid = newMid();
    const dfid = '-';
    const res = await this.loginGet<{ status?: number; error_code?: number; data?: { qrcode?: string } }>(
      '/v2/qrcode', mid, dfid,
      { appid: 1001, type: 1, plat: 4, srcappid: SRC_APPID, qrcode_txt: QR_LANDING },
    );
    const key = res?.data?.qrcode;
    if (!key) {
      throw new Error(`获取酷狗二维码失败 (错误码 ${Number(res?.error_code ?? 0) || 'unknown'})`);
    }
    this.sessions.set(key, { mid, dfid });
    if (this.sessions.size > 16) this.sessions.delete(this.sessions.keys().next().value!);
    const payload = `${QR_LANDING}qrcode=${key}`;
    let imageDataUrl: string | undefined;
    try {
      const QRCode = require_('qrcode') as { toDataURL: (t: string, o?: object) => Promise<string> };
      imageDataUrl = await QRCode.toDataURL(payload, { margin: 1 });
    } catch {
      /* 前端会回退用 payload 本地渲染二维码 */
    }
    return { unikey: key, payload, imageDataUrl };
  }

  async pollLogin(unikey: string): Promise<{ ok: boolean; message: string; nickname?: string }> {
    const dev = this.sessions.get(unikey) ?? { mid: newMid(), dfid: '-' };
    let resp: unknown;
    try {
      resp = await this.loginGet('/v2/get_userinfo_qrcode', dev.mid, dev.dfid,
        { plat: 4, appid: 1005, srcappid: SRC_APPID, qrcode: unikey });
    } catch (err) {
      return { ok: false, message: `网络波动（${err instanceof Error ? err.message : String(err)}），正在重试…` };
    }
    const st = parseKugouQrStatus(resp);
    switch (st.state) {
      case 'expired':
        this.sessions.delete(unikey);
        return { ok: false, message: '二维码已过期，请重新生成' };
      case 'waiting':
        return { ok: false, message: '等待扫码…' };
      case 'scanned':
        return { ok: false, message: '已扫码，请在手机上确认' };
      case 'unknown':
        return { ok: false, message: st.message };
      case 'success': {
        const cookie = [
          `t=${st.token}`,
          `KugooID=${st.userid}`,
          `kg_mid=${dev.mid}`,
          `kg_dfid=${dev.dfid}`,
          `${KUGOU_TICKET_MARK}=${KUGOU_TICKET_MOBILE}`,
        ].join('; ');
        this.sessions.delete(unikey);
        this.cookies.set('kugou', cookie, undefined, st.nickname || undefined);
        return { ok: true, message: `登录成功${st.nickname ? '：' + st.nickname : ''}`, nickname: st.nickname || undefined };
      }
    }
  }

  /** 真实请求一次「我的歌单」核验票据，返回账号信息。 */
  async getAccount(): Promise<AccountInfo | null> {
    const rec = this.cookies.get('kugou');
    if (!rec?.cookies) return null;
    const cookie = rec.cookies;

    const ticket = parseKugouTicket(cookie);
    if (!ticket) {
      // 只有用户 ID、没有票据：无法核验，按「登录信息不完整」处理（没有 ID 则当作未登录）。
      if (!/(?:KugooID|kugooID|userid|UserId|kugouID|uid)=/.test(cookie) && !extractCookieValue(cookie, 'KuGoo')) return null;
      return { loggedIn: false, authStatus: 'missing', error: '酷狗登录信息不完整，请重新登录' };
    }

    let result: KugouListResult | null = null;
    try {
      result = await requestKugouMyPlaylists(this.http, ticket, 1, 5, 10000);
    } catch (err) {
      // 网络异常 / 解析失败：不能判登出，也不能确认有效。
      console.warn('[KugouLogin] 票据核验请求失败，按未知处理:', err instanceof Error ? err.message : '');
    }
    if (result?.kind === 'expired') {
      console.warn(`[KugouLogin] 票据失效 错误码=${result.code}`);
      return { loggedIn: false, authStatus: 'expired', error: KUGOU_AUTH_EXPIRED };
    }
    if (result?.kind === 'error') {
      console.warn(`[KugouLogin] 核验接口返回错误码=${result.code}，按未知处理`);
    }

    // 昵称：KuGoo 复合值 → UserName / 登录时存的昵称 → 歌单创建者信息 → 兜底
    let nickname = '';
    let avatar = '';
    const kuGoo = extractCookieValue(cookie, 'KuGoo');
    if (kuGoo) {
      try {
        const decoded = decodeKuGoo(kuGoo);
        const parts = Object.fromEntries(decoded.split('&').map((p) => p.split('=')));
        if (parts.NickName) nickname = parts.NickName;
        if (parts.Pic) avatar = parts.Pic;
      } catch { /* 解析失败 */ }
    }
    if (!nickname) nickname = extractCookieValue(cookie, 'UserName') || rec.nickname || '';
    if ((!nickname || /^\d+$/.test(nickname) || nickname === '酷狗音乐') && result?.kind === 'ok') {
      const items = result.items;
      const own = items.filter((it) => String(it.list_create_userid ?? '') === ticket.userid);
      for (const item of [...own, ...items]) {
        const name = String(item.list_create_username || item.nickname || item.username || item.user_name || '');
        if (name && !/^\d+$/.test(name)) {
          nickname = name;
          if (!avatar) avatar = String(item.create_user_pic || item.user_pic || item.avatar || '');
          break;
        }
      }
    }

    return {
      loggedIn: true,
      authStatus: result?.kind === 'ok' ? 'valid' : 'unknown',
      userId: ticket.userid,
      nickname: nickname || '酷狗用户',
      avatarUrl: avatar,
      vipType: 0,
      isVip: false,
      isSvip: false,
    };
  }
}
