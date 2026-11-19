import type {Track,CoverInfo} from '../types';
import {withRequestScope,requestScope} from '../requestScope';

/** 原图优先，保留有效的小图作为候选；不下载后重采样。 */
export function coverCandidates(track:Pick<Track,'platform'|'cover'>):string[] {
  const raw=track.cover;if(!/^https?:\/\//i.test(raw))return [];
  try{
    const u=new URL(raw);
    // 酷我多级 CDN 的 https 证书与域名不匹配：保持原协议，不升级。
    if(track.platform==='kuwo' || track.platform==='bodian')return [u.href];
    u.protocol='https:';
    if(track.platform==='netease'){u.searchParams.delete('param');return [...new Set([u.href,raw])];}
    if(track.platform==='qq')return [...new Set([u.href.replace(/T002R\d+x\d+M000/,'T002M000'),u.href.replace(/T002R\d+x\d+M000/,'T002R800x800M000'),raw])];
    if(track.platform==='kugou')return [...new Set([u.href.replace(/\{size\}|%7Bsize%7D/gi,'0').replace(/\/stdmusic\/\d+\//,'/stdmusic/0/'),u.href.replace(/\{size\}|%7Bsize%7D/gi,'1000'),raw])];
    // 汽水图床不认不带后缀的地址（400）；原图用 ~tplv-obj.image（#183 实测）。
    if(track.platform==='qishui'){u.pathname=u.pathname.replace(/~[^/]*$/,'')+'~tplv-obj.image';return [...new Set([u.href,raw])];}
    // YouTube：封面是视频缩略图，有视频 ID 时优先试最大的 maxres，再 hq，最后原地址（maxres 不是每个视频都有）。
    if(track.platform==='ytmusic'){
      const id=u.pathname.match(/^\/vi(?:_webp)?\/([A-Za-z0-9_-]{11})\//)?.[1];
      if(id && /(?:^|\.)ytimg\.com$/i.test(u.hostname))return [...new Set([`https://i.ytimg.com/vi/${id}/maxresdefault.jpg`,`https://i.ytimg.com/vi/${id}/hqdefault.jpg`,u.href])];
    }
    return [u.href];
  }catch{return [];}
}
export function imageDimensions(b:Buffer):{width:number;height:number}|null {
  let width=0,height=0;
  if(b.length>=24 && b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))){width=b.readUInt32BE(16);height=b.readUInt32BE(20);}
  else if(b.length>=10 && /^GIF8[79]a/.test(b.toString('ascii',0,6))){width=b.readUInt16LE(6);height=b.readUInt16LE(8);}
  else if(b.length>=30 && b.toString('ascii',0,4)==='RIFF' && b.toString('ascii',8,12)==='WEBP'){
    const kind=b.toString('ascii',12,16);
    if(kind==='VP8X'){width=b.readUIntLE(24,3)+1;height=b.readUIntLE(27,3)+1;}
    if(kind==='VP8 ' && b[23]===0x9d && b[24]===1 && b[25]===0x2a){width=b.readUInt16LE(26)&0x3fff;height=b.readUInt16LE(28)&0x3fff;}
    if(kind==='VP8L' && b[20]===0x2f){width=1+b[21]!+((b[22]!&63)<<8);height=1+(b[22]!>>6)+(b[23]!<<2)+((b[24]!&15)<<10);}
  }else if(b.length>=4 && b[0]===255 && b[1]===216){
    let i=2;
    while(i+4<=b.length){
      if(b[i]!==255){i++;continue;}const marker=b[i+1]!;if(marker===255){i++;continue;}
      if(marker===217 || marker===218)break;
      if(marker===216 || marker===1 || (marker>=208 && marker<=215)){i+=2;continue;}
      const size=b.readUInt16BE(i+2);if(size<2 || i+2+size>b.length)break;
      if([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker) && size>=7){height=b.readUInt16BE(i+5);width=b.readUInt16BE(i+7);break;}i+=size+2;
    }
  }
  return width>0 && height>0 && width<=32768 && height<=32768?{width,height}:null;
}
function allowed(u:URL):boolean {
  return ['https:','http:'].includes(u.protocol) && !u.username && !u.password && ['music.126.net','music.163.com','gtimg.cn','gtimg.com','qq.com','kugou.com','kugou.net','kuwo.cn','scdn.co','byteimg.com','douyinpic.com','bytedance.net','ytimg.com','ggpht.com','googleusercontent.com'].some(h=>u.hostname===h || u.hostname.endsWith('.'+h));
}
export class CoverService {
  private cache=new Map<string,{at:number;info:CoverInfo}>();
  private pending=new Map<string,Promise<CoverInfo|null>>();
  async inspect(track:Pick<Track,'platform'|'cover'>, originalOnly=false):Promise<CoverInfo|null> {
    const candidates=originalOnly && /^https?:/.test(track.cover)?[track.cover]:coverCandidates(track);if(!candidates.length)return null;
    const key=candidates.join('|'),hit=this.cache.get(key);
    if(hit && Date.now()-hit.at<86400000)return hit.info;
    if(this.pending.has(key))return this.pending.get(key)!;
    if(this.pending.size>=4)return {url:candidates[0]!,verified:false};
    const work=withRequestScope(5000,async()=>{
      for(const raw of candidates){
        try{
          const info=await withRequestScope(2200,async()=>{
            let url=new URL(raw);
            for(let hop=0;hop<=3;hop++){
              if(!allowed(url))return null;
              const response=await fetch(url,{redirect:'manual',headers:{Range:'bytes=0-65535'},signal:requestScope()?.signal});
              if(response.status>=300 && response.status<400){await response.body?.cancel();const next=response.headers.get('location');if(!next)return null;url=new URL(next,url);continue;}
              if(!response.ok){await response.body?.cancel();return null;}
              const reader=response.body?.getReader();if(!reader)return null;
              let buffer=Buffer.alloc(0);
              try{while(buffer.length<65536){const part=await reader.read();if(part.done)break;buffer=Buffer.concat([buffer,Buffer.from(part.value)]).subarray(0,65536);const dim=imageDimensions(buffer);if(dim)return {url:url.href,...dim,verified:true};}}finally{await reader.cancel().catch(()=>{});}
              return null;
            }return null;
          });
          if(info)return info;
        }catch{/* 大图不可用时尝试原有小图 */}
      }
      return {url:track.cover,verified:false};
    },{detached:true}).catch(()=>({url:track.cover,verified:false})).then(info=>{
      if(info.verified){this.cache.set(key,{at:Date.now(),info});if(this.cache.size>500)this.cache.delete(this.cache.keys().next().value!);}return info;
    }).finally(()=>this.pending.delete(key));
    this.pending.set(key,work);return work;
  }
}
