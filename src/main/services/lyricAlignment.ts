import type {Lyric,LyricLine} from '../types';
import {parseLrc} from '../parsers/lyricParser';
import {lrcAt,timedLines,toYrc} from '../parsers/timedLyrics';
import {identityText} from './recordingMatch';
// 正文行：去掉「短标签 + 冒号」的署名行（作词: / 制作人: / 音乐设计/监制: / Lyrics by： …），两平台写法各异，不算正文。
const creditRow=(text:string):boolean=>/^[^:：]{1,24}[:：]/.test(text.trim());
const textRows=(l:Lyric):LyricLine[]=>l.lines.filter(x=>x.text.trim() && !creditRow(x.text));
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
/**
 * 逐行正文对齐（固定偏移对不上时用）：两个平台给同一录音打的时间轴，每行开头常差几百毫秒且不固定，
 * 固定偏移对齐会整体失败（网易云来源的歌因此只有约 15% 有逐字）。
 * 这里按正文逐行配对：顺序一致、正文相同、单行时间差 ≤1.2 秒，配上的至少占本平台正文行的八成，
 * 且时间差中位数 ≤0.6 秒（排除系统性漂移），才把本平台的行时间改用对方的时间，并采用对方的逐字时间轴。
 * 调用方只在「同一录音」时才会拿别的平台歌词来补全。
 */
export function retimeByText(base:Lyric,other:Lyric):{lyric:Lyric;pairs:number;medianDeltaMs:number}|null {
  const a=textRows(base),b=textRows(other);
  if(a.length<3 || !b.length)return null;
  const pairs=new Map<LyricLine,LyricLine>(),deltas:number[]=[];
  let j=0;
  for(const row of a){
    const key=identityText(row.text);if(key.length<2)continue;
    // 还没配上第一句时在整段里找（开头的标题行、署名行数量不定），之后只往后看几行，保证顺序。
    for(let k=j;k<(pairs.size?Math.min(b.length,j+6):b.length);k++){
      if(identityText(b[k]!.text)===key && Math.abs(b[k]!.timeMs-row.timeMs)<=1200){pairs.set(row,b[k]!);deltas.push(Math.abs(b[k]!.timeMs-row.timeMs));j=k+1;break;}
    }
  }
  if(pairs.size<3 || pairs.size<a.length*.8)return null;
  const medianDeltaMs=[...deltas].sort((x,y)=>x-y)[Math.floor(deltas.length/2)]!;
  if(medianDeltaMs>600)return null;
  const lines=base.lines.map(l=>{
    const p=pairs.get(l);
    return p?{...l,timeMs:p.timeMs,translation:l.translation?.trim()?l.translation:p.translation}:{...l};
  }).sort((x,y)=>x.timeMs-y.timeMs);
  const next:Lyric={...base,lines,lrc:lines.map(l=>lrcAt(l.timeMs,l.text)).join('\n')};
  if(other.yrc)next.yrc=other.yrc;
  if(lines.some(l=>l.translation?.trim()))next.tlyric=next.translationRaw=lines.filter(l=>l.text && l.translation).map(l=>lrcAt(l.timeMs,l.translation!)).join('\n');
  if(!base.romanRaw && !base.romalrc && (other.romalrc || other.romanRaw))next.romanRaw=next.romalrc=other.romalrc || other.romanRaw;
  return {lyric:next,pairs:pairs.size,medianDeltaMs};
}
export function enrichAligned(base:Lyric,other:Lyric):Lyric {
  const alignment=alignTimelines(base,other);
  if(!alignment){
    // 只在对方逐字确实更多时才改用对方时间轴，避免为了补一句翻译改动原来的行时间。
    const retimed=retimeByText(base,other);
    if(!retimed || lyricCoverage(retimed.lyric).wordLines<=lyricCoverage(base).wordLines)return base;
    return {...retimed.lyric,provenance:[...(base.provenance || []),{platform:other.identity?.platform || other.source || 'unknown',sourceId:other.identity?.sourceId || '',kind:'enrichment',anchors:retimed.pairs}]};
  }
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
