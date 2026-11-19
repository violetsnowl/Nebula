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
export const LOGIN_HOW: Record<string, string> = {
  netease: '用网易云音乐 App 扫码登录',
  qq: '在官方登录页用手机 QQ 扫码，登录后自动回到这里',
  kugou: '用酷狗音乐 App 扫码登录',
  qishui: '用汽水音乐 App 扫码登录',
  spotify: '在浏览器里授权，授权完成后自动回到这里',
  kuwo: '在酷我官网登录：账号密码、短信或 QQ / 微信',
  bodian: '用波点音乐 App 扫码登录',
  ytmusic: '在默认浏览器输入代码登录 Google 账号',
  applemusic: '在软件里打开 Apple 官方页面，用 Apple ID 登录',
};
