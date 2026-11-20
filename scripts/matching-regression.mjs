import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),api=require('../dist-main/index.cjs');
const samples=[['丸ノ内サディスティック','椎名林檎',235],['Resonance','HOME',235],['夜に駆ける','YOASOBI',261],['Lemon','米津玄師',255],['七里香','周杰伦',299],['稻香','周杰伦',223],['Hello','Adele',295],['Butter','BTS',164],['Ditto','NewJeans',185],['Blinding Lights','The Weeknd',200],['First Love','宇多田ヒカル',257],['紅豆','王菲',257]];
const cases=[];
for(const [title,artist,duration] of samples){
 const t={title,artist,duration,album:'原版专辑',platform:'netease',sourceId:'target',id:'target',originalUrl:'',fallbackUrl:'',cover:''};
 cases.push({kind:'正确',target:t,candidate:{...t,platform:'qq',duration:duration+1},expected:true});
 // 时长 +1 秒：只测歌手门禁（时长完全相同、歌手名不同文字时 #205 起按「script」放行，另有专门的用例）
 cases.push({kind:'同名歌手',target:t,candidate:{...t,platform:'qq',artist:'其他歌手',duration:duration+1},expected:false});
 for(const version of ['Live','Remix','Instrumental','Cover','2011 Remaster','2019 Mix'])cases.push({kind:version,target:t,candidate:{...t,platform:'qq',title:title+' ('+version+')'},expected:false});
 cases.push({kind:'错误时长',target:t,candidate:{...t,platform:'qq',duration:duration+15},expected:false});
}
cases.push({kind:'多位歌手',target:{...cases[0].target,artist:'甲 / 乙',artists:['甲','乙']},candidate:{...cases[0].candidate,artist:'乙 & 甲'},expected:true});
cases.push({kind:'译名别名',target:cases[0].target,candidate:{...cases[0].candidate,artist:'Ringo Shiina'},expected:true});
cases.push({kind:'任务书翻唱',target:cases[0].target,candidate:{...cases[0].candidate,artist:'オレンジ'},expected:false});
cases.push({kind:'全半角',target:{...cases[0].target,title:'ＨＥＬＬＯ'},candidate:{...cases[0].candidate,title:'hello'},expected:true});
cases.push({kind:'假名',target:{...cases[0].target,title:'サクラ'},candidate:{...cases[0].candidate,title:'さくら'},expected:true});
cases.push({kind:'繁简',target:{...cases[0].target,title:'愛的夢'},candidate:{...cases[0].candidate,title:'爱的梦'},expected:true});
// #205（用户 2026-11-19 定）：一方只写主唱、另一方写全合作歌手也认，但排在歌手完全一致的候选后面（见文件末尾的排位断言）
cases.push({kind:'合作歌手缺失（放宽，排后）',target:{...cases[0].target,artists:['甲','乙']},candidate:{...cases[0].candidate,artist:'甲'},expected:true});
cases.push({kind:'合作歌手缺失但主唱不在',target:{...cases[0].target,artists:['甲','乙']},candidate:{...cases[0].candidate,artist:'乙'},expected:false});
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
// #205 放宽规则（数据来自 261 首跨平台找不到的歌，歌名歌手为公开元数据）
pair('原版说明不算版本','前前前世','RADWIMPS',{title:'前前前世 [original ver.]'});
pair('专辑版说明不算版本','群青','YOASOBI',{title:'群青 (Album Version)'});
pair('「 - 出处」等同括注','City Of Stars - From "La La Land" Soundtrack','Ryan Gosling / Emma Stone',{title:'City Of Stars (From "La La Land" Soundtrack)',artist:'Ryan Gosling/Emma Stone'});
pair('「 - 副标题」当说明','Self Love - Spider-Man: Across the Spider-Verse','Metro Boomin / Coi Leray',{title:'Self Love',artist:'Metro Boomin/Coi Leray'});
pair('「 - feat.」当说明','Send It - feat. Rich Homie Quan','Austin Mahone / Rich Homie Quan',{title:'Send It (feat. Rich Homie Quan)'});
pair('「 - Live」仍是版本','Hello - Live','Adele',{title:'Hello'},false);
pair('出处里带 Live 仍是版本','Hello (From X Live)','Adele',{title:'Hello'},false);
pair('卡拉OK算版本','すずめ feat.十明 (カラオケ)','RADWIMPS',{title:'すずめ feat.十明'},false);
pair('翻自算版本','空山新雨后（翻自 音阙诗听）','音阙诗听',{title:'空山新雨后'},false);
pair('反斜杠拆歌手','lavender','JVKE\\Pink Sweat$',{artist:'JVKE/Pink Sweat$'});
pair('分号拆歌手','GOD\'S SON','梅田サイファー;KOPERU',{artist:'梅田サイファー/KOPERU'});
pair('频道名带后缀','Daisy','Aimer Official YouTube Channel',{artist:'Aimer'});
pair('频道名带英文名','恋','星野源 Gen Hoshino',{artist:'星野源'});
pair('太短的开头不算','Fire','Al',{artist:'Alan Walker'},false);
pair('不同文字的歌手名、时长相同','海の幽霊','Kenshi Yonezu',{artist:'米津玄師',duration:220});
pair('不同文字的歌手名、时长差 1 秒','彩色的黑','Jike Junyi',{artist:'光天翌',duration:221},false);
pair('同文字不同歌手、时长相同','不该','周杰伦',{artist:'程橙',duration:220},false);
pair('英文歌名也走不同文字规则（#211，Apple 中国区中文歌手名）','Hello','Adele',{artist:'阿黛尔',duration:220});
pair('不同文字但人数不同不认（三位原唱 → 单人翻唱）','MORE','编的甲 / Other One / Third One',{artist:'编的乙',duration:220},false);
pair('不同文字但时长差 1 秒不认（英文歌名）','Hello','Adele',{artist:'阿黛尔',duration:221},false);
pair('中文译名括注里含伴奏两字不算版本（#211）','友人A君を私の伴奏者に任命します (任命友人A为我的伴奏者)','横山克',{title:'友人A君を私の伴奏者に任命します'});
pair('中文括注末尾是现场仍是版本','Dance Hall (2023 某某现场)','某乐队',{title:'Dance Hall'},false);
pair('QQ 括号里的原名算歌手写法','Seoul','볼빨간사춘기',{artist:'脸红的思春期 (볼빨간사춘기)'});
pair('另一种文字的括注当歌名写法','Happiness','Red Velvet',{title:'행복 (Happiness)'});
pair('同文字的括注不当歌名写法','Happiness','Red Velvet',{title:'Other Song (Happiness)'},false);
pair('歌手名混写不走不同文字规则','彩色的黑','Jike Junyi',{artist:'温妮娅Wenina',duration:220},false);
// #206 歌手名的几种写法
pair('中英文写在一起的歌手名','Orion','Kenshi Yonezu  米津玄師',{artist:'米津玄師'});
pair('中英文写在一起（英文那段）','Orion','Kenshi Yonezu  米津玄師',{artist:'Kenshi Yonezu'});
pair('韩文英文写在一起','여행','볼빨간사춘기 BOL4',{artist:'BOL4'});
pair('频道名前缀 Official','U Make Me Wanna','Official Blue',{artist:'Blue'});
pair('频道名后缀 Music 且只写主唱','The Monster','EminemMusic',{artist:'Eminem / Rihanna',artists:['Eminem','Rihanna']});
pair('重音符号','Take Me Hand (feat. Cecile Corbel)','DAISHI DANCE',{title:'Take Me Hand',artist:'DAISHI DANCE / Cécile Corbel',artists:['DAISHI DANCE','Cécile Corbel']});
pair('中英文写在一起但都对不上','Orion','Kenshi Yonezu  米津玄師',{artist:'ヨルシカ',duration:230},false);
pair('频道名去后缀后主唱仍不在','The Monster','EminemMusic',{artist:'Rihanna'},false);
pair('同样多的歌手、有一位对不上','合唱作品','甲 / 乙',{artist:'甲 / 丙',artists:['甲','丙']},false);
pair('Original Mix 是原版（#211）','Collapsing World (Original Mix)','Lightscape',{title:'Collapsing World'});
pair('Extended Mix 仍是版本','Collapsing World (Extended Mix)','Lightscape',{title:'Collapsing World'},false);
cases.push(...round2);
for(const c of cases)assert.equal(api.recordingMatch(c.candidate,c.target).ok,c.expected,c.kind);
{
 // 排位：歌手完全一致 < 子集 / 开头相同 < 不同文字；同一档里同专辑优先
 const t={...cases[0].target,title:'夜に駆ける',artist:'YOASOBI',artists:['YOASOBI','Ayase'],duration:220,album:'THE BOOK'};
 const r=(c)=>api.recordingMatch({...t,platform:'qq',...c},t).rank;
 const exact=r({}),exactOther=r({album:'其他'}),loose=r({artist:'YOASOBI',artists:['YOASOBI']}),script=r({artist:'ヨルシカ',artists:['ヨルシカ'],album:'其他'});
 assert.ok(exact<exactOther && exactOther<loose && loose<script,`排位 ${[exact,exactOther,loose,script]}`);
}
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
{
 // #205：搜索第一次返回空列表时隔一下重试一次
 let searches=0;
 const retry=new api.SongResolver({netease:{fetchSongUrl:async()=>null},qq:{searchSongs:async()=>[]},kugou:{searchSongs:async()=>(++searches===1?[]:found),fetchSongUrl:async()=>({url:'https://test/same'})}},()=>{},async()=>true);
 const got=await retry.resolve(target);
 assert.equal(got.platform,'kugou');assert.equal(searches,2);
 assert.ok(got.timings.some(t=>t.stage==='search-retry'&&t.platform==='kugou'));
}
const qqMapped=api.mapQQTrack({mid:'same',name:'<em>歌名</em>',singer:[{name:'<em>歌手</em>'}],album:{name:'<em>专辑</em>'}});
assert.deepEqual([qqMapped.title,qqMapped.artist,qqMapped.artists[0],qqMapped.album],['歌名','歌手','歌手','专辑']);
console.log("搜索适配器清理、真实路由门禁、空结果重试 3/3");
