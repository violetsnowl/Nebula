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
 // 正文不同（普通行和逐字行都不同）才是真的不同歌词；#196 起逐行补以逐字行正文为准
 assert.equal(b.enrichAligned(base,{...other,lines:other.lines.map(l=>({...l,text:'不同歌词'})),yrc:other.lines.map(l=>`[${l.timeMs},1000](${l.timeMs},1000,0)不同歌词`).join('\n')}),base);
});
await test('两平台行时间各差几百毫秒且不固定：按正文逐行对齐，采用对方逐字时间轴',()=>{
 const jitter=[300,-250,420,-380];
 const sup={raw:'',lines:base.lines.map((l,i)=>({...l,timeMs:l.timeMs+jitter[i]})),yrc:base.lines.map((l,i)=>`[${l.timeMs+jitter[i]},1000](${l.timeMs+jitter[i]},1000,0)${l.text}`).join('\n'),identity:{platform:'qq',sourceId:'y'}};
 assert.equal(b.alignTimelines(base,sup),null);
 const r=b.enrichAligned(base,sup);
 assert.equal(b.lyricCoverage(r).wordLines,4);
 assert.deepEqual(r.lines.map(l=>l.timeMs),sup.lines.map(l=>l.timeMs));
 assert.equal(r.provenance.at(-1).platform,'qq');
});
await test('逐行对齐不放过系统性漂移和不同正文',()=>{
 const drift={...other,lines:other.lines.map((l,i)=>({...l,timeMs:l.timeMs+i*1000})),yrc:other.lines.map((l,i)=>`[${l.timeMs+i*1000},1000](${l.timeMs+i*1000},1000,0)${l.text}`).join('\n')};
 assert.equal(b.enrichAligned(base,drift),base);
 const wrongLines=other.lines.map((l,i)=>({...l,timeMs:l.timeMs+(i%2?300:-300),text:'不同歌词'+i}));
 const wrong={...other,lines:wrongLines,yrc:wrongLines.map(l=>`[${l.timeMs},1000](${l.timeMs},1000,0)${l.text}`).join('\n')};
 assert.equal(b.enrichAligned(base,wrong),base);
});
await test('#196 同一份歌词里普通行和逐字行开头差几百毫秒：行时间（连同翻译、罗马音）校准到逐字，覆盖率按逐字算',()=>{
 const offs=[430,-280,900,-1100];
 const l={raw:'',lines:base.lines.map((x,i)=>({...x,translation:'译'+i})),romalrc:base.lines.map((x,i)=>b.lrcAt(x.timeMs,'ro'+i)).join('\n'),
  yrc:base.lines.map((x,i)=>`[${x.timeMs+offs[i]},1000](${x.timeMs+offs[i]},1000,0)${x.text}`).join('\n')};
 assert.equal(b.lyricCoverage(l).wordLines,0,'250ms 规则下一行都配不上');
 const s=b.snapLinesToWords(l);
 assert.deepEqual(s.lines.map(x=>x.timeMs),base.lines.map((x,i)=>x.timeMs+offs[i]));
 assert.equal(b.lyricCoverage(s).wordLines,4);assert.equal(b.lyricCoverage(s).translatedLines,4);
 assert.deepEqual(b.parseLrc(s.romalrc).map(r=>r.timeMs),s.lines.map(x=>x.timeMs),'罗马音跟着行挪');
 const far={...l,yrc:base.lines.map(x=>`[${x.timeMs+1500},1000](${x.timeMs+1500},1000,0)${x.text}`).join('\n')};
 assert.equal(b.snapLinesToWords(far),far,'超过 1.2 秒不挪');
 const diff={...l,yrc:base.lines.map(x=>`[${x.timeMs+300},1000](${x.timeMs+300},1000,0)别的词`).join('\n')};
 assert.equal(b.snapLinesToWords(diff),diff,'正文不同不挪');
});
await test('#196 跨源逐行补逐字：只配上部分行也补这些行，其余保持；配上不足 3 行或中位差 >0.6 秒拒绝',()=>{
 const rows=[1000,8000,16000,24000,32000,40000].map((timeMs,i)=>({timeMs,text:'正文'+i}));
 const b0={raw:'',lines:rows};
 const ok=[0,1,2,3];// 对方只有前 4 行正文一样，后两行分句不同
 const jit=[350,-200,500,-300,0,0];// 偏移不固定：固定偏移对齐不过，走逐行补
 const sup={raw:'',lines:rows.map((r,i)=>({...r,timeMs:r.timeMs+jit[i],text:ok.includes(i)?r.text:'别的分句'+i})),identity:{platform:'qq',sourceId:'z'},
  yrc:rows.map((r,i)=>`[${r.timeMs+jit[i]},900](${r.timeMs+jit[i]},900,0)${ok.includes(i)?r.text:'别的分句'+i}`).join('\n')};
 assert.equal(b.alignTimelines(b0,sup),null);
 const r=b.enrichAligned(b0,sup);
 assert.equal(b.lyricCoverage(r).wordLines,4);
 assert.deepEqual(r.lines.map(x=>x.timeMs),[1350,7800,16500,23700,32000,40000],'配上的行用对方逐字时间，其余不动');
 assert.equal(r.provenance.at(-1).platform,'qq');
 // 固定偏移、而对方自己的普通行和逐字行又差几百毫秒：先校准对方，再按固定偏移补上
 const sup2={raw:'',lines:rows,identity:{platform:'qq',sourceId:'z'},yrc:rows.map(x=>`[${x.timeMs+350},900](${x.timeMs+350},900,0)${x.text}`).join('\n')};
 assert.equal(b.lyricCoverage(b.enrichAligned(b0,sup2)).wordLines,6);
 const two={...sup,yrc:rows.slice(0,2).map(x=>`[${x.timeMs+350},900](${x.timeMs+350},900,0)${x.text}`).join('\n')};
 assert.equal(b.enrichAligned(b0,two),b0,'只配上 2 行');
 const big=[800,-700,1000,-750,900,-850];// 偏移不固定且普遍偏大
 const slowLines=rows.map((x,i)=>({...x,timeMs:x.timeMs+big[i]}));
 const slow={...sup,lines:slowLines,yrc:slowLines.map(x=>`[${x.timeMs},900](${x.timeMs},900,0)${x.text}`).join('\n')};
 assert.equal(b.alignTimelines(b0,slow),null);
 assert.equal(b.enrichAligned(b0,slow),b0,'中位差 0.8 秒以上');
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
