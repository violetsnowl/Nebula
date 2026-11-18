import type { HttpClient } from '../http';
import type { CookieStore } from '../cookieStore';
import type { Platform, PlatformAdapter } from '../types';
import { NeteaseAdapter } from './neteaseAdapter';
import { QqAdapter } from './qqAdapter';
import { KugouAdapter } from './kugouAdapter';
import { SpotifyAdapter } from './spotifyAdapter';
import { QishuiAdapter } from './qishuiAdapter';
import { KuwoAdapter } from './kuwoAdapter';
import { BodianAdapter } from './bodianAdapter';

export type AdapterMap = Record<Platform, PlatformAdapter>;

export function createAdapters(http: HttpClient, cookies: CookieStore): AdapterMap {
  return {
    netease: new NeteaseAdapter(http, cookies),
    qq: new QqAdapter(http, cookies),
    kugou: new KugouAdapter(http, cookies),
    spotify: new SpotifyAdapter(http, cookies),
    qishui: new QishuiAdapter(http, cookies),
    kuwo: new KuwoAdapter(http, cookies),
    bodian: new BodianAdapter(http, cookies),
  };
}

export interface UrlTarget {
  platform: Platform;
  id: string;
}

/** 解析歌单链接/ID → 平台 + ID；无法识别返回 null。 */
export function resolveAdapterByUrl(input: string): UrlTarget | null {
  const url = input.trim();
  if (/music\.163\.com/.test(url)) {
    const id =
      url.match(/(?:playlist|songlist)[^0-9]*(\d+)/i)?.[1] ?? url.match(/[?&]id=(\d+)/i)?.[1];
    if (id) return { platform: 'netease', id };
  }
  if (/(y\.qq\.com|music\.qq\.com|c\.y\.qq\.com)/.test(url)) {
    const id =
      url.match(/playlist\/(\d+)/i)?.[1] ?? url.match(/[?&](?:disstid|id)=(\d+)/i)?.[1];
    if (id) return { platform: 'qq', id };
  }
  if (/kugou\.com/.test(url)) {
    const id = url.match(/playlist\/(\d+)/i)?.[1] ?? url.match(/special\/single\/(\d+)/i)?.[1] ?? url.match(/[?&](?:specialid|id)=(\d+)/i)?.[1];
    if (id) return { platform: 'kugou', id };
  }
  if (/open\.spotify\.com/.test(url)) {
    const id = url.match(/playlist\/([A-Za-z0-9]+)/i)?.[1];
    if (id) return { platform: 'spotify', id };
  }
  if (/qishui\.com/.test(url) || /douyin\.com/.test(url)) {
    const id = url.match(/id=([\d]+)/i)?.[1] ?? url.match(/playlist\/([\d]+)/i)?.[1];
    if (id) return { platform: 'qishui', id };
  }
  // 波点分享页（h5app.kuwo.cn/m/bodian/collection.html）与酷我同属 kuwo.cn，必须排在酷我规则之前。
  if (/(?:^|[/.@])kuwo\.cn(?:[:/?#]|$)/i.test(url) && /\/bodian\//i.test(url)) {
    const id = url.match(/[?&]playlistId=(\d+)/i)?.[1];
    if (id) return { platform: 'bodian', id: `${id}:${url.match(/[?&]source=(\d+)/i)?.[1] || '5'}` };
  }
  if (/(?:^|[/.@])kuwo\.cn(?:[:/?#]|$)/i.test(url)) {
    const id = url.match(/playlist_detail\/(\d+)/i)?.[1] ?? url.match(/[?&#]pid=(\d+)/i)?.[1];
    if (id) return { platform: 'kuwo', id };
  }
  return null;
}
