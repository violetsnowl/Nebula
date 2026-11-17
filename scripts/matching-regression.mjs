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
const round2 = [];
function pair(kind,title,artist,candidate,expected=true) {
 const target={...cases[0].target,title,artist,duration:220};
 round2.push({kind,target,candidate:{...target,platform:'kugou',duration:221,...candidate},expected});
}
pair('酷狗英文高亮','In The End','Linkin Park',{title:'<em>In The End</em>',artist:'<em>Linkin Park</em>',artists:['<em>Linkin Park</em>']});
pair('酷狗中文高亮','彩色的黑','吉克隽逸',{title:'<em>彩色的黑</em>',artist:'<em>吉克隽逸</em>'});
pair('括注译名1','花びらたちのマーチ (花瓣的游行)','Aimer',{title:'花びらたちのマーチ'});
pair('括注译名2','10月無口な君を忘れる (忘却10月沉默的你)','あたらよ',{title:'10月無口な君を忘れる'});
pair('括注译名3','The Other Side Of Paradise（天堂彼岸）','Glass Animals',{title:'The Other Side Of Paradise'});
pair('Explicit标记','Godzilla (Explicit)','Eminem',{title:'Godzilla'});
for(const [base,alias]of [['ROSÉ','로제'],['米津玄師','よねづ けんし'],['YOASOBI','ヨアソビ'],['BLACKPINK','블랙핑크']])pair('歌手别名'+base,'公开同一录音',`${base} (${alias})`,{artist:base});
pair('通用规则覆盖指定曲','丸ノ内サディスティック (丸之内虐待狂)','椎名林檎 (しいな りんご)',{title:'丸ノ内サディスティック',artist:'椎名林檎'});
pair('相同Live版本允许','Love The Way You Lie (Live)','Eminem',{title:'Love The Way You Lie (Live)'});
pair('Lemon翻唱拒绝','Lemon','米津玄師',{artist:'monogataru'},false);
pair('LOSER翻唱拒绝','LOSER','米津玄師',{artist:'柳'},false);
pair('Godzilla伴奏拒绝','Godzilla','Eminem',{title:'Godzilla (伴奏)'},false);
pair('LoveTheWayLive拒绝','Love The Way You Lie','Eminem',{title:'Love The Way You Lie (Live)'},false);
for(const version of ['DJ版','网友改编','纯音乐','THE FIRST TAKE','Acoustic Ver.','Radio Edit','Remastered'])pair('保留版本门禁'+version,'群青','YOASOBI',{title:`群青 (${version})`},false);
pair('无括号DJ拒绝','群青','YOASOBI',{title:'群青 DJ版'},false);
pair('词尾不同拒绝','Lie','NF',{title:'Lies'},false);
pair('高亮不能掩盖不同歌手','In The End','Linkin Park',{artist:'<em>其他歌手</em>'},false);
pair('合作名单不能忽略','合唱作品','甲 / 乙',{artist:'甲 (feat. 丙)'},false);
// 合并复核补充：括注里的「版」与伴奏 / 语种 / 器乐 / 剪辑词仍是版本，时长相同也不能顶替原曲。
for(const version of ['国语版','钢琴版','女声版','抖音版','Off Vocal','Inst.','TV Size','Extended Mix','Clean','0.8x'])pair('合并复核版本门禁'+version,'群青','YOASOBI',{title:`群青 (${version})`,duration:220},false);
pair('合并复核粤语版不顶替国语版','K歌之王 (国语版)','陈奕迅',{title:'K歌之王 (粤语版)'},false);
pair('合并复核同语种版本允许','K歌之王 (国语版)','陈奕迅',{title:'K歌之王 (国语版)'});
pair('合并复核主题曲注释不算版本','群青','YOASOBI',{title:'群青 (电影《X》主题曲)'});
assert.equal(api.searchKeyword({title:'花びらたちのマーチ (花瓣的游行)',artist:'Aimer (エメ)',artists:['Aimer (エメ)']}),'花びらたちのマーチ Aimer');
assert.equal(api.searchKeyword({title:'Lemon',artist:'米津玄師 (よねづ けんし)',artists:['米津玄師 (よねづ けんし)']}),'Lemon 米津玄師');
assert.equal(api.searchKeyword({title:'DDU-DU DDU-DU (Korean Ver.)',artist:'BLACKPINK (블랙핑크)'}),'DDU-DU DDU-DU (Korean Ver.) BLACKPINK');
assert.equal(api.searchKeyword({title:'The Other Side Of Paradise（天堂彼岸） (Explicit)',artist:'Glass Animals'}),'The Other Side Of Paradise Glass Animals');
pair('合并复核酷狗kwinst不顶替Explicit原曲','Dancing in My Room (Explicit)','347aidan',{title:'Dancing in My Room (kwinst)'},false);
pair('合并复核英文标题未知英文括注保守拦截','Demons','Imagine Dragons',{title:'Demons (SingleVersion)'},false);
pair('合并复核中文标题英文译名不算版本','再见','G.E.M.邓紫棋',{title:'再见（good bye）'});
cases.push(...round2);
for(const c of cases)assert.equal(api.recordingMatch(c.candidate,c.target).ok,c.expected,c.kind);
console.log(`严格录音匹配 ${cases.length}/${cases.length}`);
if(fs.existsSync('dist-main/round1.cjs')){
 const previous=require('../dist-main/round1.cjs');
 console.log(JSON.stringify({round2Cases:round2.length,round1Correct:round2.filter(c=>previous.recordingMatch(c.candidate,c.target).ok===c.expected).length,round2Correct:round2.length}));
}
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
const kg=new api.KugouAdapter({requestJson:async()=>({data:{lists:[{FileHash:'same-recording',SongName:'<em>In The End</em>',SingerName:'<em>Linkin Park</em>',AlbumName:'<em>Hybrid Theory</em>',Duration:221}]}})},{getHeader:()=>''});
const found=await kg.searchSongs('In The End Linkin Park');
assert.equal(found[0].title,'In The End');assert.equal(found[0].artist,'Linkin Park');assert.deepEqual(found[0].artists,['Linkin Park']);assert.equal(found[0].album,'Hybrid Theory');
const target={...round2[0].target,album:'Hybrid Theory'};
const resolver=new api.SongResolver({netease:{fetchSongUrl:async()=>null},qq:{searchSongs:async()=>[]},kugou:{searchSongs:async()=>found,fetchSongUrl:async()=>({url:'https://test/same'})}},()=>{},async()=>true);
assert.equal((await resolver.resolve(target)).platform,'kugou');
const qqMapped=api.mapQQTrack({mid:'same',name:'<em>歌名</em>',singer:[{name:'<em>歌手</em>'}],album:{name:'<em>专辑</em>'}});
assert.deepEqual([qqMapped.title,qqMapped.artist,qqMapped.artists[0],qqMapped.album],['歌名','歌手','歌手','专辑']);
console.log('搜索适配器清理与真实路由门禁 2/2');
