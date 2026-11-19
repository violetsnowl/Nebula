import fs from 'node:fs';
import path from 'node:path';
import type { Lyric } from '../types';

type RecordEntry={at:number;lyric:Lyric};
/** 和声（#199）：新增的可选字段，宽松校验，类型不对的整条拒绝。 */
const validBg=(b:unknown):boolean=>{
  if(b===undefined)return true;
  if(!b || typeof b!=='object')return false;
  const x=b as {text?:unknown;words?:unknown};
  if(typeof x.text!=='string')return false;
  return x.words===undefined || (Array.isArray(x.words) && x.words.every(w=>w && typeof w.text==='string' && Number.isFinite(w.startMs) && Number.isFinite(w.duration)));
};
const valid=(v:unknown):v is Lyric=>{
  if(!v || typeof v!=='object')return false;
  const l=v as Lyric;
  return typeof l.raw==='string' && Array.isArray(l.lines) && l.lines.every(x=>x && Number.isFinite(x.timeMs) && typeof x.text==='string' && (x.translation===undefined || typeof x.translation==='string') &&
      (x.agent===undefined || x.agent==='v1' || x.agent==='v2' || x.agent==='both') && validBg(x.bg)) &&
    ['yrc','qrc','krc','translationRaw','romanRaw','lrc','tlyric','ytlrc','romalrc'].every(k=>(l as any)[k]===undefined || typeof (l as any)[k]==='string');
};
/** v4 缓存拒绝旧逻辑生成的数据（v3：#197 判定按语种、补罗马音；v4：#199 够好的歌也查 AMLL 补和声 / 对唱；v5：#201 截断的歌词不算完整，旧结果作废）；不完整项 6 小时，完整项 30 天，最多 500 项。 */
export class LyricCache {
  private data:Record<string,RecordEntry>=Object.create(null);
  private cacheFile:string;
  private timer:ReturnType<typeof setTimeout>|null=null;
  private saving:Promise<void>=Promise.resolve();
  constructor(dir:string){this.cacheFile=path.join(dir,'lyric-cache.json');this.load();}
  get(platform:string,id:string):Lyric|null {
    const r=this.data[`${platform}:${id}`];if(!r)return null;
    const ttl=r.lyric.incomplete!==false?6*3600000:30*24*3600000;
    if(Date.now()-r.at>ttl || !valid(r.lyric)){delete this.data[`${platform}:${id}`];this.schedule();return null;}
    return r.lyric;
  }
  set(platform:string,id:string,lyric:Lyric):void {
    if(!valid(lyric))return;
    this.data[`${platform}:${id}`]={at:Date.now(),lyric};
    const keys=Object.keys(this.data).sort((a,b)=>this.data[a]!.at-this.data[b]!.at);
    keys.slice(0,Math.max(0,keys.length-500)).forEach(k=>delete this.data[k]);this.schedule();
  }
  /** 手动换歌词后作废这一首的缓存。 */
  delete(platform:string,id:string):void {
    if(delete this.data[`${platform}:${id}`])this.schedule();
  }
  private load():void {
    try{
      if(fs.statSync(this.cacheFile).size>32*1024*1024)return;
      const value=JSON.parse(fs.readFileSync(this.cacheFile,'utf8'));
      if(value?.schema!==5 || !value.entries || typeof value.entries!=='object')return;
      for(const [key,v] of Object.entries(value.entries).slice(-500)){
        const row=v as RecordEntry;if(row && Number.isFinite(row.at) && valid(row.lyric))this.data[key]=row;
      }
    }catch{/* 缺失/旧版/损坏缓存安全重新获取 */}
  }
  private schedule():void {if(this.timer)return;this.timer=setTimeout(()=>{this.timer=null;void this.flush();},400);this.timer.unref?.();}
  async flush():Promise<void> {
    if(this.timer)clearTimeout(this.timer);this.timer=null;
    const snapshot=JSON.stringify({schema:5,entries:this.data});
    this.saving=this.saving.catch(()=>{}).then(async()=>{
      try{await fs.promises.mkdir(path.dirname(this.cacheFile),{recursive:true});const tmp=`${this.cacheFile}.${process.pid}.tmp`;await fs.promises.writeFile(tmp,snapshot,'utf8');await fs.promises.rename(tmp,this.cacheFile);}
      catch{console.warn('[LyricCache] 保存失败');}
    });
    await this.saving;
  }
}
