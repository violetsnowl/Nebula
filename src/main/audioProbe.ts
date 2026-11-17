import http from 'node:http';
import https from 'node:https';
import { createHash } from 'node:crypto';
import type { Platform } from './types';
import { PLATFORM_HEADERS } from './http';
import { audioPlatform } from './audioProxy';
import { requestScope, withRequestScope } from './requestScope';

export interface ProbeOptions { platform:Platform; cookie?:string; timeoutMs?:number; bytes?:number; signal?:AbortSignal; classify?:(url:URL)=>Platform|null }
export interface ProbeResult { ok:boolean; status?:number; contentType?:string; reason?:string }
const cache=new Map<string,{at:number; result:ProbeResult}>();
export const clearProbeCache=():void=>cache.clear();
const httpAgent=new http.Agent({keepAlive:true,maxSockets:6,maxTotalSockets:12,maxFreeSockets:2});
const httpsAgent=new https.Agent({keepAlive:true,maxSockets:6,maxTotalSockets:12,maxFreeSockets:2});

/** 必须有音频签名；audio/* 的 HTML 错误页也会被拦截。 */
export function looksLikeAudio(buf:Buffer,_contentType?:string):boolean {
  if (buf.length<2) return false;
  const start=buf.toString('latin1',0,12);
  return start.startsWith('ID3') || start.startsWith('fLaC') || start.slice(4,8)==='ftyp' || start.startsWith('OggS') ||
    (start.startsWith('RIFF') && start.slice(8,12)==='WAVE') || (buf[0]===0xff && (buf[1]&0xe0)===0xe0);
}
async function sample(url:URL,opts:ProbeOptions,limit:number,hop=0):Promise<{status:number;type:string;bytes:Buffer}> {
  const platform=(opts.classify || audioPlatform)(url);
  if (!platform || !['https:','http:'].includes(url.protocol) || url.username || url.password) throw new Error('invalid audio host');
  const headers:Record<string,string>={...PLATFORM_HEADERS[platform],Range:`bytes=0-${limit-1}`,Accept:'*/*'};
  // probe 只拿到了原平台凭证；跨平台跳转不携带它。
  if (platform===opts.platform && opts.cookie) headers.Cookie=opts.cookie;
  return new Promise((resolve,reject)=> {
    const secure=url.protocol==='https:';
    const req=(secure?https:http).request(url,{headers,signal:requestScope()?.signal,agent:secure?httpsAgent:httpAgent},res=> {
      const status=res.statusCode || 502;
      if (status>=300 && status<400) {
        res.destroy();
        if (hop>=3 || !res.headers.location) { reject(new Error('invalid redirect')); return; }
        try { resolve(sample(new URL(res.headers.location,url),opts,limit,hop+1)); } catch(e) { reject(e); }
        return;
      }
      const chunks:Buffer[]=[];let size=0,finished=false;
      const finish=() => { if (finished) return; finished=true; resolve({status,type:String(res.headers['content-type'] || ''),bytes:Buffer.concat(chunks)}); };
      res.on('data',(chunk:Buffer)=> {
        const part=chunk.subarray(0,Math.max(0,limit-size));chunks.push(part);size+=part.length;
        // 正常 512 字节 Range 等待 end，让 Agent 回收完整连接；仅截断超量/无长度响应。
        if (size>=limit && Number(res.headers['content-length'])!==size) { finish();res.destroy(); }
      });
      res.once('end',finish);
      res.once('aborted',()=>{ if (!finished) reject(new Error('probe interrupted')); });
      res.once('error',reject);
    });
    req.once('error',reject);req.end();
  });
}
export async function probeAudioUrl(raw:string,opts:ProbeOptions):Promise<ProbeResult> {
  if (!raw) return {ok:false,reason:'empty url'};
  const key=createHash('sha256').update(opts.platform+'\0'+(opts.cookie || '')+'\0'+raw).digest('hex');
  const hit=cache.get(key);
  if (!opts.signal?.aborted && !requestScope()?.forceRefresh && hit && Date.now()-hit.at<120000) return hit.result;
  try {
    const result=await withRequestScope(opts.timeoutMs ?? 1600,async()=> {
      const res=await sample(new URL(raw),opts,Math.max(32,Math.min(4096,opts.bytes || 512)));
      const ok=[200,206].includes(res.status) && looksLikeAudio(res.bytes,res.type);
      return {ok,status:res.status,contentType:res.type,...(!ok?{reason:'HTTP 状态或音频签名未通过'}:{})};
    },{signal:opts.signal});
    if (result.ok) { cache.delete(key);cache.set(key,{at:Date.now(),result});if(cache.size>500)cache.delete(cache.keys().next().value!); }
    return result;
  } catch { return {ok:false,reason:opts.signal?.aborted?'probe cancelled':'probe timeout or unavailable'}; }
}
export async function canPlayAudio(raw:string,opts:ProbeOptions):Promise<boolean> { return (await probeAudioUrl(raw,opts)).ok; }
