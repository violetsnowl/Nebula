import { decryptQrc } from 'qrc-decoder';
import { inflateSync } from 'node:zlib';
import type { Lyric, LyricLine } from '../types';
import { parseLrc, mergeLyric } from './lyricParser';

export const lrcAt=(ms:number,text:string):string=>`[${String(Math.floor(ms/60000)).padStart(2,'0')}:${((ms%60000)/1000).toFixed(3).padStart(6,'0')}]${text}`;
const xmlText=(s:string):string=>s.replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(+n)).replace(/&#x([\da-f]+);/gi,(_,n)=>String.fromCodePoint(parseInt(n,16))).replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');

/** QQ 传输格式：明文、base64 LRC，或十六进制非标准 DES/zlib QRC。 */
export function decodeQqLyric(input:unknown):string {
  if(typeof input!=='string' || !input || input.length>4*1024*1024)return '';
  if(/\[\d+[: ,]|LyricContent/.test(input))return xmlText(input);
  try {
    if(/^[\da-f]+$/i.test(input) && input.length%16===0){
      if(input.length>256*1024)return '';
      const decoded=decryptQrc(input);
      return decoded.length<=4*1024*1024?decoded:'';
    }
    const decoded=Buffer.from(input,'base64').toString('utf8');
    return /\[\d+[: ,]|LyricContent/.test(decoded)?decoded:'';
  }catch{return '';}
}
/** KRC 公开文件协议：krc1 + 16 字节循环 XOR + zlib，限制解压大小。 */
export function decodeKrc(input:string):string {
  if(input.length>4*1024*1024)return '';
  try {
    const bytes=Buffer.from(input,'base64');
    if(bytes.subarray(0,4).toString()!=='krc1')return /^\[\d+,\d+\]/m.test(input)?input:'';
    const key=Buffer.from([64,71,97,119,94,50,116,71,81,54,49,45,206,210,110,105]);
    const body=Buffer.from(bytes.subarray(4));body.forEach((v,i)=>{body[i]=v^key[i%16]!});
    return inflateSync(body,{maxOutputLength:4*1024*1024}).toString('utf8');
  }catch{return '';}
}
export interface TimedLine { timeMs:number; duration:number; text:string; words:Array<{text:string;startMs:number;duration:number}> }
export function timedLines(raw:string,format:'yrc'|'qrc'|'krc'='yrc'):TimedLine[] {
  const attr=raw.match(/LyricContent="([^"]*)"/);
  const text=xmlText(attr?.[1] ?? raw);
  const out:TimedLine[]=[];
  for(const line of text.split(/\r?\n/)){
    const m=line.match(/^\s*\[(\d+),(\d+)\](.*)$/);if(!m)continue;
    const timeMs=+m[1]!,duration=+m[2]!,words:TimedLine['words']=[];
    const pattern=format==='krc'?/<(\d+),(\d+),\d+>([^<]*)/g:format==='qrc'?/([^()]+)\((\d+),(\d+)\)/g:/\((\d+),(\d+)(?:,\d+)?\)([^()]*)/g;
    for(const part of m[3]!.matchAll(pattern)){
      const word=format==='qrc'?part[1]!:part[3]!;
      const startMs=(format==='qrc'?+part[2]!: +part[1]!)+(format==='krc'?timeMs:0),span=format==='qrc'?+part[3]!: +part[2]!;
      if(word.trim() && span>0 && startMs>=timeMs-100 && startMs+span<=timeMs+duration+300)words.push({text:word,startMs,duration:span});
    }
    if(words.length)out.push({timeMs,duration,words,text:words.map(w=>w.text).join('').trim()});
  }
  return out.sort((a,b)=>a.timeMs-b.timeMs);
}
export function toYrc(rows:TimedLine[],offset=0):string {
  return rows.filter(l=>l.timeMs+offset>=0).map(l=>`[${Math.round(l.timeMs+offset)},${l.duration}]`+l.words.map(w=>`(${Math.round(w.startMs+offset)},${w.duration},0)${w.text}`).join('')).join('\n');
}
export function fromTimed(raw:string,format:'qrc'|'krc',translation='',roman=''):Lyric|null {
  const rows=timedLines(raw,format);if(!rows.length)return null;
  const textLines=(raw:string):LyricLine[]=>{
    const regular=parseLrc(raw);if(regular.length)return regular;
    return timedLines(raw,'qrc').map(({timeMs,text})=>({timeMs,text}));
  };
  let trans=textLines(translation),roma=textLines(roman);
  if(format==='krc'){
    const language=raw.match(/\[language:([^\]]+)\]/)?.[1];
    if(language)try{
      const entries=JSON.parse(Buffer.from(language,'base64').toString()).content;
      if(Array.isArray(entries))for(const item of entries){
        if(!Array.isArray(item.lyricContent) || item.lyricContent.length!==rows.length)continue;
        const lines:LyricLine[]=item.lyricContent.map((x:unknown,i:number)=>({timeMs:rows[i]!.timeMs,text:Array.isArray(x)?x.filter(v=>typeof v==='string').join(''):''}));
        if(item.type===1)trans=lines;if(item.type===0)roma=lines;
      }
    }catch{/* 无效语言标签不影响原始逐字 */}
  }
  const lrc=rows.map(l=>lrcAt(l.timeMs,l.text)).join('\n');
  const tlyric=trans.map(l=>lrcAt(l.timeMs,l.text)).join('\n'),romalrc=roma.map(l=>lrcAt(l.timeMs,l.text)).join('\n');
  return {raw:lrc,lrc,lines:mergeLyric(lrc,tlyric),yrc:toYrc(rows),qrc:format==='qrc'?raw:undefined,krc:format==='krc'?raw:undefined,translationRaw:tlyric,tlyric,romanRaw:romalrc,romalrc,source:format==='krc'?'kugou':'qq'};
}
