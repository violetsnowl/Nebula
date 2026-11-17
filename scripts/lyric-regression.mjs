import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {deflateSync} from 'node:zlib';
import {buildSync} from 'esbuild';
import {encryptQrc} from 'qrc-decoder';
const require=createRequire(import.meta.url),b=require('../dist-main/index.cjs');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'nebula-lyrics-test-'));
buildSync({entryPoints:['src/lib/lyrics.ts'],bundle:true,platform:'node',format:'cjs',outfile:path.join(temp,'lyrics.cjs')});
const ui=require(path.join(temp,'lyrics.cjs'));
let count=0;const test=async(name,fn)=>{await fn();count++;console.log('通过 '+name)};
try{
await test('混合 JSON 与普通 LRC 不丢正文',()=>{const s=b.normalizeJsonLrc('{"t":0,"c":[{"tx":"制作信息"}]}\n[00:10.000]测试正文');assert.equal(b.parseLrc(s).length,2)});
await test('同源 QRC 毫秒与翻译 10ms 截断能正确合并',()=>{const r=b.mergeLyric('[00:28.164]原文','[00:28.160]译文');assert.equal(r.length,1);assert.equal(r[0].translation,'译文')});
await test('QRC 真实协议解码及绝对逐字时间',()=>{
 const raw='<LyricInfo LyricContent="[1000,800]测(1000,300)试(1300,500)"/>';
 const l=b.fromTimed(b.decodeQqLyric(encryptQrc(raw)),'qrc');assert.equal(l.lines[0].text,'测试');assert.equal(b.timedLines(l.yrc)[0].words[1].startMs,1300);
 assert.equal(b.decodeQqLyric(1),'');assert.equal(b.decodeQqLyric('not-a-lyric'),'');
});
await test('KRC 解码、相对时间和内嵌翻译',()=>{
 const language=Buffer.from(JSON.stringify({content:[{type:1,lyricContent:[['test']]}]})).toString('base64');
 const raw=`[language:${language}]\n[1000,800]<0,300,0>测<300,500,0>试`;
 const key=Buffer.from([64,71,97,119,94,50,116,71,81,54,49,45,206,210,110,105]),z=deflateSync(raw);z.forEach((v,i)=>z[i]=v^key[i%16]);
 const encoded=Buffer.concat([Buffer.from('krc1'),z]).toString('base64'),l=b.fromTimed(b.decodeKrc(encoded),'krc');
 assert.equal(b.timedLines(l.yrc)[0].words[1].startMs,1300);assert.equal(l.lines[0].translation,'test');assert.equal(b.decodeKrc('bad'),'');
});
const base={raw:'',lines:[1000,10000,20000,30000].map((timeMs,i)=>({timeMs,text:'测试行'+i}))};
const other={raw:'',lines:base.lines.map(l=>({...l,timeMs:l.timeMs+400})),translationRaw:base.lines.map(l=>b.lrcAt(l.timeMs+400,'译文')).join('\n'),yrc:base.lines.map(l=>`[${l.timeMs+400},1000](${l.timeMs+400},1000,0)${l.text}`).join('\n'),identity:{platform:'kugou',sourceId:'x'}};
await test('跨源稳定偏移按正文锚点对齐，补齐单句翻译',()=>{
 const enriched=b.enrichAligned({...base,lines:base.lines.map((l,i)=>({...l,translation:i===0?'已有':undefined}))},other);
 assert.equal(enriched.provenance[0].offsetMs,-400);assert.equal(b.lyricCoverage(enriched).translatedLines,4);assert.equal(b.lyricCoverage(enriched).wordLines,4);
});
await test('时间漂移或正文不同拒绝跨源补全',()=>{
 assert.equal(b.alignTimelines(base,{...other,lines:other.lines.map((l,i)=>({...l,timeMs:l.timeMs+i*1000}))}),null);
 assert.equal(b.enrichAligned(base,{...other,lines:other.lines.map(l=>({...l,text:'不同歌词'}))}),base);
});
await test('普通整句与无词时间的 JSON 不伪造逐字',()=>{assert.equal(ui.parseYrcText('[00:10.00]普通歌词').length,0);assert.equal(ui.parseYrcText('{"t":10,"c":[{"tx":"正文"}]}').length,0)});
await test('英文空格补齐保持原始长音时长',()=>{
 const lines=[{timeMs:1000,text:'Hello world',words:[{text:'Hello',startMs:1000,duration:100},{text:'world',startMs:1100,duration:1900}]}];
 const result=ui.alignWordsToText(lines);assert.equal(result[0].words[0].duration,100);assert.equal(result[0].words[1].duration,1900);assert.equal(result[0].words[0].space,true);
});
await test('相近时间但不同正文不能挂接逐字',()=>{const r=ui.mergeWordLyrics([{timeMs:1000,text:'甲'}],'[1000,1000](1000,1000,0)乙');assert.equal(r[0].words,undefined)});
await test('只有逐字时仍能显示原始正文',()=>{const r=ui.mergeWordLyrics([],'[1000,1000](1000,1000,0)甲');assert.equal(r[0].text,'甲')});
await test('旧版/损坏缓存失效，v2 不完整六小时与完整三十天',async()=>{
 fs.writeFileSync(path.join(temp,'lyric-cache.json'),JSON.stringify({'qq:x':{at:Date.now(),lyric:base}}));assert.equal(new b.LyricCache(temp).get('qq','x'),null);
 const cache=new b.LyricCache(temp);cache.set('qq','x',{...base,incomplete:true});cache.set('qq','full',{...base,incomplete:false});await cache.flush();
 const fresh=new b.LyricCache(temp);assert.ok(fresh.get('qq','x'));const now=Date.now;Date.now=()=>now()+7*3600000;
 try{assert.equal(fresh.get('qq','x'),null);assert.ok(fresh.get('qq','full'));}finally{Date.now=now;await fresh.flush();}
});
await test('切歌取消歌词底层请求，迟到数据不入缓存',async()=>{
 let signal;const a={qq:{fetchLyric:async()=>{signal=b.requestScope().signal;await new Promise(r=>setTimeout(r,20));return base}},netease:{},kugou:{}};
 const service=new b.LyricService(a),c=new AbortController(),p=service.fetchLyric({platform:'qq',sourceId:'x'},c.signal);
 await new Promise(r=>setTimeout(r,2));c.abort();assert.equal(await p,null);assert.equal(signal.aborted,true);
});
await test('网易云一条歌词接口挂起不丢另一条已取得的正文和翻译',async()=>{
 const a=new b.NeteaseAdapter({}, {getHeader:()=>''},async name=>name==='lyric_new'?new Promise(()=>{}):{status:200,body:{lrc:{lyric:'[00:01.000]正文一\n[00:02.000]正文二'},tlyric:{lyric:'[00:01.000]译文一\n[00:02.000]译文二'}}});
 const l=await b.withRequestScope(3200,()=>a.fetchLyric('synthetic'));assert.equal(l.lines.length,2);assert.equal(l.lines[1].translation,'译文二');
});
console.log(`歌词回归 ${count}/${count}`);
}finally{fs.rmSync(temp,{recursive:true,force:true})}
