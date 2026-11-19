import type {Lyric,LyricLine} from '../types';
import {parseLrc} from '../parsers/lyricParser';
import {lrcAt,timedLines,toYrc,type TimedLine} from '../parsers/timedLyrics';
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
/** 逐行配对的时间窗：同一首歌两份歌词（普通行 / 逐字行）开头常差几百毫秒，实测九成在 1.1 秒内（#196）。 */
export const PAIR_WINDOW_MS=1200;

/**
 * 普通歌词行 ↔ 逐字行逐行配对：正文相同（identityText）、时间差 ≤ windowMs、顺序一致（配上一对后只往后找）。
 * rows / words 都要按时间排好。返回配上的对。
 */
export function pairRowsToWords(rows:LyricLine[],words:TimedLine[],windowMs=PAIR_WINDOW_MS):Array<[LyricLine,TimedLine]> {
  const out:Array<[LyricLine,TimedLine]>=[];
  let j=0;
  for(const row of rows){
    const key=identityText(row.text);if(!key)continue;
    while(j<words.length && words[j]!.timeMs<row.timeMs-windowMs)j++;
    for(let q=j;q<words.length && words[q]!.timeMs<=row.timeMs+windowMs;q++){
      if(identityText(words[q]!.text)===key){out.push([row,words[q]!]);j=q+1;break;}
    }
  }
  return out;
}

/** 按行改时间后重建 lrc / 翻译 / 罗马音文本；罗马音行跟着它挂的那句（原时间 ±300ms）一起挪。 */
function rebuildTimed(l:Lyric,lines:LyricLine[],moved:Map<number,number>):Lyric {
  const sorted=[...lines].sort((a,b)=>a.timeMs-b.timeMs);
  const next:Lyric={...l,lines:sorted,lrc:sorted.map(x=>lrcAt(x.timeMs,x.text)).join('\n')};
  if(sorted.some(x=>x.translation?.trim()))next.tlyric=next.translationRaw=sorted.filter(x=>x.text && x.translation).map(x=>lrcAt(x.timeMs,x.translation!)).join('\n');
  const roman=l.romalrc || l.romanRaw;
  if(roman && moved.size){
    const olds=[...moved.keys()];
    const rows=parseLrc(roman).map(r=>{
      const from=olds.filter(o=>Math.abs(o-r.timeMs)<=300).sort((a,b)=>Math.abs(a-r.timeMs)-Math.abs(b-r.timeMs))[0];
      return from===undefined?r:{...r,timeMs:moved.get(from)!};
    }).sort((a,b)=>a.timeMs-b.timeMs);
    next.romalrc=next.romanRaw=rows.map(r=>lrcAt(r.timeMs,r.text)).join('\n');
  }
  return next;
}

/**
 * 行时间校准到逐字（#196）：同一份歌词里普通行和逐字行正文一样、只是开头差几百毫秒时，
 * 把普通行（连同它的翻译、罗马音）挪到逐字行的时间。以前要求 250ms 内才认，网易云自带的逐字有一半以上的行因此被丢掉。
 * 没有逐字、或都已对齐时原样返回。
 */
export function snapLinesToWords(l:Lyric):Lyric {
  const words=timedLines(l.yrc || '');
  if(!words.length || !l.lines?.length)return l;
  const rows=[...l.lines].filter(x=>x.text.trim()).sort((a,b)=>a.timeMs-b.timeMs);
  const moved=new Map<number,number>(),target=new Map<LyricLine,number>();
  for(const [row,w] of pairRowsToWords(rows,words)){
    if(Math.abs(w.timeMs-row.timeMs)<=0)continue;
    target.set(row,w.timeMs);moved.set(row.timeMs,w.timeMs);
  }
  if(!target.size)return l;
  return rebuildTimed(l,l.lines.map(x=>target.has(x)?{...x,timeMs:target.get(x)!}:x),moved);
}

/**
 * 跨源逐行补逐字（#196，取代整首八成才采用的 retimeByText）：本平台缺逐字的行，只要对方同一行正文相同、时间差 ≤1.2 秒、
 * 顺序一致，就挂上对方这一行的逐字，并把这一行的时间改用对方的（逐字更准）；对不上的行保持原样。
 * 保险：至少配上 3 行，且配上的行时间差中位数 ≤0.6 秒（排除系统性漂移）；调用方只拿同一录音来补。
 * 对方有、本行没有的翻译 / 罗马音也随配上的行一起补。没有任何增益返回 null。
 */
