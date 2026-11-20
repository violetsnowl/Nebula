import type {Lyric,LyricLine} from '../types';
import {parseLrc} from '../parsers/lyricParser';
import {lrcAt,timedLines,toYrc,type TimedLine} from '../parsers/timedLyrics';
import {identityText} from './recordingMatch';
// 正文行：去掉「短标签 + 冒号」的署名行（作词: / 制作人: / 音乐设计/监制: / Lyrics by： …），两平台写法各异，不算正文。
const creditRow=(text:string):boolean=>/^[^:：]{1,24}[:：]/.test(text.trim());
const textRows=(l:Lyric):LyricLine[]=>l.lines.filter(x=>x.text.trim() && !creditRow(x.text));
/** 罗马音行挂到正文行的时间窗，和前端 attachRoman 一致（300ms）。 */
const ROMAN_WINDOW_MS=300;
const romanRows=(l:Lyric):LyricLine[]=>parseLrc(l.romalrc || l.romanRaw || '').filter(r=>r.text.trim());
/** bgLines = 有和声的正文行数，agentLines = 标了对唱归属的正文行数（#199）。 */
export function lyricCoverage(l:Lyric):{wordLines:number;textLines:number;translatedLines:number;romanLines:number;bgLines:number;agentLines:number} {
  const rows=textRows(l),words=timedLines(l.yrc || ''),roman=romanRows(l);
  return {textLines:rows.length,translatedLines:rows.filter(x=>x.translation?.trim()).length,
    wordLines:rows.filter(x=>words.some(w=>Math.abs(w.timeMs-x.timeMs)<=250 && identityText(w.text)===identityText(x.text))).length,
    romanLines:rows.filter(x=>roman.some(r=>Math.abs(r.timeMs-x.timeMs)<=ROMAN_WINDOW_MS)).length,
    bgLines:rows.filter(x=>x.bg?.text?.trim()).length,agentLines:rows.filter(x=>!!x.agent).length};
}

const KANA=/[぀-ヿ]/,HANGUL=/[가-힯ᄀ-ᇿ㄰-㆏]/,HAN=/[㐀-鿿豈-﫿]/;
/**
 * 歌词语种（和前端 detectScript 同一套规则：假名占汉字一成以上算日语，谚文占多数算韩语，有汉字算中文，否则按拉丁）。
 * 只看正文行，署名行不算。
 */
export function lyricScript(l:Lyric):'zh'|'ja'|'ko'|'en' {
  let kana=0,hangul=0,han=0,latin=0;
  for(const row of textRows(l)){
    for(const ch of row.text){if(KANA.test(ch))kana++;else if(HANGUL.test(ch))hangul++;else if(HAN.test(ch))han++;}
    latin+=(row.text.match(/[A-Za-z]+/g) ?? []).length;
  }
  const cjk=kana+hangul+han;
  if(!cjk || latin>cjk)return 'en';
  if(hangul>0 && hangul>=kana && hangul>=han)return 'ko';
  if(kana>0 && kana>=han*.1)return 'ja';
  return han>0?'zh':'en';
}

/**
 * 这份歌词够不够好、还要不要去别家补（#197）：逐字 ≥80%；不是中文的要翻译 ≥80%（中文歌本来没有翻译，以前也按缺翻译处理，每首都白搜一遍）；
 * 日语歌还要罗马音 ≥80%（以前逐字、翻译齐了就不再找罗马音）。韩语罗马音本地生成，不要求。
 */
/**
 * 歌词被截断（#201，真实案例：QQ 一首 174 秒的歌只有前 39 秒的 9 句原文，后面几十行只剩翻译、原文是空的）：
 * 最后一句原文在歌曲时长六成以前就结束（歌长 1 分钟以上才判），或「只有翻译、原文是空的」行比原文行还多。
 * 截断的歌词逐字、翻译再齐也不算够好。durationSec 未知时只看第二条。
 */
