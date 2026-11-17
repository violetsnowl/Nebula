import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),api=require('../dist-main/index.cjs');
const samples=[['丸ノ内サディスティック','椎名林檎',235],['Resonance','HOME',235],['夜に駆ける','YOASOBI',261],['Lemon','米津玄師',255],['七里香','周杰伦',299],['稻香','周杰伦',223],['Hello','Adele',295],['Butter','BTS',164],['Ditto','NewJeans',185],['Blinding Lights','The Weeknd',200],['First Love','宇多田ヒカル',257],['紅豆','王菲',257]];
const cases=[];
for(const [title,artist,duration] of samples){
 const t={title,artist,duration,album:'原版专辑',platform:'netease',sourceId:'target',id:'target',originalUrl:'',fallbackUrl:'',cover:''};
 cases.push({kind:'正确',target:t,candidate:{...t,platform:'qq',duration:duration+1},expected:true});
 cases.push({kind:'同名歌手',target:t,candidate:{...t,platform:'qq',artist:'其他歌手'},expected:false});
 for(const version of ['Live','Remix','Instrumental','Cover','2011 Remaster','2019 Mix'])cases.push({kind:version,target:t,candidate:{...t,platform:'qq',title:title+' ('+version+')'},expected:false});
 cases.push({kind:'错误时长',target:t,candidate:{...t,platform:'qq',duration:duration+15},expected:false});
}
cases.push({kind:'多位歌手',target:{...cases[0].target,artist:'甲 / 乙',artists:['甲','乙']},candidate:{...cases[0].candidate,artist:'乙 & 甲'},expected:true});
cases.push({kind:'译名别名',target:cases[0].target,candidate:{...cases[0].candidate,artist:'Ringo Shiina'},expected:true});
cases.push({kind:'任务书翻唱',target:cases[0].target,candidate:{...cases[0].candidate,artist:'オレンジ'},expected:false});
cases.push({kind:'全半角',target:{...cases[0].target,title:'ＨＥＬＬＯ'},candidate:{...cases[0].candidate,title:'hello'},expected:true});
cases.push({kind:'假名',target:{...cases[0].target,title:'サクラ'},candidate:{...cases[0].candidate,title:'さくら'},expected:true});
cases.push({kind:'繁简',target:{...cases[0].target,title:'愛的夢'},candidate:{...cases[0].candidate,title:'爱的梦'},expected:true});
cases.push({kind:'合作歌手缺失',target:{...cases[0].target,artists:['甲','乙']},candidate:{...cases[0].candidate,artist:'甲'},expected:false});
cases.push({kind:'已核对的本曲译名与歌手括注',target:cases[0].target,candidate:{...cases[0].candidate,title:'丸ノ内サディスティック (丸之内虐待狂)',artist:'椎名林檎 (しいな りんご)'},expected:true});
for(const c of cases)assert.equal(api.recordingMatch(c.candidate,c.target).ok,c.expected,c.kind);
console.log(`严格录音匹配 ${cases.length}/${cases.length}`);
if(fs.existsSync('dist-main/baseline.cjs')){
 const baseline=require('../dist-main/baseline.cjs');let wrong=0,accepted=0,negatives=0;
 for(const c of cases){
  const r=new baseline.SongResolver({netease:{fetchSongUrl:async()=>null},qq:{searchSongs:async()=>[c.candidate],fetchSongUrl:async()=>({url:'https://test/a'})},kugou:{searchSongs:async()=>[]}},()=>{},async()=>true);
  r.setFallbackTargets(async()=>[{platform:'qq',tier:'guest'}]);
  const got=await r.resolve(c.target);if(got.url)accepted++;if(!c.expected){negatives++;if(got.url)wrong++}
 }
 console.log(JSON.stringify({baselineFalseAccept:wrong,negativeCases:negatives,baselineAccepted:accepted,afterFalseAccept:0,afterTrueAccept:cases.filter(c=>c.expected).length}));
}
let calls=[];
const mock={requestJson:async(url,opts)=>{calls.push({url,opts});const files=opts.body.req_0.param.filename;return {req_0:{code:0,data:{sip:['https://ws.stream.qqmusic.qq.com/'],midurlinfo:files.map(filename=>({filename,purl:filename.startsWith('M800')?filename+'?vkey=synthetic':''}))}}}}};
const adapter=new api.QqAdapter(mock,{getHeader:()=> 'uin=o123456; qqmusic_key=synthetic-test-only'});
const result=await adapter.fetchSongUrl('song-id',undefined,'flac',{mediaMid:'media-id'});
assert.equal(result.quality,'320k');assert.equal(calls.length,1);assert.equal(calls[0].opts.body.comm.authst,'synthetic-test-only');assert.ok(calls[0].opts.body.req_0.param.filename.includes('F000media-id.flac'));assert.ok(!calls[0].url.includes('express'));
calls=[];await adapter.fetchSongUrl('song-id',undefined,'128k',{mediaMid:'media-id'});assert.ok(calls[0].opts.body.req_0.param.filename.every(f=>f.startsWith('M500')));
const anon=new api.QqAdapter({requestJson:async()=>({req_0:{data:{midurlinfo:[]}}})},{getHeader:()=>''});assert.equal((await anon.fetchSongUrl('id',undefined,undefined,{mediaMid:'media'})).code,'LOGIN_REQUIRED');
console.log('QQ 批量文件、登录 comm、实际档位、向下降级、匿名错误 5/5');
