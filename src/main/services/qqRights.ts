import type { HttpClient } from '../http';
import { qqComm, qqCredential, qqSession, qqSessionKey } from './qqSession';
import { throwIfCancelled } from '../requestScope';

export interface QqRights {
  isVip:boolean; isSvip:boolean; vipType:number; expiresAt:number|null;
  /** false表示缺少可解释字段，不是已确认普通账号。 */
  known:boolean;
}
const key=(s:string)=>s.replace(/[^a-z0-9]/gi,'').toLowerCase();
const VIP=['isvip','vip','vipflag','ivipflag','inewvip','isgreenvip','greenvip','ismember','isassociator','associator','hugevip'];
const SVIP=['issvip','svip','svipflag','isupervip','inewsupervip','issupervip','supervip','greensvip'];
const VIP_TYPE=['viptype','viplevel','musicviptype','greenviptype','associatortype'];
const SVIP_TYPE=['sviptype','sviplevel','superviptype','superviplevel'];
const genericExpiry=['expiretime','expiresat','expireat','endtime','overdate'];
const vipExpiry=['vipexpiretime','vipexpireat','vipendtime','greenvipendtime','hugevipend',...genericExpiry];
const svipExpiry=['svipexpiretime','svipendtime','superendtime',...genericExpiry];
const wrappers=new Set(['data','user','vip','vipinfo','svipinfo','identity','userinfo']);
const flag=(v:unknown):boolean|undefined=>{
  if(v===true || v===1 || v==='1')return true;
  if(v===false || v===0 || v==='0')return false;
  return undefined;
};
function timestamp(v:unknown):number|null {
  if(v==null || v==='')return null;
  const n=Number(v),t=Number.isFinite(n)?(n<1e10?n*1000:n):Date.parse(String(v));
  return Number.isFinite(t) && t>=946684800000?t:null;
}
/** 只解释会员字段和固定包装层；未知文本、积分、OAuth有效期不能升级会员。 */
export function parseQqRights(payload:unknown):QqRights {
  const vip:Array<{active:boolean;type:number;end:number|null}>=[],svip:typeof vip=[];
  const walk=(obj:unknown,depth=0)=>{
    if(depth>5 || !obj || typeof obj!=='object' || Array.isArray(obj))return;
    const fields=Object.fromEntries(Object.entries(obj).map(([k,v])=>[key(k),v]));
    for(const [flags,types,ends,output] of [[VIP,VIP_TYPE,vipExpiry,vip],[SVIP,SVIP_TYPE,svipExpiry,svip]] as const){
      const values=flags.map(k=>flag(fields[k])).filter((v):v is boolean=>v!==undefined);
      const levels=types.map(k=>fields[k]).filter(v=>v!=null && v!=='' && Number.isFinite(Number(v)) && Number(v)>=0).map(Number);
      if(!values.length && !levels.length)continue;
      const end=ends.map(k=>timestamp(fields[k])).find(t=>t!==null) ?? null;
      const type=Math.max(0,...levels),positive=values.length?values.includes(true):type>0;
      output.push({active:positive && (end===null || end>Date.now()),type,end});
    }
    for(const [k,v] of Object.entries(fields))if(wrappers.has(k))walk(v,depth+1);
  };
  walk(payload);
  const isSvip=svip.some(v=>v.active),isVip=isSvip || vip.some(v=>v.active);
  const active=[...vip,...svip].filter(v=>v.active),expiries=active.map(v=>v.end).filter((v):v is number=>v!==null);
  return {isVip,isSvip,vipType:Math.max(0,...active.map(v=>v.type)),expiresAt:expiries.length?Math.min(...expiries):null,
    known:vip.length>0 || isSvip};
}

/** 会员查询使用当前账号和音乐票据；正、负、未知按凭据隔离，失败不变成普通账号。 */
export class QqRightsService {
  private cache=new Map<string,{until:number;rights:QqRights|null}>();
  constructor(private http:HttpClient) {}
  clear():void {this.cache.clear();}
  async getRights(cookie:string):Promise<QqRights|null> {
    const credential=qqCredential(cookie),session=qqSession(this.http),id=qqSessionKey(cookie);
    if(credential.uin==='0' || !credential.key || session.peek(cookie)==='expired'){this.cache.delete(id);return null;}
    const hit=this.cache.get(id);if(hit && hit.until>Date.now())return hit.rights;
    let rights:QqRights|null=null;
    const probes=[
      {module:'userInfo.VipQueryServer',method:'SRFVipQuery_V2',param:{uin_list:[credential.uin]}},
      {module:'userInfo.VipQueryServer',method:'SRFVipQuery',param:{uin_list:[credential.uin]}},
      {module:'VipLogin.VipLoginInter',method:'vip_login_base',param:{}},
    ];
    for(const probe of probes){
      try {
        const data=await this.http.requestJson<any>('https://u.y.qq.com/cgi-bin/musicu.fcg',{
          platform:'qq',cookie,method:'POST',timeoutMs:800,body:{comm:qqComm(credential),req_0:probe},
        });
        const part=data?.req_0;
        // VipLogin 是当前登录账号接口；按号查询VIP不能反证票据有效。
        if(probe.module==='VipLogin.VipLoginInter' && [1000,104401].includes(Number(part?.code))){session.remember(cookie,'expired');break;}
        if((data?.code!=null && data.code!==0) || part?.code!==0)continue;
        const body=part.data;
        const scoped=probe.module==='VipLogin.VipLoginInter'?body:(body?.infoMap?.[credential.uin] ?? body?.uin_map?.[credential.uin]);
        const parsed=parseQqRights(scoped);
        if(parsed.known){rights=parsed;break;}
      } catch {throwIfCancelled();}
    }
    const ttl=rights?(rights.isVip?300_000:30_000):15_000;
    this.cache.delete(id);this.cache.set(id,{rights,until:Math.min(Date.now()+ttl,rights?.expiresAt ?? Infinity)});
    if(this.cache.size>16)this.cache.delete(this.cache.keys().next().value!);
    return rights;
  }
}
