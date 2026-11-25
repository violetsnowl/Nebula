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
buildSync({entryPoints:['src/lib/listen/model.ts'],bundle:true,platform:'node',format:'cjs',outfile:path.join(temp,'model.cjs')});
const model=require(path.join(temp,'model.cjs'));
buildSync({entryPoints:['src/lib/lyricVersions.ts'],bundle:true,platform:'node',format:'cjs',outfile:path.join(temp,'versions.cjs')});
const lv=require(path.join(temp,'versions.cjs'));
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
await test('#197 按语种判定够不够好：中文不要求翻译，日语要罗马音，韩语罗马音本地生成不要求，英文要翻译',()=>{
 const mk=(texts,{words=true,trans=false,roman=false}={})=>{
  const lines=texts.map((text,i)=>({timeMs:1000+i*5000,text,...(trans?{translation:'译'+i}:{})}));
  return {raw:'',lines,yrc:words?lines.map(l=>`[${l.timeMs},1000](${l.timeMs},1000,0)${l.text}`).join('\n'):undefined,romalrc:roman?lines.map(l=>b.lrcAt(l.timeMs,'roma'+l.timeMs)).join('\n'):undefined};
 };
 const zh=['编的第一句','编的第二句','编的第三句'],ja=['てすとのいち','てすとのに','かきくけこ'],ko=['테스트 하나','테스트 둘','테스트 셋'],en=['made up line one','made up line two','made up line three'];
 assert.deepEqual([zh,ja,ko,en].map(t=>b.lyricScript(mk(t))),['zh','ja','ko','en']);
 assert.equal(b.lyricComplete(mk(zh)),true,'中文：逐字齐了就够');
 assert.equal(b.lyricComplete(mk(zh,{words:false})),false);
 assert.equal(b.lyricComplete(mk(ja,{trans:true})),false,'日语缺罗马音');
 assert.equal(b.lyricComplete(mk(ja,{trans:true,roman:true})),true);
 assert.equal(b.lyricComplete(mk(ko,{trans:true})),true,'韩语罗马音本地生成');
 assert.equal(b.lyricComplete(mk(en)),false,'英文缺翻译');
 assert.equal(b.lyricComplete(mk(en,{trans:true})),true);
 assert.equal(b.lyricCoverage(mk(ja,{roman:true})).romanLines,3);
 // 日语歌夹英文句：英文句没有罗马音不算缺
 const mixed=mk([...ja,'made up english one','made up english two'],{trans:true});
 mixed.romalrc=mixed.lines.slice(0,3).map(l=>b.lrcAt(l.timeMs,'roma')).join(String.fromCharCode(10));
 assert.equal(b.lyricComplete(mixed),true,'只按含假名 / 汉字的行算');
});
await test('#197 逐行补罗马音：本平台只有一部分行有，对方没有逐字也能按正文逐行补；行时间不动；固定偏移那条路同样补',()=>{
 const rows=[1000,8000,16000,24000,32000].map((timeMs,i)=>({timeMs,text:'てすと'+'あいうえお'[i]}));
 const ownRoman=rows.slice(0,2).map(r=>b.lrcAt(r.timeMs,'own'+r.timeMs)).join('\n');
 const own={raw:'',lines:rows.map(r=>({...r,translation:'译'})),yrc:rows.map(r=>`[${r.timeMs},900](${r.timeMs},900,0)${r.text}`).join('\n'),romalrc:ownRoman,romanRaw:ownRoman};
 const jit=[350,-200,500,-300,100];// 偏移不固定：固定偏移对齐不过
 const sup={raw:'',identity:{platform:'netease',sourceId:'n'},lines:rows.map((r,i)=>({...r,timeMs:r.timeMs+jit[i]})),romalrc:rows.map((r,i)=>b.lrcAt(r.timeMs+jit[i],'sup'+i)).join('\n')};
 assert.equal(b.alignTimelines(own,sup),null);
 const r=b.enrichAligned(own,sup);
 assert.equal(b.lyricCoverage(r).romanLines,5);
 assert.deepEqual(r.lines.map(x=>x.timeMs),rows.map(x=>x.timeMs));
 assert.deepEqual(b.parseLrc(r.romalrc).map(x=>x.text),['own1000','own8000','sup2','sup3','sup4'],'本平台已有的保留，缺的用对方的');
 assert.equal(r.provenance.at(-1).platform,'netease');
 assert.equal(b.enrichAligned(own,{...sup,lines:sup.lines.map(l=>({...l,text:'べつ'+l.timeMs}))}),own,'正文不同不补');
 const late={...sup,lines:rows.map(r=>({...r,timeMs:r.timeMs+400})),romalrc:rows.map((r,i)=>b.lrcAt(r.timeMs+400,'sup'+i)).join('\n')};
 assert.ok(b.alignTimelines(own,late));
 assert.equal(b.lyricCoverage(b.enrichAligned(own,late)).romanLines,5);
});
/* ---------- #199 和声（bg）与对唱（agent）：句子全是编的 ---------- */
const bgRows=[1000,8000,16000,24000,32000].map((timeMs,i)=>({timeMs,text:'编的正文'+'甲乙丙丁戊'[i]}));
const bgOf=(timeMs,i)=>({text:'和声'+i,words:[{text:'和',startMs:timeMs+500,duration:400},{text:'声'+i,startMs:timeMs+900,duration:600}]});
const agentCycle=['v1','v2','both','v1','v2'];
await test('#199 lyricCoverage 多 bgLines / agentLines；署名行不算',()=>{
 const l={raw:'',lines:[{timeMs:0,text:'作词：编的人',bg:{text:'x'},agent:'v1'},...bgRows.map((r,i)=>({...r,...(i<2?{bg:bgOf(r.timeMs,i)}:{}),...(i<3?{agent:agentCycle[i]}:{})}))]};
 const c=b.lyricCoverage(l);assert.equal(c.bgLines,2);assert.equal(c.agentLines,3);assert.equal(c.textLines,5);
 assert.equal(b.lyricCoverage({raw:'',lines:bgRows}).bgLines,0);
});
await test('#199 逐行路：对方的和声（词时间随行平移）和 agent 补到主歌词上；本行已有的不覆盖；行时间不动',()=>{
 const jit=[350,-200,500,-300,100];// 偏移不固定：固定偏移对齐不过，走逐行补
 const own={raw:'',lines:bgRows.map((r,i)=>i===1?{...r,agent:'both',bg:{text:'自己的和声'}}:{...r})};
 const sup={raw:'',identity:{platform:'amll',sourceId:'a'},lines:bgRows.map((r,i)=>({...r,timeMs:r.timeMs+jit[i],agent:agentCycle[i],bg:bgOf(r.timeMs+jit[i],i)}))};
 assert.equal(b.alignTimelines(own,sup),null);
 const r=b.enrichAligned(own,sup);
 assert.deepEqual(r.lines.map(x=>x.timeMs),bgRows.map(x=>x.timeMs),'行时间不动');
 assert.deepEqual(r.lines.map(x=>x.agent),['v1','both','both','v1','v2'],'已有的 both 不被 v2 覆盖');
 assert.deepEqual(r.lines[1].bg,{text:'自己的和声'},'已有的和声不覆盖');
 // 平移：和声词相对行开头的位置不变（对方行开头 +jit，本行平移 -jit）
 assert.deepEqual(r.lines[0].bg.words.map(w=>w.startMs),[1000+500,1000+900]);
 assert.deepEqual(r.lines[3].bg.words.map(w=>[w.startMs,w.duration]),[[24000+500,400],[24000+900,600]]);
 assert.equal(sup.lines[0].bg.words[0].startMs,1000+350+500,'不改对方的数据');
 const c=b.lyricCoverage(r);assert.equal(c.bgLines,5);assert.equal(c.agentLines,5);
 assert.equal(r.provenance.at(-1).platform,'amll');
 // 补 agent 但只补和声：没有增益时原样返回
 assert.equal(b.enrichAligned(r,sup),r,'再补一遍没有增益');
});
await test('#199 对方只有一种 agent 时不补 agent（只补和声）；对方没有和声也没有两种 agent 时没有增益',()=>{
 const jit=[350,-200,500,-300,100];
 const own={raw:'',lines:bgRows.map(r=>({...r}))};
 const mk=(f)=>({raw:'',identity:{platform:'amll',sourceId:'a'},lines:bgRows.map((r,i)=>({...r,timeMs:r.timeMs+jit[i],...f(r,i)}))});
 const oneAgent=b.enrichAligned(own,mk((r,i)=>({agent:'v1',bg:bgOf(r.timeMs+jit[i],i)})));
 assert.equal(b.lyricCoverage(oneAgent).bgLines,5);assert.equal(b.lyricCoverage(oneAgent).agentLines,0);
 assert.equal(b.enrichAligned(own,mk(()=>({agent:'v1'}))),own,'只有一种 agent 且没有和声：没增益');
 const twoAgents=b.enrichAligned(own,mk((r,i)=>({agent:i%2?'v2':'v1'})));
 assert.equal(b.lyricCoverage(twoAgents).agentLines,5);assert.equal(b.lyricCoverage(twoAgents).bgLines,0);
});
await test('#199 固定偏移那条路：对方每行的和声词也加上 offset，agent 一并补上',()=>{
 const sup={raw:'',identity:{platform:'amll',sourceId:'a'},lines:bgRows.map((r,i)=>({...r,timeMs:r.timeMs+400,agent:i%2?'v2':'v1',bg:bgOf(r.timeMs+400,i)}))};
 const own={raw:'',lines:bgRows.map(r=>({...r}))};
 const al=b.alignTimelines(own,sup);assert.equal(al.offsetMs,-400);
 const r=b.enrichAligned(own,sup);
 assert.deepEqual(r.lines.map(x=>x.timeMs),bgRows.map(x=>x.timeMs));
 assert.deepEqual(r.lines[2].bg.words.map(w=>w.startMs),[16000+500,16000+900],'对方的 16400+500 加上 offset -400');
 assert.deepEqual(r.lines.map(x=>x.agent),['v1','v2','v1','v2','v1']);
 assert.equal(b.lyricCoverage(r).bgLines,5);
 // 对方自己的（已挪动前）数据没被改
 assert.equal(sup.lines[2].bg.words[0].startMs,16000+400+500);
 // 本行已有的和声不覆盖，缺的补上
 const part=b.enrichAligned({raw:'',lines:bgRows.map((x,i)=>i===0?{...x,bg:{text:'有'}}:{...x})},sup);
 assert.deepEqual(part.lines[0].bg,{text:'有'});assert.equal(part.lines[1].bg.text,'和声1');
});
await test('#199 行时间校准 / 逐行补逐字时 bg、agent 跟着行走，和声词的绝对时间不跟着挪',()=>{
 const offs=[430,-280,900,-1100,300];
 const rows=bgRows.map((r,i)=>({...r,agent:agentCycle[i],bg:bgOf(r.timeMs,i)}));
 const l={raw:'',lines:rows,yrc:rows.map((x,i)=>`[${x.timeMs+offs[i]},1000](${x.timeMs+offs[i]},1000,0)${x.text}`).join('\n')};
 const s=b.snapLinesToWords(l);
 assert.deepEqual(s.lines.map(x=>x.timeMs),rows.map((x,i)=>x.timeMs+offs[i]));
 s.lines.forEach((x,i)=>{assert.equal(x.agent,agentCycle[i]);assert.deepEqual(x.bg,rows[i].bg);});
 // 逐行补逐字（mergeWordsByLine）：本平台没逐字，对方有，bg 不丢
 const jit=[350,-200,500,-300,100];
 const own={raw:'',lines:rows};
 const sup={raw:'',identity:{platform:'qq',sourceId:'q'},lines:rows.map((x,i)=>({...x,timeMs:x.timeMs+jit[i],bg:undefined,agent:undefined})),yrc:rows.map((x,i)=>`[${x.timeMs+jit[i]},900](${x.timeMs+jit[i]},900,0)${x.text}`).join('\n')};
 const r=b.enrichAligned(own,sup);
 assert.deepEqual(r.lines.map(x=>x.timeMs),rows.map((x,i)=>x.timeMs+jit[i]),'行时间改用对方逐字');
 r.lines.forEach((x,i)=>{assert.equal(x.agent,agentCycle[i]);assert.deepEqual(x.bg,rows[i].bg);});
});
await test('#199 缓存校验：agent / bg 类型不对的整条拒绝，合法的原样存取',async()=>{
 const good={...base,lines:base.lines.map((l,i)=>({...l,agent:'v2',bg:i?{text:'和'}:bgOf(l.timeMs,0)}))};
 const cache=new b.LyricCache(temp);
 cache.set('qq','bg-ok',{...good,incomplete:false});assert.deepEqual(cache.get('qq','bg-ok').lines[0].bg,good.lines[0].bg);
 for(const [i,bad] of [{agent:'v3'},{agent:1},{bg:'和声'},{bg:{text:1}},{bg:{text:'x',words:'w'}},{bg:{text:'x',words:[{text:'a',startMs:'1',duration:2}]}},{bg:null}].entries()){
  cache.set('qq','bad'+i,{...base,lines:[{...base.lines[0],...bad}]});assert.equal(cache.get('qq','bad'+i),null,JSON.stringify(bad));
 }
});
await test('#199 前端：normalizeLyricLines 把 agent / bg 带出来（防御性读入），经逐字合并、注音、过滤署名行一路不丢；toEngineLine 带上和声 units 与 agent',()=>{
 const raw={lines:[
  {timeMs:1000,text:'编的第一句',agent:'v1',bg:{text:'哦',words:[{text:'哦',startMs:1500,duration:1200},{text:'坏',startMs:'x',duration:1}]}},
  {timeMs:6000,text:'编的第二句',agent:'v2',bg:{text:'只有文字'}},
  {timeMs:11000,text:'编的第三句',agent:'both'},
  {timeMs:16000,text:'编的第四句',agent:'v9',bg:{text:1}},
  {timeMs:21000,text:'编的第五句',bg:{text:'  '}}],
  yrc:[1000,6000,11000,16000,21000].map((t,i)=>`[${t},1000](${t},1000,0)编的第${'一二三四五'[i]}句`).join('\n')};
 const lines=ui.normalizeLyricLines(raw);
 assert.deepEqual(lines.map(l=>l.agent),['v1','v2','both',undefined,undefined],'类型不对的 agent 丢掉');
 assert.deepEqual(lines[0].bg,{text:'哦',words:[{text:'哦',startMs:1500,duration:1200}]},'时间不是数字的词丢掉');
 assert.deepEqual(lines[1].bg,{text:'只有文字'});
 assert.equal(lines[3].bg,undefined);assert.equal(lines[4].bg,undefined);
 assert.ok(lines.every(l=>l.words?.length),'逐字合并成功，bg / agent 没丢');
 assert.equal(ui.normalizeLyricLines(null).length,0);
 const es=lines.map((l,i)=>model.toEngineLine(l,lines[i+1]?lines[i+1].timeMs/1000:undefined));
 assert.deepEqual(es.map(e=>e.agent),[undefined,'v2','both',undefined,undefined],'v1 不记');
 assert.equal(es[0].bg.text,'哦');assert.equal(es[0].bg.units.length,1);
 assert.deepEqual([es[0].bg.units[0].s,es[0].bg.units[0].e],[1.5,2.7]);
 assert.equal(es[0].bg.units[0].emph,false,'和声没有长音效果：时长 1.2 秒也不算长音');
 assert.deepEqual(es[1].bg,{text:'只有文字',units:null},'没有逐字时间：整句显示');
 assert.equal(es[2].bg,undefined);
 // 没有逐字的主歌词行也能带和声
 const plain=model.toEngineLine({timeMs:1000,text:'整句',bg:{text:'小字',words:[{text:'小',startMs:1200,duration:300},{text:'字',startMs:1500,duration:300}]}});
 assert.equal(plain.units,null);assert.equal(plain.bg.units.length,2);
 // 和声比主唱晚唱完：间奏从和声唱完开始算
 const entries=model.buildEntries([{timeMs:1000,text:'甲',words:[{text:'甲',startMs:1000,duration:500}],bg:{text:'和',words:[{text:'和',startMs:2000,duration:1500}]}},{timeMs:20000,text:'乙'}]);
 const gap=entries.find((e,i)=>e.kind==='gap'&&i>0);assert.ok(gap);assert.equal(gap.s,3.5);
});
await test('#218 长音判定：门槛随字速（max(0.8, 3×每字中位)，满 1.3 秒一定算）、中日韩多字单位只给最后一个字、所有字母和单字母、超过 10 秒不算、每句最多 2 个',()=>{
 // 一句逐字：[文字, 时长秒]，从 10 秒起依次排
 const L=(ws)=>{let t=10000;return {timeMs:t,text:ws.map(w=>w[0]).join(' '),words:ws.map(([text,d])=>{const w={text,startMs:t,duration:Math.round(d*1000)};t+=w.duration;return w;})};};
 // 句首垫一个 0.1 秒的字：只有一个多字词的行会被当成「没有逐字」（parseYrcText 的整行假词）
 const E=(ws,pace)=>model.toEngineLine(L([['·',0.1],...ws]),undefined,pace).units.slice(1);
 const emph=(us)=>us.filter(u=>u.emph).map(u=>u.t);
 // 字速：多字单位按字数摊开取中位
 assert.ok(Math.abs(model.songPace([L([['我',0.2],['们',0.2],['一起',0.4],['走',0.2],['吧',0.2],['好',0.2],['不',0.2],['好',0.2]])])-0.2)<1e-9);
 assert.ok(Math.abs(model.songPace([L([['短',1]])])-1/3)<1e-9,'逐字太少时用默认字速（门槛 1 秒）');
 // 快歌（每字 0.2s）：0.85s 就算；慢歌（每字 0.5s）：1.2s 不算、1.35s 算（满 1.3 秒一定算）
 assert.deepEqual(emph(E([['甲',0.2],['乙',0.85]],0.2)),['乙']);
 assert.deepEqual(emph(E([['甲',0.5],['乙',1.2]],0.5)),[]);
 assert.deepEqual(emph(E([['甲',0.5],['乙',1.35]],0.5)),['乙']);
 // 中日韩多字单位：估算最后一个字的时长，够长就拆开只给最后一个字
 const ko=E([['나도',0.6],['싶어',1.5]],0.3);
 assert.deepEqual(ko.map(u=>u.t),['나도','싶','어']);assert.deepEqual(emph(ko),['어']);
 const tail=ko.find(u=>u.emph);assert.ok(Math.abs(tail.e-tail.s-1.2)<1e-6,'最后一个字 = 总时长 − 前面字 × 字速');
 assert.equal(ko.map(u=>u.t).join(''),'나도싶어','拆开后文字不变');
 assert.deepEqual(emph(E([['돌아보면',1.9]],0.4)),[],'4 个字 1.9 秒：平均每字不长，不算');
 assert.deepEqual(emph(E([['振り払ってい',1.1]],0.3)),[],'词组按词给时间：不算');
 assert.deepEqual(E([['会いたい、',2.0]],0.3).map(u=>u.t),['会いた','い、'],'最后一个字连同后面的标点一起拆出');
 // 拉丁：单字母、长词、重音字母都算；超过 10 秒不算
 assert.deepEqual(emph(E([['I',1.1],['love',0.3]],0.3)),['I']);
 assert.deepEqual(emph(E([['invitation',2.0]],0.3)),['invitation']);
 assert.deepEqual(emph(E([['corazón',1.2]],0.3)),['corazón']);
 assert.deepEqual(emph(E([['live',32.7]],0.3)),[],'来源把间奏并进了这个字');
 assert.deepEqual(emph(E([['side',6.1]],0.3)),['side'],'6–10 秒的真长音照算');
 // 每句最多 2 个，挑最长的
 assert.deepEqual(emph(E([['oh',1.1],['my',1.5],['love',1.3],['yeah',0.2]],0.3)),['my','love']);
});
await test('#202 只有左括号的句子补上右括号：正文和同一句的逐字都补，成对的、句中括号、普通句不动',()=>{
 const l={raw:'',lines:[{timeMs:1000,text:'（编的和声'},{timeMs:5000,text:'(made up echo'},{timeMs:9000,text:'（成对的）'},{timeMs:13000,text:'编的（句中'},{timeMs:17000,text:'普通句'}],
  yrc:['[1000,2000](1000,1000,0)（(2000,1000,0)编的和声','[5000,1000](5000,1000,0)(made up echo','[9000,1000](9000,1000,0)（成对的）'].join('\n')};
 const r=b.closeBrackets(l);
 assert.deepEqual(r.lines.map(x=>x.text),['（编的和声）','(made up echo)','（成对的）','编的（句中','普通句']);
 const w=b.timedLines(r.yrc);
 assert.equal(w[0].words.map(x=>x.text).join(''),'（编的和声）');assert.equal(w[0].words.at(-1).startMs,2000,'词时间不变');
 assert.equal(w[1].words.map(x=>x.text).join(''),'（成对的）');
 assert.equal(b.closeBrackets({raw:'',lines:[{timeMs:1,text:'普通'}]}).lines[0].text,'普通');
});
await test('普通整句与无词时间的 JSON 不伪造逐字',()=>{assert.equal(ui.parseYrcText('[00:10.00]普通歌词').length,0);assert.equal(ui.parseYrcText('{"t":10,"c":[{"tx":"正文"}]}').length,0)});
await test('英文空格补齐保持原始长音时长',()=>{
 const lines=[{timeMs:1000,text:'Hello world',words:[{text:'Hello',startMs:1000,duration:100},{text:'world',startMs:1100,duration:1900}]}];
 const result=ui.alignWordsToText(lines);assert.equal(result[0].words[0].duration,100);assert.equal(result[0].words[1].duration,1900);assert.equal(result[0].words[0].space,true);
});
await test('相近时间但不同正文不能挂接逐字',()=>{const r=ui.mergeWordLyrics([{timeMs:1000,text:'甲'}],'[1000,1000](1000,1000,0)乙');assert.equal(r[0].words,undefined)});
await test('只有逐字时仍能显示原始正文',()=>{const r=ui.mergeWordLyrics([],'[1000,1000](1000,1000,0)甲');assert.equal(r[0].text,'甲')});
await test('旧版/损坏缓存失效（v2–v5 也作废，#197 / #199 / #201 / #202），v6 不完整六小时与完整三十天',async()=>{
 for(const schema of [2,3,4,5]){fs.writeFileSync(path.join(temp,'lyric-cache.json'),JSON.stringify({schema,entries:{'qq:x':{at:Date.now(),lyric:base}}}));assert.equal(new b.LyricCache(temp).get('qq','x'),null);}
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
await test('歌词版本文案：自动来源说明按 provenance 拼，能区分补了什么就写具体的，区分不了写「补全」',()=>{
 const prov=[{platform:'netease',kind:'primary'},{platform:'qq',kind:'enrichment',gain:['words']},{platform:'amll',kind:'enrichment',gain:['roman','bg']},{platform:'kugou',kind:'enrichment'}];
 assert.equal(lv.describeAutoSource(prov),'网易云正文 · QQ 补逐字 · AMLL 补罗马音、和声 · 酷狗 补全');
 assert.equal(lv.describeAutoSource(prov.slice(0,2),true),'网易云 · QQ 补逐字');
 assert.equal(lv.describeAutoSource([{platform:'kuwo',kind:'primary'}]),'酷我正文');
 assert.equal(lv.describeAutoSource([]),'');assert.equal(lv.describeAutoSource(undefined),'');
 assert.equal(lv.describeAutoSource([{platform:'applemusic',kind:'fallback'}],true),'Apple');
 assert.equal(lv.lyricSourceName('qq'),'QQ 音乐');assert.equal(lv.lyricSourceName('amll'),'AMLL 社区库');assert.equal(lv.lyricSourceName('applemusic'),'Apple Music');assert.equal(lv.lyricSourceName('netease'),'网易云音乐');
});
await test('歌词版本文案：「关于这首歌」里歌词行——自动 / 手动 / 微调',()=>{
 const auto=[{platform:'netease',kind:'primary'},{platform:'qq',kind:'enrichment',gain:['words']}];
 assert.equal(lv.describeLyricEntry(auto,0),'网易云 · QQ 补逐字');
 assert.equal(lv.describeLyricEntry([{platform:'qq',kind:'manual'},{platform:'amll',kind:'enrichment',gain:['bg']}],0),'手动：QQ 音乐');
 assert.equal(lv.describeLyricEntry(auto,300),'网易云 · QQ 补逐字 · 推后 0.3 秒');
 assert.equal(lv.describeLyricEntry([{platform:'qq',kind:'manual'}],-1500),'手动：QQ 音乐 · 提前 1.5 秒');
 assert.equal(lv.describeLyricEntry(undefined,200),'推后 0.2 秒');assert.equal(lv.describeLyricEntry(undefined,0),'');
});
await test('歌词版本文案：版本行说明（逐字百分比 / 只有整句 / 翻译与罗马音 ≥50% / 和声 / 对唱 / 时长差）',()=>{
 const cov=(o)=>({textLines:100,wordLines:0,translatedLines:0,romanLines:0,bgLines:0,agentLines:0,...o});
 assert.equal(lv.describeVersion({coverage:cov({wordLines:62}),durationDiffSec:null}),'逐字 62%');
 assert.equal(lv.describeVersion({coverage:cov(),durationDiffSec:null}),'只有整句');
 assert.equal(lv.describeVersion({coverage:cov({wordLines:100,translatedLines:50,romanLines:49}),durationDiffSec:0.4}),'逐字 100% · 翻译 · 时长差 0.4 秒');
 assert.equal(lv.describeVersion({coverage:cov({wordLines:80,translatedLines:49,romanLines:50,bgLines:3,agentLines:20}),durationDiffSec:0}),'逐字 80% · 罗马音 · 和声 · 对唱 · 时长差 0 秒');
 assert.equal(lv.describeVersion({coverage:cov({wordLines:10}),durationDiffSec:3.2}),'逐字 10% · 时长差 3.2 秒，可能不是同一版本');
 assert.equal(lv.describeVersion({coverage:cov({wordLines:10}),durationDiffSec:2}),'逐字 10% · 时长差 2 秒，可能不是同一版本');
 assert.equal(lv.describeVersion({coverage:{textLines:0,wordLines:0,translatedLines:0,romanLines:0,bgLines:0,agentLines:0},durationDiffSec:null}),'只有整句');
});
await test('歌词版本文案：时间微调数值与档位（0.1 秒一档、±5 秒封顶）',()=>{
 assert.equal(lv.formatLyricOffset(300),'+0.3 秒');assert.equal(lv.formatLyricOffset(-500),'−0.5 秒');assert.equal(lv.formatLyricOffset(0),'0.0 秒');assert.equal(lv.formatLyricOffset(5000),'+5.0 秒');
 assert.equal(lv.stepLyricOffset(0,1),100);assert.equal(lv.stepLyricOffset(0,-1),-100);assert.equal(lv.stepLyricOffset(4950,1),5000);
 assert.equal(lv.stepLyricOffset(5000,1),5000);assert.equal(lv.stepLyricOffset(-5000,-1),-5000);assert.equal(lv.stepLyricOffset(100,-1),0);
 let v=0;for(let i=0;i<30;i++)v=lv.stepLyricOffset(v,1);assert.equal(v,3000,'连点 30 次正好 +3.0 秒，无浮点误差');
});
await test('#214 逐行补逐字再配四种：对方拆两行、本平台拆两句、对方一行里的一段、正文相同而前后之间只有这一行（时间差大）',()=>{
 const yl=(start,words)=>`[${start},${words.reduce((m,w)=>Math.max(m,w[1]+w[2]),0)-start}]`+words.map(([t,ws,wd])=>`(${ws},${wd},0)${t}`).join('');
 const one=(start,text)=>yl(start,[[text,start,900]]);
 const rows=[[1000,'编的甲句'],[5000,'编的乙句'],[9000,'编的丙句'],[13000,'编的丁句前半编的丁句后半'],[17000,'编的戊一'],[19000,'编的戊二'],[23000,'编的己句'],[27000,'编的庚句'],[31000,'编的辛句'],[35000,'编的壬句']].map(([timeMs,text])=>({timeMs,text}));
 const yrc=[one(1200,'编的甲句'),one(5200,'编的乙句'),one(9200,'编的丙句'),
  one(13200,'编的丁句前半'),one(15200,'编的丁句后半'),
  yl(17200,[['编的',17200,500],['戊一',17700,500],['编的',19200,500],['戊二',19700,500]]),
  yl(23200,[['编的',23200,400],['己句',23600,400],['啊哦',24000,400]]),
  one(27200,'编的庚句'),one(33500,'编的辛句'),one(35200,'编的壬句')].join(String.fromCharCode(10));
 const own={raw:'',lines:rows},sup={raw:'',lines:[],yrc};
 const r=b.mergeWordsByLine(own,sup);
 assert.ok(r,'有增益');
 assert.equal(b.lyricCoverage(r.lyric).wordLines,10,'十行全部挂上逐字');
 const words=b.timedLines(r.lyric.yrc);
 const at=(text)=>words.find(w=>b.identityText(w.text)===b.identityText(text));
 assert.deepEqual(at('编的丁句前半编的丁句后半').words.length,2,'对方两行合成一行');
 assert.equal(at('编的戊二').timeMs,19200,'对方一行按字拆开，后一句从它自己的第一个字开始');
 assert.deepEqual(at('编的己句').words.map(w=>w.text),['编的','己句'],'只取正好是本行的那一段字');
 assert.equal(at('编的辛句').timeMs,33500,'前后之间只有这一行正文相同：时间差 2.5 秒也认');
 // 有两行正文相同时不靠「只有这一行」去猜
 const dup=[...rows.slice(0,8),{timeMs:31000,text:'编的辛句'},{timeMs:32000,text:'编的辛句'},{timeMs:35000,text:'编的壬句'}];
 const r2=b.mergeWordsByLine({raw:'',lines:dup},sup);
 assert.ok(b.lyricCoverage(r2.lyric).wordLines<11,'两行正文相同、对方只有一行：不硬配');
});
await test('#233 「标签 + 空格 + 名字」型署名行不再混进正文（编曲 n-buna 等）',()=>{
  const lines = [
    { timeMs: 0, text: '编曲 n-buna' },
    { timeMs: 0, text: '編曲 n-buna' },
    { timeMs: 0, text: '作曲 米津玄師' },
    { timeMs: 0, text: '作词 张三' },
    { timeMs: 0, text: 'Programming Cirkut' },
    { timeMs: 0, text: 'ギター n-buna' },
    { timeMs: 0, text: 'producer Rick Rubin' },
    { timeMs: 1000, text: '夢ならばどれほどよかったでしょう' },
  ];
  const kept = ui.filterCreditLines(lines, 'Lemon', '米津玄師');
  assert.deepEqual(kept.map((l) => l.text), ['夢ならばどれほどよかったでしょう'], '八种署名写法全部丢掉，正文留下');
});
await test('#233 正文首句不会被误杀（标签字开头的正常歌词）',()=>{
  for (const text of ['我爱你 中国', '曲终人散', '词不达意', '我和我的祖国', '走吧 走吧', '春风十里 不如你', '鼓浪屿之波', '爱 是不能忘记的']) {
    const kept = ui.filterCreditLines([{ timeMs: 0, text }], '某某', '某某');
    assert.equal(kept.length, 1, `「${text}」是正文，不能当署名行丢掉`);
  }
});
console.log(`歌词回归 ${count}/${count}`);
}finally{fs.rmSync(temp,{recursive:true,force:true})}
