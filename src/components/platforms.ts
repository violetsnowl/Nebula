import neteaseLogo from '../../docs/logo/网易云.webp';
import qqLogo from '../../docs/logo/QQmusic logo.png';
import kugouLogo from '../../docs/logo/kugou.webp';
import qishuiLogo from '../../docs/logo/qishui.png';
import spotifyLogo from '../../docs/logo/spotify logo.png';
import kuwoLogo from '../../docs/logo/kuwo.png';
import bodianLogo from '../../docs/logo/bodian.webp';
import ytmusicLogo from '../../docs/logo/Youtube_Music_icon.svg.webp';
import applemusicLogo from '../../docs/logo/apple music.jpg';

export interface PlatformMeta {
  id: string;
  name: string;
  /** 统一圆形裁切后展示的官方 logo 素材。 */
  logo: string;
  /** 品牌主色：用于低透明度底衬与高光，保证五家视觉统一。 */
  brand: string;
}

export const PLATFORM_META: Record<string, PlatformMeta> = {
  netease: { id: 'netease', name: '网易云音乐', logo: neteaseLogo, brand: '#e60026' },
  qq: { id: 'qq', name: 'QQ 音乐', logo: qqLogo, brand: '#31c27c' },
  kugou: { id: 'kugou', name: '酷狗音乐', logo: kugouLogo, brand: '#2a9df4' },
  qishui: { id: 'qishui', name: '汽水音乐', logo: qishuiLogo, brand: '#ff5a79' },
  spotify: { id: 'spotify', name: 'Spotify', logo: spotifyLogo, brand: '#1db954' },
  kuwo: { id: 'kuwo', name: '酷我音乐', logo: kuwoLogo, brand: '#ffb400' },
  bodian: { id: 'bodian', name: '波点音乐', logo: bodianLogo, brand: '#00e0b8' },
  ytmusic: { id: 'ytmusic', name: 'YouTube Music', logo: ytmusicLogo, brand: '#ff0033' },
  applemusic: { id: 'applemusic', name: 'Apple Music', logo: applemusicLogo, brand: '#fa243c' },
};

/** 左右 Dock 统一的平台顺序（与后端 platform id 一致）。 */
export const DOCK_PLATFORM_ORDER = ['netease', 'qq', 'kugou', 'kuwo', 'bodian', 'qishui', 'spotify', 'ytmusic', 'applemusic'] as const;

export function platformMeta(id: string): PlatformMeta {
  return PLATFORM_META[id] ?? { id, name: id, logo: '', brand: '#8b93b8' };
}

/** 各平台登录说明（一句话）：账号详情页顶部和内嵌登录弹窗的页头共用。 */
/**
 * 登录页标题下的一句话（2026-11-21 #221 统一文案）：只说「用什么、在哪里登录」，不带句号；
 * 具体步骤写在各平台的三步说明里（AccountDock 的 LoginSteps）。
 */
export const LOGIN_HOW: Record<string, string> = {
  netease: '用网易云音乐 App 扫码登录',
  qq: '用手机 QQ 扫码登录',
  kugou: '用酷狗音乐 App 扫码登录',
  qishui: '用汽水音乐 App 扫码登录',
  spotify: '在浏览器里授权 Spotify 账号',
  kuwo: '在酷我音乐官方登录页登录',
  bodian: '用波点音乐 App 扫码登录',
  ytmusic: '在浏览器里用代码授权 Google 账号',
  applemusic: '在 Apple Music 官方登录页登录',
};
