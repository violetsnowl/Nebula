import type {Lyric,LyricLine} from '../types';
import {parseLrc} from '../parsers/lyricParser';
import {lrcAt,timedLines,toYrc} from '../parsers/timedLyrics';
import {identityText} from './recordingMatch';
const textRows=(l:Lyric):LyricLine[]=>l.lines.filter(x=>x.text.trim() && !/^(作词|作曲|编曲|词|曲|lyrics|composer|producer)\s*[:：]/i.test(x.text));
export function lyricCoverage(l:Lyric):{wordLines:number;textLines:number;translatedLines:number} {
  const rows=textRows(l),words=timedLines(l.yrc || '');
  return {textLines:rows.length,translatedLines:rows.filter(x=>x.translation?.trim()).length,
    wordLines:rows.filter(x=>words.some(w=>Math.abs(w.timeMs-x.timeMs)<=250 && identityText(w.text)===identityText(x.text))).length};
}
/** 至少三个唯一正文锚点，覆盖歌曲大半时间；只允许稳定的常数偏移。 */
export function alignTimelines(base:Lyric,supplement:Lyric):{offsetMs:number;anchors:number}|null {
  const a=textRows(base),b=textRows(supplement);
  const index=(rows:LyricLine[])=>{
    const m=new Map<string,number[]>();for(const l of rows){const key=identityText(l.text);if(key.length<2)continue;m.set(key,[...(m.get(key)||[]),l.timeMs])}return m;
  };
  const ai=index(a),bi=index(b),pairs:Array<{at:number;delta:number}>=[];
  for(const [key,times] of ai){const other=bi.get(key);if(times.length===1 && other?.length===1)pairs.push({at:times[0]!,delta:times[0]!-other[0]!})}
  if(pairs.length<3 || pairs.length<Math.min(ai.size,bi.size)*.35)return null;
  const sorted=pairs.map(x=>x.delta).sort((x,y)=>x-y),offsetMs=sorted[Math.floor(sorted.length/2)]!;
  const residual=sorted.map(x=>Math.abs(x-offsetMs)).sort((x,y)=>x-y);
  const span=Math.max(...a.map(x=>x.timeMs))-Math.min(...a.map(x=>x.timeMs));
  if(Math.abs(offsetMs)>8000 || residual[Math.ceil(residual.length*.95)-1]!>180 || residual[residual.length-1]!>500 || Math.max(...pairs.map(x=>x.at))-Math.min(...pairs.map(x=>x.at))<span*.5)return null;
  return {offsetMs,anchors:pairs.length};
}
export function enrichAligned(base:Lyric,other:Lyric):Lyric {
  const alignment=alignTimelines(base,other);if(!alignment)return base;
  const offset=alignment.offsetMs,lines=base.lines.map(l=>({...l}));
  const translations=parseLrc(other.translationRaw || other.tlyric || '');
  for(const t of translations){
    const row=lines.filter(l=>l.text && Math.abs(l.timeMs-t.timeMs-offset)<=250).sort((a,b)=>Math.abs(a.timeMs-t.timeMs-offset)-Math.abs(b.timeMs-t.timeMs-offset))[0];
    if(row && !row.translation?.trim())row.translation=t.text;
  }
  const next:Lyric={...base,lines};
  const shifted=toYrc(timedLines(other.yrc || ''),offset);
  if(lyricCoverage({...next,yrc:shifted}).wordLines>lyricCoverage(next).wordLines)next.yrc=shifted;
  const cov=lyricCoverage(next),previous=lyricCoverage(base);
  if(cov.wordLines===previous.wordLines && cov.translatedLines===previous.translatedLines && (base.romanRaw || !other.romanRaw))return base;
  next.tlyric=next.translationRaw=lines.filter(l=>l.text && l.translation).map(l=>lrcAt(l.timeMs,l.translation!)).join('\n');
  if(!next.romanRaw && other.romanRaw)next.romanRaw=next.romalrc=parseLrc(other.romanRaw).filter(l=>l.timeMs+offset>=0).map(l=>lrcAt(l.timeMs+offset,l.text)).join('\n');
  next.provenance=[...(base.provenance || []),{platform:other.identity?.platform || other.source || 'unknown',sourceId:other.identity?.sourceId || '',kind:'enrichment',...alignment}];
  return next;
}