export function mergeWordsByLine(base:Lyric,other:Lyric):{lyric:Lyric;pairs:number;added:number}|null {
  const otherWords=timedLines(other.yrc || '');
  const rows=textRows(base).sort((a,b)=>a.timeMs-b.timeMs);
  if(!otherWords.length || rows.length<3)return null;
  const pairs=pairRowsToWords(rows,otherWords);
  if(pairs.length<3)return null;
  const deltas=pairs.map(([r,w])=>Math.abs(w.timeMs-r.timeMs)).sort((a,b)=>a-b);
  if(deltas[Math.floor(deltas.length/2)]!>600)return null;
  const own=timedLines(base.yrc || '');
  const hasOwn=(r:LyricLine)=>own.some(w=>Math.abs(w.timeMs-r.timeMs)<=250 && identityText(w.text)===identityText(r.text));
  const otherRows=textRows(other),otherRoman=parseLrc(other.romalrc || other.romanRaw || ''),baseRoman=parseLrc(base.romalrc || base.romanRaw || '');
  const target=new Map<LyricLine,{timeMs:number;translation?:string}>(),moved=new Map<number,number>(),addWords:TimedLine[]=[],addRoman:LyricLine[]=[];
  for(const [row,w] of pairs){
    const needWords=!hasOwn(row);
    const twin=otherRows.find(o=>Math.abs(o.timeMs-w.timeMs)<=250 && identityText(o.text)===identityText(row.text));
    const needTrans=!row.translation?.trim() && !!twin?.translation?.trim();
    const romanHere=!baseRoman.some(r=>Math.abs(r.timeMs-row.timeMs)<=300) ? otherRoman.find(r=>Math.abs(r.timeMs-(twin?.timeMs ?? w.timeMs))<=300) : undefined;
    if(!needWords && !needTrans && !romanHere)continue;
    const timeMs=needWords?w.timeMs:row.timeMs;
    target.set(row,{timeMs,translation:needTrans?twin!.translation:undefined});
    if(timeMs!==row.timeMs)moved.set(row.timeMs,timeMs);
    if(needWords)addWords.push(w);
    if(romanHere)addRoman.push({timeMs,text:romanHere.text});
  }
  if(!target.size)return null;
  const lines=base.lines.map(x=>{const t=target.get(x);return t?{...x,timeMs:t.timeMs,...(t.translation?{translation:t.translation}:{})}:x;});
  let next=rebuildTimed(base,lines,moved);
  if(addWords.length)next.yrc=toYrc([...timedLines(base.yrc || ''),...addWords].sort((a,b)=>a.timeMs-b.timeMs));
  if(addRoman.length){
    const merged=[...parseLrc(next.romalrc || next.romanRaw || ''),...addRoman].sort((a,b)=>a.timeMs-b.timeMs);
    next={...next,romalrc:merged.map(r=>lrcAt(r.timeMs,r.text)).join('\n'),romanRaw:merged.map(r=>lrcAt(r.timeMs,r.text)).join('\n')};
  }
  return {lyric:next,pairs:pairs.length,added:addWords.length};
}

export function enrichAligned(base:Lyric,other0:Lyric):Lyric {
  // 补丁自己的普通行和逐字行也可能差几百毫秒：先校准，否则固定偏移那条路同样会被 250ms 规则卡掉（正式流程里取回时已校准，这里兜底）
  const other=snapLinesToWords(other0);
  const alignment=alignTimelines(base,other);
  if(!alignment){
    // 固定偏移对不上：逐行补（#196）。只有确实补上了逐字 / 翻译 / 罗马音才采用。
    const merged=mergeWordsByLine(base,other);
    if(!merged)return base;
    const before=lyricCoverage(base),after=lyricCoverage(merged.lyric);
    const gainedRoman=!(base.romalrc || base.romanRaw) && !!(merged.lyric.romalrc || merged.lyric.romanRaw);
    if(after.wordLines<=before.wordLines && after.translatedLines<=before.translatedLines && !gainedRoman)return base;
    return {...merged.lyric,provenance:[...(base.provenance || []),{platform:other.identity?.platform || other.source || 'unknown',sourceId:other.identity?.sourceId || '',kind:'enrichment',anchors:merged.pairs}]};
  }
  const offset=alignment.offsetMs,lines=base.lines.map(l=>({...l}));
  const translations=parseLrc(other.translationRaw || other.tlyric || '');
  for(const t of translations){
    const row=lines.filter(l=>l.text && Math.abs(l.timeMs-t.timeMs-offset)<=250).sort((a,b)=>Math.abs(a.timeMs-t.timeMs-offset)-Math.abs(b.timeMs-t.timeMs-offset))[0];
    if(row && !row.translation?.trim())row.translation=t.text;
  }
  let next:Lyric={...base,lines};
  const shifted=toYrc(timedLines(other.yrc || ''),offset);
  if(lyricCoverage({...next,yrc:shifted}).wordLines>lyricCoverage(next).wordLines)next.yrc=shifted;
  else if(shifted){
    // 整份换成对方逐字没有更多（本平台已有一部分逐字）：按固定偏移挪好对方，再逐行补本平台缺的那些行（#196）
    const moved={...other,lines:other.lines.map(l=>({...l,timeMs:l.timeMs+offset})),yrc:shifted,romalrc:undefined,romanRaw:undefined};
    const byLine=mergeWordsByLine(next,moved);
    if(byLine && lyricCoverage(byLine.lyric).wordLines>lyricCoverage(next).wordLines)next=byLine.lyric;
  }
  const cov=lyricCoverage(next),previous=lyricCoverage(base);
  if(cov.wordLines===previous.wordLines && cov.translatedLines===previous.translatedLines && (base.romanRaw || !other.romanRaw))return base;
  next.tlyric=next.translationRaw=next.lines.filter(l=>l.text && l.translation).map(l=>lrcAt(l.timeMs,l.translation!)).join('\n');
  if(!next.romanRaw && other.romanRaw)next.romanRaw=next.romalrc=parseLrc(other.romanRaw).filter(l=>l.timeMs+offset>=0).map(l=>lrcAt(l.timeMs+offset,l.text)).join('\n');
  next.provenance=[...(base.provenance || []),{platform:other.identity?.platform || other.source || 'unknown',sourceId:other.identity?.sourceId || '',kind:'enrichment',...alignment}];
  return next;
}
