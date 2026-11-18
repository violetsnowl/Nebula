import { createHash } from 'node:crypto';
import type { HttpClient } from '../http';
import { throwIfCancelled } from '../requestScope';

export const QQ_AUTH_EXPIRED = 'QQ 登录已过期，请重新登录';
export type QqAuthStatus = 'missing' | 'valid' | 'expired' | 'unknown';
export interface QqCredential { uin:string; key:string; keyName:string; loginType:number }

/** 始终使用字符串保存微信长账号；OAuth/p_skey不是音乐播放票据。 */
export function qqCredential(cookie:string):QqCredential {
  const fields:Record<string,string>={};
  for(const part of cookie.split(';')) {
    const at=part.indexOf('=');if(at>0)fields[part.slice(0,at).trim().toLowerCase()]=part.slice(at+1).trim();
  }
  const loginType=Number(fields.login_type || fields.logintype || (fields.wxopenid?'2':'1'))===2?2:1;
  const nativePair=!!(fields.musickey && (fields.str_musicid || fields.musicid));
  const raw=nativePair ? fields.str_musicid || fields.musicid : loginType===2
    ? fields.wxuin || fields.uin || fields.qqmusic_uin : fields.uin || fields.qqmusic_uin || fields.wxuin;
  const normalized=String(raw || '').replace(/^o/,'').replace(/^0+(?=\d)/,'');
  const uin=/^\d+$/.test(normalized) && normalized!=='0'?normalized:'0';
  const keyName=(nativePair?['musickey']:['qm_keyst','qqmusic_key','music_key','musickey','wxskey']).find(k=>!!fields[k]) || '';
  return {uin,key:fields[keyName] || '',keyName,loginType};
}

export function qqComm(credential:QqCredential, ct=24):Record<string,unknown> {
  let gtk=5381;for(const char of credential.key)gtk=(gtk*33+char.charCodeAt(0))|0;gtk&=0x7fffffff;
  return {uin:credential.uin,ct,cv:ct===24?4747474:0,format:'json',platform:'yqq.json',tmeLoginType:credential.loginType,
    g_tk:gtk,g_tk_new_20200303:gtk,
    ...(credential.key?{authst:credential.key}:{})};
}
export const qqLoginProbe = () => ({module:'music.UserInfo.userInfoServer',method:'GetLoginUserInfo',param:{}});
export const qqSessionKey = (cookie:string):string => createHash('sha256').update(cookie).digest('hex');

/** 这些码只用于登录核验接口，不把歌曲接口的空purl/参数错误当作过期。 */
export function parseQqLoginProbe(part:any, expectedUin:string):QqAuthStatus {
  if([1000,104400,104401].includes(Number(part?.code)))return 'expired';
  if(part?.code!==0 || !part.data || typeof part.data!=='object' || Array.isArray(part.data) || !Object.keys(part.data).length)return 'unknown';
  const data=part.data, user=data.userInfo || data.user_info || data;
  const identity=user.str_musicid ?? user.musicid ?? user.uin;
  if(identity!=null && String(identity)!==expectedUin)return 'unknown';
  return 'valid';
}

/** 仅缓存脱离凭据值的核验状态；按整份Cookie隔离，换票据即重新核验。 */
export class QqSessionService {
  private cache=new Map<string,{status:QqAuthStatus;until:number}>();
  private expiredListeners=new Set<(cookie:string)=>void>();
  constructor(private http:HttpClient) {}
  /** 确认过期时通知（自动续期用）；返回取消订阅函数。 */
  onExpired(fn:(cookie:string)=>void):()=>void {this.expiredListeners.add(fn);return ()=>{this.expiredListeners.delete(fn);};}
  private cached(cookie:string) {
    const hit=this.cache.get(qqSessionKey(cookie));return hit && hit.until>Date.now()?hit:undefined;
  }
  needsProbe(cookie:string):boolean {const c=qqCredential(cookie);return !!c.key && c.uin!=='0' && !this.cached(cookie);}
  peek(cookie:string):QqAuthStatus {
    const c=qqCredential(cookie);return !c.key || c.uin==='0'?'missing':this.cached(cookie)?.status || 'unknown';
  }
  remember(cookie:string,status:QqAuthStatus):QqAuthStatus {
    const key=qqSessionKey(cookie);this.cache.delete(key);
    this.cache.set(key,{status,until:Date.now()+(status==='valid'?300_000:status==='expired'?30_000:15_000)});
    if(this.cache.size>16)this.cache.delete(this.cache.keys().next().value!);
    if(status==='expired')for(const fn of this.expiredListeners){try{fn(cookie);}catch{/* 监听方自理 */}}
    return status;
  }
  observe(cookie:string,part:unknown):QqAuthStatus {
    const status=parseQqLoginProbe(part,qqCredential(cookie).uin);
    return status==='unknown' && this.cached(cookie)?this.peek(cookie):this.remember(cookie,status);
  }
  clear():void {this.cache.clear();}
  async check(cookie:string,force=false):Promise<QqAuthStatus> {
    if(this.peek(cookie)==='missing')return 'missing';
    if(!force && this.cached(cookie))return this.peek(cookie);
    const credential=qqCredential(cookie);
    try {
      const data=await this.http.requestJson<any>('https://u.y.qq.com/cgi-bin/musicu.fcg',{
        platform:'qq',cookie,method:'POST',timeoutMs:1800,body:{comm:qqComm(credential),req_login:qqLoginProbe()},
      });
      return this.observe(cookie,data?.req_login ?? (data?.code?{code:data.code}:undefined));
    } catch {throwIfCancelled();return this.remember(cookie,'unknown');}
  }
}
const sessions=new WeakMap<HttpClient,QqSessionService>();
export function qqSession(http:HttpClient):QqSessionService {
  let service=sessions.get(http);if(!service){service=new QqSessionService(http);sessions.set(http,service);}return service;
}