export function lyricTruncated(l:Lyric,durationSec?:number):boolean {
  const rows=textRows(l);
  if(!rows.length)return false;
  const orphan=l.lines.filter(x=>!x.text.trim() && x.translation?.trim()).length;
  if(orphan>rows.length)return true;
  const d=Number(durationSec)||0;
  return d>=60 && Math.max(...rows.map(x=>x.timeMs))<d*1000*.6;
}

export function lyricComplete(l:Lyric):boolean {
  const c=lyricCoverage(l);if(!c.textLines)return false;
  const script=lyricScript(l);
  if(c.wordLines/c.textLines<.8)return false;
  if(script!=='zh' && c.translatedLines/c.textLines<.8)return false;
  if(script==='ja'){
    // 只算要注音的行（含假名 / 汉字）：日语歌里夹的英文句本来就没有罗马音，按全部行算会把这类歌永远判成不够好
    const roman=romanRows(l),need=textRows(l).filter(x=>KANA.test(x.text) || HAN.test(x.text));
    if(need.length && need.filter(x=>roman.some(r=>Math.abs(r.timeMs-x.timeMs)<=ROMAN_WINDOW_MS)).length/need.length<.8)return false;
  }
  return true;
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
/** 一句里没配对的左括号数（全角、半角分开数）。 */
const unclosed=(t:string,open:string,close:string):number=>Math.max(0,t.split(open).length-t.split(close).length);
/**
 * 补上只有左括号的句子（#202，真实案例：QQ《小半 (Live)》的和声写成单独一行「（……」，普通歌词和逐字里都没有右括号）。
 * 只处理以左括号开头、全句没有对应右括号的行：句尾补上同款右括号；同一时间、正文相同的逐字行，最后一个字后面也补上。其余原样返回。
 */
export function closeBrackets(l:Lyric):Lyric {
  const fix=(t:string):string=>{
    const s=t.trim();
    if(s.startsWith('（') && unclosed(s,'（','）'))return t.replace(/\s*$/,'）'.repeat(unclosed(s,'（','）')));
    if(s.startsWith('(') && unclosed(s,'(',')'))return t.replace(/\s*$/,')'.repeat(unclosed(s,'(',')')));
    return t;
  };
  const changed=new Map<number,string>();
  const lines=l.lines.map(x=>{const t=fix(x.text);if(t===x.text)return x;changed.set(x.timeMs,identityText(x.text));return {...x,text:t};});
  if(!changed.size)return l;
  const next:Lyric={...l,lines,lrc:lines.map(x=>lrcAt(x.timeMs,x.text)).join(String.fromCharCode(10))};
  const words=timedLines(l.yrc || '');
  if(words.length){
    let touched=false;
    const rows=words.map(w=>{
      const hit=[...changed].some(([t,key])=>Math.abs(t-w.timeMs)<=250 && key===identityText(w.text));
      const joined=w.words.map(x=>x.text).join('');
      if(!hit || !w.words.length || fix(joined)===joined)return w;
      touched=true;
      const last=w.words[w.words.length-1]!,tail=fix(joined).slice(joined.trimEnd().length);
      return {...w,text:fix(w.text),words:[...w.words.slice(0,-1),{...last,text:last.text.trimEnd()+tail}]};
    });
    if(touched)next.yrc=toYrc(rows);
  }
  return next;
}

/** 逐行配对的时间窗：同一首歌两份歌词（普通行 / 逐字行）开头常差几百毫秒，实测九成在 1.1 秒内（#196）。 */
export const PAIR_WINDOW_MS=1200;

/**
 * 普通歌词行 ↔ 逐字行逐行配对：正文相同（identityText）、时间差 ≤ windowMs、顺序一致（配上一对后只往后找）。
 * rows / words 都要按时间排好。返回配上的对。
 */
export function pairRowsToWords<T extends {timeMs:number;text:string}=TimedLine>(rows:LyricLine[],words:T[],windowMs=PAIR_WINDOW_MS):Array<[LyricLine,T]> {
  const out:Array<[LyricLine,T]>=[];
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

const LATIN_END=/[A-Za-z0-9'’]$/,LATIN_START=/^[A-Za-z0-9]/;
/** 两行逐字拼成一行（对方把本平台一句拆成了两行）；英文词之间补空格。 */
function joinTimed(a:TimedLine,b:TimedLine):TimedLine {
  const aw=a.words.map(w=>({...w})),bw=b.words.map(w=>({...w}));
  const last=aw[aw.length-1],first=bw[0];
  if(last && first && LATIN_END.test(last.text) && LATIN_START.test(first.text))last.text+=' ';
  const words=[...aw,...bw];
  return {timeMs:a.timeMs,duration:Math.max(1,b.timeMs+b.duration-a.timeMs),text:words.map(w=>w.text).join(''),words};
}
/** 对方一行里连续几个字拼起来正好是 key（归一化后相同）：取这几个字组成一行，否则 null。 */
function segmentTimed(w:TimedLine,key:string):TimedLine|null {
  const ws=w.words;
  for(let a=0;a<ws.length;a++){
    let acc='';
    for(let b=a;b<ws.length;b++){
      acc+=ws[b]!.text;
      const id=identityText(acc);
      if(!key.startsWith(id))break;
      if(id===key){
        if(a===0 && b===ws.length-1)return null; // 整行相同的情况前面已经处理
        const seg=ws.slice(a,b+1),last=seg[seg.length-1]!;
        return {timeMs:seg[0]!.startMs,duration:Math.max(1,last.startMs+last.duration-seg[0]!.startMs),text:seg.map(x=>x.text).join('').trim(),words:seg};
      }
    }
  }
  return null;
}
/** 对方一行按字拆成两行（本平台把它拆成了两句）：前一段的字拼起来正好是 first 才拆，否则 null。 */
function splitTimed(w:TimedLine,first:string):[TimedLine,TimedLine]|null {
  const key=identityText(first);
  let acc='';
  for(let k=0;k<w.words.length-1;k++){
    acc+=w.words[k]!.text;
    const id=identityText(acc);
    if(id.length>key.length)return null;
    if(id!==key)continue;
    const a=w.words.slice(0,k+1),b=w.words.slice(k+1);
    const mk=(ws:TimedLine['words']):TimedLine=>({timeMs:ws[0]!.startMs,duration:Math.max(1,ws[ws.length-1]!.startMs+ws[ws.length-1]!.duration-ws[0]!.startMs),text:ws.map(x=>x.text).join('').trim(),words:ws});
    return [mk(a),mk(b)];
  }
  return null;
}
/**
 * 逐行配对之后，配不上的行再试三种（#214，只用来补逐字）。网易云 300 首里逐字不到八成的 74 首逐行诊断：
 * 缺逐字的行里，对方把一句拆成两行的 412 行、本平台拆成两句的 157 行、正文相同但时间差超过 1.2 秒的 203 行。
 * - 对方拆成两行：本行正文 = 对方相邻两行拼起来 → 两行逐字合成一行；
 * - 本平台拆成两句：对方一行 = 本平台相邻两句拼起来 → 按字把对方那行拆开；
 * - 时间差大：正文相同，且和前后已配上的行的时间差（局部偏移）相差 ≤400ms（最远 8 秒）。
 * 新配上的对方行，时间必须落在前后已配上那两行的对方时间之间（顺序一致），用过的对方行不再用。
 */
function extraPairs(rows:LyricLine[],words:TimedLine[],pairs:Array<[LyricLine,TimedLine]>):Array<[LyricLine,TimedLine]> {
  const used=new Set<TimedLine>(pairs.map(p=>p[1])),done=new Set<LyricLine>(pairs.map(p=>p[0]));
  const anchors=[...pairs].sort((a,b)=>a[0].timeMs-b[0].timeMs);
  const around=(t:number)=>{
    let prev:[LyricLine,TimedLine]|undefined,next:[LyricLine,TimedLine]|undefined;
    for(const p of anchors){if(p[0].timeMs<t)prev=p;else if(p[0].timeMs>t){next=p;break;}}
    return {prev,next};
  };
  const out:Array<[LyricLine,TimedLine]>=[];
  for(let k=0;k<rows.length;k++){
    const row=rows[k]!;
    if(done.has(row))continue;
    const key=identityText(row.text);if(key.length<2)continue;
    const {prev,next}=around(row.timeMs);
    const ds=[prev,next].filter((p):p is [LyricLine,TimedLine]=>!!p).map(p=>p[1].timeMs-p[0].timeMs);
    if(!ds.length)continue;
    const expected=row.timeMs+ds.reduce((a,b)=>a+b,0)/ds.length;
    const lo=prev?prev[1].timeMs:-Infinity,hi=next?next[1].timeMs:Infinity;
    const inOrder=(w:TimedLine)=>!used.has(w) && w.timeMs>lo && w.timeMs<hi;
    // 时间差大：正文相同、合局部偏移
    const far=words.find(w=>inOrder(w) && identityText(w.text)===key && Math.abs(w.timeMs-expected)<=400 && Math.abs(w.timeMs-row.timeMs)<=8000);
    if(far){out.push([row,far]);used.add(far);done.add(row);continue;}
    // 连着好几行没配上时局部偏移估不准：前后两个已配上的行之间、对方正文相同的只有这一行，就是它（时间差最多 3 秒）
    const same=words.filter(w=>inOrder(w) && identityText(w.text)===key);
    if(same.length===1 && Math.abs(same[0]!.timeMs-row.timeMs)<=3000 && rows.filter(r=>!done.has(r) && r.timeMs>(prev?prev[0].timeMs:-Infinity) && r.timeMs<(next?next[0].timeMs:Infinity) && identityText(r.text)===key).length===1){
      out.push([row,same[0]!]);used.add(same[0]!);done.add(row);continue;
    }
    // 对方拆成两行
    const j=words.findIndex((w,q)=>q+1<words.length && inOrder(w) && inOrder(words[q+1]!) && Math.abs(w.timeMs-expected)<=600 && identityText(w.text+words[q+1]!.text)===key);
    if(j>=0){out.push([row,joinTimed(words[j]!,words[j+1]!)]);used.add(words[j]!);used.add(words[j+1]!);done.add(row);continue;}
    // 对方一行里有一段正好是本行（对方把两句写成一行、或多了词）：取那一段字的逐字（时间就是那几个字自己的）
    for(const w of words){
      if(w.timeMs>expected+600 || w.timeMs+w.duration<expected-600 || w.timeMs<=lo-(w.duration||0) || w.timeMs>=hi)continue;
      const seg=segmentTimed(w,key);
      if(seg && seg.timeMs>lo && seg.timeMs<hi && Math.abs(seg.timeMs-expected)<=600){out.push([row,seg]);done.add(row);break;}
    }
    if(done.has(row))continue;
    // 本平台拆成两句
    const row2=rows[k+1];
    if(row2 && !done.has(row2)){
      const both=identityText(row.text+row2.text);
      const w=words.find(x=>inOrder(x) && Math.abs(x.timeMs-expected)<=600 && identityText(x.text)===both);
      const parts=w?splitTimed(w,row.text):null;
      if(w && parts && identityText(parts[1].text)===identityText(row2.text)){out.push([row,parts[0]],[row2,parts[1]]);used.add(w);done.add(row);done.add(row2);k++;}
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
  const direct=pairRowsToWords(rows,otherWords);
  if(direct.length<3)return null;
  const deltas=direct.map(([r,w])=>Math.abs(w.timeMs-r.timeMs)).sort((a,b)=>a-b);
  if(deltas[Math.floor(deltas.length/2)]!>600)return null;
  // 直接配上的之外，再按「对方拆两行 / 本平台拆两句 / 局部偏移大」补配（#214）
  const pairs=[...direct,...extraPairs(rows,otherWords,direct)];
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

/** 和声的词时间是绝对毫秒：跟着配上的行从对方的时间轴平移到本平台的（行时间不同时），行时间校准不动它。 */
const shiftBg=(bg:NonNullable<LyricLine['bg']>,by:number):NonNullable<LyricLine['bg']>=>
  by && bg.words?{...bg,words:bg.words.map(w=>({...w,startMs:w.startMs+by}))}:bg;

/**
 * 逐行补翻译 / 罗马音（#197）：不要求对方有逐字。本平台的正文行和对方的正文行按 pairRowsToWords 同样的规则配对
 * （正文相同、时间差 ≤1.2 秒、顺序一致；至少 3 对、中位差 ≤0.6 秒），本行缺、对方那行有的翻译 / 罗马音挂上来，行时间不动。
 * 以前罗马音只在「本平台一行都没有」时整份照搬，缺一部分的（QQ 日语歌约两成行没有）补不上。
 * 和声（背景人声）与对唱归属（agent）也一起补（#199）：本行没有、对方这行有就挂上；agent 只在对方整首至少两种不同的归属都出现过时才补
 * （只有一种说明对方没真正区分歌手，补上去会把本来的独唱歌染成对唱）。没有增益返回 null。
 */
export function fillTextLayers(base:Lyric,other:Lyric):{lyric:Lyric;pairs:number}|null {
  const rows=textRows(base).sort((a,b)=>a.timeMs-b.timeMs),theirs=textRows(other).sort((a,b)=>a.timeMs-b.timeMs);
  if(rows.length<3 || theirs.length<3)return null;
  const pairs=pairRowsToWords(rows,theirs);
  if(pairs.length<3)return null;
  const deltas=pairs.map(([r,o])=>Math.abs(o.timeMs-r.timeMs)).sort((a,b)=>a-b);
  if(deltas[Math.floor(deltas.length/2)]!>600)return null;
  const ownRoman=romanRows(base),theirRoman=romanRows(other);
  const translation=new Map<LyricLine,string>(),addRoman:LyricLine[]=[],extra=new Map<LyricLine,Partial<LyricLine>>();
  const fillAgent=new Set(theirs.map(o=>o.agent).filter(Boolean)).size>=2;
  for(const [row,o] of pairs){
    if(!row.translation?.trim() && o.translation?.trim())translation.set(row,o.translation);
    const patch:Partial<LyricLine>={};
    if(!row.bg?.text?.trim() && o.bg?.text?.trim())patch.bg=shiftBg(o.bg,row.timeMs-o.timeMs);
    if(!row.agent && fillAgent && o.agent)patch.agent=o.agent;
    if(patch.bg || patch.agent)extra.set(row,patch);
    if(ownRoman.some(r=>Math.abs(r.timeMs-row.timeMs)<=ROMAN_WINDOW_MS))continue;
    const roman=theirRoman.filter(r=>Math.abs(r.timeMs-o.timeMs)<=ROMAN_WINDOW_MS).sort((a,b)=>Math.abs(a.timeMs-o.timeMs)-Math.abs(b.timeMs-o.timeMs))[0];
    if(roman)addRoman.push({timeMs:row.timeMs,text:roman.text});
  }
  if(!translation.size && !addRoman.length && !extra.size)return null;
  const next:Lyric={...base,lines:base.lines.map(x=>translation.has(x) || extra.has(x)?{...x,...(translation.has(x)?{translation:translation.get(x)}:{}),...extra.get(x)}:x)};
  if(translation.size)next.tlyric=next.translationRaw=next.lines.filter(x=>x.text && x.translation).map(x=>lrcAt(x.timeMs,x.translation!)).join('\n');
  if(addRoman.length){
    const merged=[...ownRoman,...addRoman].sort((a,b)=>a.timeMs-b.timeMs).map(r=>lrcAt(r.timeMs,r.text)).join('\n');
    next.romalrc=next.romanRaw=merged;
  }
  return {lyric:next,pairs:pairs.length};
}

export function enrichAligned(base:Lyric,other0:Lyric):Lyric {
  // 补丁自己的普通行和逐字行也可能差几百毫秒：先校准，否则固定偏移那条路同样会被 250ms 规则卡掉（正式流程里取回时已校准，这里兜底）
  const other=snapLinesToWords(other0);
  const before=lyricCoverage(base);
  // 补上了逐字 / 翻译 / 罗马音 / 和声 / 对唱归属其中任何一样才算有增益
  // gain 记在 provenance 里，界面据此写「X 补了逐字 / 翻译 …」
  const gainOf=(l:Lyric)=>{const c=lyricCoverage(l),g:NonNullable<NonNullable<Lyric['provenance']>[number]['gain']>=[];if(c.wordLines>before.wordLines)g.push('words');if(c.translatedLines>before.translatedLines)g.push('translation');if(c.romanLines>before.romanLines)g.push('roman');if(c.bgLines>before.bgLines || c.agentLines>before.agentLines)g.push('bg');return g;};
  const gained=(l:Lyric)=>gainOf(l).length>0;
  const from={platform:other.identity?.platform || other.source || 'unknown',sourceId:other.identity?.sourceId || ''};
  const alignment=alignTimelines(base,other);
  if(!alignment){
    // 固定偏移对不上：逐行补逐字（#196），再逐行补翻译 / 罗马音（#197）。
    const merged=mergeWordsByLine(base,other);
    const layers=fillTextLayers(merged?.lyric ?? base,other);
    const next=layers?.lyric ?? merged?.lyric;
    if(!next || !gained(next))return base;
    return {...next,provenance:[...(base.provenance || []),{...from,kind:'enrichment',anchors:Math.max(merged?.pairs ?? 0,layers?.pairs ?? 0),gain:gainOf(next)}]};
  }
  const offset=alignment.offsetMs,lines=base.lines.map(l=>({...l}));
  const translations=parseLrc(other.translationRaw || other.tlyric || '');
  for(const t of translations){
    const row=lines.filter(l=>l.text && Math.abs(l.timeMs-t.timeMs-offset)<=250).sort((a,b)=>Math.abs(a.timeMs-t.timeMs-offset)-Math.abs(b.timeMs-t.timeMs-offset))[0];
    if(row && !row.translation?.trim())row.translation=t.text;
  }
  let next:Lyric={...base,lines};
  const shifted=toYrc(timedLines(other.yrc || ''),offset);
  // 按固定偏移挪好的对方（罗马音一起挪），逐行补逐字、补罗马音都用它
  const shiftRoman=parseLrc(other.romalrc || other.romanRaw || '').filter(l=>l.timeMs+offset>=0).map(l=>lrcAt(l.timeMs+offset,l.text)).join('\n');
  // 和声词时间也是绝对毫秒，跟着整条时间轴一起挪
  const moved={...other,lines:other.lines.map(l=>({...l,timeMs:l.timeMs+offset,...(l.bg?{bg:shiftBg(l.bg,offset)}:{})})),yrc:shifted,romalrc:shiftRoman || undefined,romanRaw:shiftRoman || undefined};
  // 两条路都算：整份换成对方逐字，或按固定偏移挪好对方后逐行补（#196；#214 起逐行补还会配「拆成两行 / 局部偏移大」的行），
  // 哪个补上的逐字行多用哪个。以前整份换只要比现在多就直接用，逐行补能配上的拆句永远用不上。
  if(shifted){
    const wNow=lyricCoverage(next).wordLines,wWhole=lyricCoverage({...next,yrc:shifted}).wordLines;
    const byLine=mergeWordsByLine(next,{...moved,romalrc:undefined,romanRaw:undefined});
    const wLine=byLine?lyricCoverage(byLine.lyric).wordLines:-1;
    if(byLine && wLine>wWhole && wLine>wNow)next=byLine.lyric;
    else if(wWhole>wNow)next.yrc=shifted;
  }
  next.tlyric=next.translationRaw=next.lines.filter(l=>l.text && l.translation).map(l=>lrcAt(l.timeMs,l.translation!)).join('\n');
  if(!(next.romanRaw || next.romalrc) && shiftRoman)next.romanRaw=next.romalrc=shiftRoman;
  next=fillTextLayers(next,moved)?.lyric ?? next; // 本平台有一部分罗马音：缺的行逐行补（#197）；和声、对唱归属也在这里补（#199）
  if(!gained(next))return base;
  next.provenance=[...(base.provenance || []),{...from,kind:'enrichment',...alignment,gain:gainOf(next)}];
  return next;
}
