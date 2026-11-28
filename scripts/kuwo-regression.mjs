import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
// 酷我适配器回归：假 http，不联网。依赖 pnpm build:main 产物。
const require=createRequire(import.meta.url);
const api=require('../dist-main/index.cjs');
const {CookieStore,KuwoAdapter,KuwoLogin,kuwoAvatarUrl,firstTrackCover,parseKuwoSession,mapKuwoMyPlaylists,kuwoCoverUrl,validatePlatformCookie,normalizeCookieHeader,resolveAdapterByUrl,coverCandidates,audioPlatform}=api;
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'kuwo-regression-'));
let seq=0;
const newStore=cookie=>{const s=new CookieStore(path.join(tmp,`c${++seq}.json`));if(cookie)s.set('kuwo',cookie);return s;};
const LOGGED='userid=424242; sid=abc123; websid=web456; username=%E6%B5%8B%E8%AF%95%E7%94%A8%E6%88%B7; pic3=http%3A%2F%2Fimg1.kuwo.cn%2Fstar%2Fuserhead%2F1.jpg';
const row=i=>({id:String(1000+i),name:`歌${i}`,artist:'歌手甲&歌手乙',album:'专辑',albumid:'77',albumpic:'http://img2.kuwo.cn/star/albumcover/120/6/48/1.jpg',duration:'200'});
let passed=0;
async function test(name,fn){await fn();passed++;console.log('通过 '+name);}

await test('歌单多页导入：按 total 翻页拼全，字段映射正确',async()=>{
 const seen=[];
 const http={requestJson:async(url,opts)=>{
  seen.push(url);assert.equal(opts.platform,'kuwo');
  const q=new URL(url).searchParams,pn=Number(q.get('pn'));
  assert.equal(q.get('op'),'getlistinfo');assert.equal(q.get('pid'),'555');
  const rows=pn===0?Array.from({length:100},(_,i)=>row(i)):pn===1?[...Array.from({length:49},(_,i)=>row(100+i)),{id:'',name:'无 id'}]:[];
  return {title:'公开 &amp; 测试',pic:'http://img1.kuwo.cn/star/userpl2015/1/2/3_150.jpg',info:'第一行<br>第二行',total:150,musiclist:rows};
 }};
 const pl=await new KuwoAdapter(http,newStore()).fetchPlaylist('555');
 assert.equal(seen.length,2);
 assert.equal(pl.tracks.length,149);assert.equal(pl.platform,'kuwo');assert.equal(pl.id,'555');
 assert.equal(pl.name,'公开 & 测试');assert.equal(pl.cover,'http://img1.kuwo.cn/star/userpl2015/1/2/3_500.jpg');
 assert.equal(pl.description,'第一行\n第二行');
 const t=pl.tracks[0];
 assert.deepEqual([t.id,t.sourceId,t.platform,t.title,t.artist,t.album,t.duration,t.originalUrl],['kuwo:1000','1000','kuwo','歌0','歌手甲 / 歌手乙','专辑',200,'']);
 assert.deepEqual(t.artists,['歌手甲','歌手乙']);
 assert.equal(t.cover,'http://img2.kuwo.cn/star/albumcover/500/6/48/1.jpg');
 assert.equal(t.extra.albumId,'77');assert.equal(t.extra.durationSec,200);
});
await test('歌单为空 / ID 非法 / 接口异常都明确失败，不伪装成功',async()=>{
 const empty=new KuwoAdapter({requestJson:async()=>({total:0,musiclist:[]})},newStore());
 await assert.rejects(empty.fetchPlaylist('9'),/不存在|为空/);
 await assert.rejects(empty.fetchPlaylist('abc'),/无效/);
 await assert.rejects(new KuwoAdapter({requestJson:async()=>{throw new Error('HTTP 500');}},newStore()).fetchPlaylist('9'),/HTTP 500/);
});
await test('我的歌单：uid / sid 来自已存 cookie，系统占位列表被过滤',async()=>{
 let url='';
 const http={requestJson:async u=>{url=u;return {total:4,plist:[
  {id:1,title:'',type:'PC_DEFAULT',musicnum:0,pic:''},
  {id:2,title:'我喜欢听',type:'MYFAVORITE',musicnum:0,pic:''},
  {id:3,title:'跑步 &amp; 通勤',type:'GENERAL',musicnum:31,pic:'http://img1.kuwo.cn/star/userpl2015/1/2/3_150.jpg'},
  {id:4,title:'',type:'RADIO',musicnum:0},
 ]};}};
 const list=await new KuwoAdapter(http,newStore(LOGGED)).fetchMyPlaylists();
 const q=new URL(url).searchParams;
 assert.equal(q.get('op'),'getuserlist');assert.equal(q.get('uid'),'424242');assert.equal(q.get('sid'),'abc123');
 assert.deepEqual(list,[
  {id:'2',name:'我喜欢听',cover:'',trackCount:0},
  {id:'3',name:'跑步 & 通勤',cover:'http://img1.kuwo.cn/star/userpl2015/1/2/3_500.jpg',trackCount:31},
 ]);
 // 只有 websid 也能取
 await new KuwoAdapter(http,newStore('userid=7; websid=w9')).fetchMyPlaylists();
 assert.equal(new URL(url).searchParams.get('sid'),'w9');
});
await test('我的歌单：未登录 / cookie 不完整不发请求；网络失败返回 []',async()=>{
 let calls=0;const http={requestJson:async()=>{calls++;throw new Error('网络断了');}};
 assert.deepEqual(await new KuwoAdapter(http,newStore()).fetchMyPlaylists(),[]);
 assert.deepEqual(await new KuwoAdapter(http,newStore('userid=0; sid=x')).fetchMyPlaylists(),[]);
 assert.deepEqual(await new KuwoAdapter(http,newStore('userid=5')).fetchMyPlaylists(),[]);
 assert.equal(calls,0);
 assert.deepEqual(await new KuwoAdapter(http,newStore(LOGGED)).fetchMyPlaylists(),[]);assert.equal(calls,1);
});
await test('取链：请求 320k 但只有 128k 可放时自动降档（#229）',async()=>{
 const calls=[];
 const http={requestJson:async u=>{calls.push(new URL(u).searchParams.get('br'));
   // 320k / flac 都回提示音，只有 128k 回真地址
   return new URL(u).searchParams.get('br')==='128kmp3'
     ? {code:200,msg:'success',url:'https://kw-er.kuwo.cn/sig/ts/resource/30106/trackmedia/real.mp3'}
     : {code:200,url:'https://kw-bj.kuwo.cn/s/t/nf/resource/n1/69/32/588957081.mp3'};},
  requestRaw:async()=>({ok:true,status:206,headers:new Headers({'content-range':'bytes 0-0/3830799'}),text:''})};
 const a=new KuwoAdapter(http,newStore());
 const r=await a.fetchSongUrl('6304356',undefined,'320',{durationSec:239});
 assert.deepEqual(r,{url:'https://kw-er.kuwo.cn/sig/ts/resource/30106/trackmedia/real.mp3',quality:'128'});
 assert.deepEqual(calls,['320kmp3','128kmp3'],'先试 320k，拿到提示音再退 128k');
 assert.deepEqual((await a.listQualities()).map(x=>x.level),['flac','320','128']);
});
await test('取链：请求 flac 且确实拿到无损时不降档',async()=>{
 const http={requestJson:async u=>new URL(u).searchParams.get('br')==='2000kflac'
   ? {code:200,url:'https://kw-er.kuwo.cn/sig/ts/nf/resource/n1/1/9/flac.flac'}
   : {code:200,url:'https://kw-er.kuwo.cn/sig/ts/resource/x/128.mp3'},
  requestRaw:async()=>({ok:true,status:206,headers:new Headers({'content-range':'bytes 0-0/26000000'}),text:''})};
 const a=new KuwoAdapter(http,newStore());
 const r=await a.fetchSongUrl('6304356',undefined,'flac',{durationSec:239});
 assert.equal(r?.quality,'flac','flac 可用就必须用 flac，不能无脑退回 128');
});
await test('取链：高档位全部失败时逐档退到 128k，而不是直接放弃',async()=>{
 const tried=[];
 const http={requestJson:async u=>{const br=new URL(u).searchParams.get('br');tried.push(br);
   return br==='128kmp3'
     ? {code:200,url:'https://kw-er.kuwo.cn/sig/ts/resource/x/128.mp3'}
     : {code:200,url:''};},
  requestRaw:async()=>({ok:true,status:206,headers:new Headers({'content-range':'bytes 0-0/3400000'}),text:''})};
 const a=new KuwoAdapter(http,newStore());
 const r=await a.fetchSongUrl('6304356',undefined,'flac',{durationSec:239});
 assert.equal(r?.quality,'128');
 assert.deepEqual(tried,['2000kflac','320kmp3','128kmp3'],'按 flac → 320k → 128k 顺序降');
});
await test('取链：失败一律返回 null（接口拒绝 / 提示音 / 时长不符 / 异常 / 非法 rid）',async()=>{
 const ok='https://kw-bj.kuwo.cn/sig/ts/nf/resource/n1/1/2/12345.mp3';
 const mk=(json,range)=>new KuwoAdapter({requestJson:async()=>{if(json instanceof Error)throw json;return json;},
  requestRaw:async()=>{if(range instanceof Error)throw range;return {ok:true,status:206,headers:new Headers(range?{'content-range':range}:{}),text:''};}},newStore());
 assert.equal(await mk({code:-1,msg:'refuse request!',url:''}).fetchSongUrl('1'),null);
 assert.equal(await mk({code:200,url:''}).fetchSongUrl('1'),null);
 assert.equal(await mk({code:200,url:'https://kw-bj.kuwo.cn/s/t/nf/resource/n1/69/32/588957081.mp3'}).fetchSongUrl('1'),null);
 assert.equal(await mk({code:200,url:ok},'bytes 0-0/181521').fetchSongUrl('1',undefined,undefined,{durationSec:212}),null);
 assert.equal(await mk(new Error('timeout')).fetchSongUrl('1'),null);
 assert.equal(await mk({code:200,url:ok}).fetchSongUrl('abc'),null);
 // 时长缺失或总长探测失败时不拦截
 assert.equal((await mk({code:200,url:ok},'bytes 0-0/181521').fetchSongUrl('1'))?.url,ok);
 assert.equal((await mk({code:200,url:ok},new Error('探测失败')).fetchSongUrl('1',undefined,undefined,{durationSec:212}))?.url,ok);
 assert.equal((await mk({code:200,url:ok},'bytes 0-0/3400000').fetchSongUrl('1',undefined,undefined,{durationSec:212}))?.url,ok);
 assert.equal(await mk({code:200,url:ok}).fetchLyric('1'),null);
});
await test('cookie 校验：userid 非零数字 + sid / websid',()=>{
 const v=c=>validatePlatformCookie('kuwo',normalizeCookieHeader(c));
 assert.equal(v(LOGGED).ok,true);
 assert.equal(v('userid=1; sid=a').ok,true);
 assert.equal(v('userid=1; websid=a').ok,true);
 assert.equal(v('userid=0; sid=a').ok,false);
 assert.equal(v('userid=abc; sid=a').ok,false);
 assert.equal(v('sid=a; websid=b').ok,false);
 assert.equal(v('userid=1').ok,false);
 assert.equal(v('').ok,false);
 assert.match(v('userid=1').error,/INVALID_KUWO_COOKIE/);
 assert.deepEqual(parseKuwoSession('userid=9; websid=w'),{uid:'9',sid:'w'});
 assert.equal(parseKuwoSession('userid=00; sid=a'),null);
});
await test('链接识别：电脑 / 手机 / 分享各形式',()=>{
 const want={platform:'kuwo',id:'3678617986'};
 for(const u of [
  'https://www.kuwo.cn/playlist_detail/3678617986',
  'http://kuwo.cn/playlist_detail/3678617986?from=share',
  ' https://m.kuwo.cn/newh5app/playlist_detail/3678617986 ',
  'https://m.kuwo.cn/h5app/playlist?pid=3678617986&from=app',
  'http://h5app.kuwo.cn/m/x/index.html#/?pid=3678617986',
 ]) assert.deepEqual(resolveAdapterByUrl(u),want,u);
 assert.equal(resolveAdapterByUrl('https://www.kuwo.cn/singer_detail/123'),null);
 assert.equal(resolveAdapterByUrl('https://notkuwo.cn/playlist_detail/1'),null);
 assert.equal(resolveAdapterByUrl('https://example.com/?u=kuwo.cn&pid=1'),null);
 assert.deepEqual(resolveAdapterByUrl('https://music.163.com/#/playlist?id=1'),{platform:'netease',id:'1'});
});
await test('账号信息：无 cookie → null；残缺 → missing；完整 → 解码昵称与头像',async()=>{
 assert.equal(await new KuwoLogin(newStore()).getAccount(),null);
 assert.deepEqual(await new KuwoLogin(newStore('sid=x')).getAccount(),{loggedIn:false,authStatus:'missing',error:'酷我登录信息不完整，请重新登录'});
 const acc=await new KuwoLogin(newStore(LOGGED)).getAccount();
 assert.deepEqual(acc,{loggedIn:true,authStatus:'unknown',userId:'424242',nickname:'测试用户',avatarUrl:'http://img1.kuwo.cn/star/userhead/1.jpg'});
 assert.equal((await new KuwoLogin(newStore('userid=5; sid=a')).getAccount()).nickname,'酷我用户');
 // 官网实际写法（#184 实测）：昵称在 uname3，pic3 外面包一层双引号；微信头像 /132 换原图 /0 并升 https
 const real='userid=5; sid=a; uname3=%E5%BE%AE%E4%BF%A1%E7%94%A8%E6%88%B7; pic3=%22http%3A%2F%2Fthirdwx.qlogo.cn%2Fmmopen%2Fvi_32%2Fabc%2F132%22; t3=weixin';
 const a2=await new KuwoLogin(newStore(real)).getAccount();
 assert.equal(a2.nickname,'微信用户');assert.equal(a2.avatarUrl,'https://thirdwx.qlogo.cn/mmopen/vi_32/abc/0');
 assert.equal(kuwoAvatarUrl('"javascript:alert(1)"'),'');assert.equal(kuwoAvatarUrl(''),'');
});

await test('没有封面的歌单（我喜欢听）：只取第一首的专辑图补上；详情也用首歌封面兜底',async()=>{
 const seen=[];
 const http={requestJson:async url=>{seen.push(url);const q=new URL(url).searchParams;return {title:'我喜欢听',pic:'',total:2,musiclist:q.get('rn')==='5'?[{id:'1',name:'无图',albumpic:''},row(1)]:[row(1),row(2)]};}};
 const a=new KuwoAdapter(http,newStore(LOGGED));
 assert.equal(await a.fetchPlaylistFirstCover('9'),'http://img2.kuwo.cn/star/albumcover/500/6/48/1.jpg');
 assert.equal(new URL(seen[0]).searchParams.get('rn'),'5');
 assert.equal(await a.fetchPlaylistFirstCover('bad'),'');
 assert.equal((await a.fetchPlaylist('9')).cover,'http://img2.kuwo.cn/star/albumcover/500/6/48/1.jpg');
 assert.equal(firstTrackCover([{cover:''},{cover:'https://x/a.jpg'}]),'https://x/a.jpg');
 assert.equal(firstTrackCover([]),'');
});
await test('封面 / 音频域名：酷我保持 http，音频走 kuwo 代理白名单',()=>{
 assert.equal(kuwoCoverUrl('http://img2.kuwo.cn/star/albumcover/120/6/48/1.jpg'),'http://img2.kuwo.cn/star/albumcover/500/6/48/1.jpg');
 assert.equal(kuwoCoverUrl(''),'');
 assert.deepEqual(coverCandidates({platform:'kuwo',cover:'http://img2.kuwo.cn/star/albumcover/500/6/48/1.jpg'}),['http://img2.kuwo.cn/star/albumcover/500/6/48/1.jpg']);
 assert.equal(audioPlatform(new URL('https://kw-er.kuwo.cn/a/b/c.mp3')),'kuwo');
 assert.equal(audioPlatform(new URL('http://kw-bj.kuwo.cn/a.mp3')),'kuwo');
 assert.equal(audioPlatform(new URL('https://evilkuwo.cn/a.mp3')),null);
 assert.equal(mapKuwoMyPlaylists([{id:1,title:''}]).length,0);
});
/* ---------- #204 酷我 / 波点歌词（句子全部编造） ---------- */
const {parseKuwoLyric,decodeKuwoLyric,kuwoLyricUrl,fetchKuwoLyric,BodianAdapter,timedLines,lyricCoverage}=api;
const zlib=require('node:zlib');
const KEY=Buffer.from('yeelion'),xorB=b=>Buffer.from(b.map((v,i)=>v^KEY[i%KEY.length]));
const LRCX=['[ti:编的歌]','[kuwo:066]','[offset:0]',
 // k=066(八进制)=54 → k1=5、k2=4：起点=(a+b)/10，时长=(a-b)/8
 '[00:01.000]<0,0>编的<0,0>译文',
 '[00:01.000]<800,-800>编<1300,700>的<1700,1300>第一句',
 '[00:05.500]<400,-400>made <900,100>up <1400,600>line',
 '[00:09.000]<0,0>只有<0,0>翻译行',
 '[00:09.000]<0,0>',
 '[00:12.000]<0,0> <0,0> ',
 '[00:12.000]<600,-600>编的<1000,200>第三句',
].join('\n');
await test('#204 酷我 LRCX：[kuwo:八进制] 换算逐字时间；全是 <0,0> 的同时间行当翻译；空行跳过',()=>{
 const l=parseKuwoLyric(LRCX);
 assert.deepEqual(l.lines.map(x=>x.text),['编的第一句','made up line','编的第三句']);
 assert.equal(l.lines[0].translation,'编的译文');
 assert.equal(l.lines[2].translation,undefined,'空白翻译行不算');
 const w=timedLines(l.yrc);
 assert.deepEqual(w[0].words.map(x=>[x.text,x.startMs,x.duration]),[['编',1000,200],['的',1200,75],['第一句',1300,50]]);
 assert.deepEqual(w[1].words.map(x=>x.text),['made ','up ','line'],'英文词间空格留在前一个词末尾');
 assert.equal(lyricCoverage(l).wordLines,3);assert.equal(lyricCoverage(l).translatedLines,1);
 // 普通 LRC（没有逐字）：只有整句
 const plain=parseKuwoLyric('[00:01.00]编的整句\n[00:04.50]第二句');
 assert.equal(plain.lines.length,2);assert.equal(plain.yrc,undefined);
 assert.equal(parseKuwoLyric('[ti:只有头]'),null);
});
await test('#204 酷我歌词解码：请求参数异或 + base64；lrcx=1 时正文 zlib → base64 → 异或；格式不对返回 null',()=>{
 const url=new URL(kuwoLyricUrl('123'));
 assert.equal(url.host,'newlyric.kuwo.cn');
 assert.match(xorB(Buffer.from(url.search.slice(1),'base64')).toString(),/rid=MUSIC_123&lrcx=1$/);
 const text='[kuwo:066]\n[00:01.000]<800,-800>made <1300,700>up';
 const lrcx=Buffer.concat([Buffer.from('tp=content\r\nlrcx=1\r\n\r\n'),zlib.deflateSync(Buffer.from(xorB(Buffer.from(text)).toString('base64')))]);
 assert.equal(decodeKuwoLyric(lrcx),text);
 const plain=Buffer.concat([Buffer.from('tp=content\r\nlrcx=0\r\n\r\n'),zlib.deflateSync(Buffer.from('[00:01.00]made up'))]);
 assert.equal(decodeKuwoLyric(plain),'[00:01.00]made up');
 assert.equal(decodeKuwoLyric(Buffer.from('no header')),null);
 assert.equal(decodeKuwoLyric(Buffer.from('a=1\r\n\r\nnot-zlib')),null);
});
await test('#204 酷我、波点适配器都用同一个歌词接口：匿名（不带 cookie）、3 秒、非数字 id / 网络失败返回 null',async()=>{
 // 正文是 GB18030：「编的」= B1E0 B5C4
 const gb=Buffer.concat([Buffer.from('[kuwo:066]'+String.fromCharCode(10)+'[00:01.000]<800,-800>'),Buffer.from([0xb1,0xe0]),Buffer.from('<1300,700>'),Buffer.from([0xb5,0xc4])]);
 const body=Buffer.concat([Buffer.from('lrcx=1'+String.fromCharCode(13,10,13,10)),zlib.deflateSync(Buffer.from(xorB(gb).toString('base64')))]);
 const calls=[];
 const http={requestBytes:async(url,opts)=>{calls.push({url,opts});if(url.includes('fail'))throw new Error('x');return body;}};
 const k=new KuwoAdapter(http,newStore(LOGGED));
 assert.equal((await k.fetchLyric('42')).lines[0].text,'编的');
 assert.equal(calls[0].opts.cookie,'','不带登录信息');assert.equal(calls[0].opts.timeoutMs,3000);
 const b=new BodianAdapter(http,newStore());
 assert.equal((await b.fetchLyric('42')).lines[0].text,'编的');
 assert.equal(calls.length,2);
 assert.equal(await k.fetchLyric('abc'),null);assert.equal(calls.length,2,'非数字 id 不发请求');
 assert.equal(await fetchKuwoLyric({requestBytes:async()=>{throw new Error('net');}},'1'),null);
});

/* ---------- 搜索（跨平台兜底用，数据全部编造） ---------- */
const srow=(i,extra={})=>({DC_TARGETID:String(5000+i),MUSICRID:'MUSIC_'+(5000+i),NAME:`编的歌${i}`,SONGNAME:`编的歌${i} (Live)`,ARTIST:'歌手甲&amp;歌手乙',ALBUM:'专辑&nbsp;一',ALBUMID:'88',ARTISTID:'9',DURATION:'215',web_albumpic_short:'120/s3s94/93/1.jpg',...extra});
await test('搜索：匿名 https 网页接口；字段与歌单歌曲一致，HTML 实体解码，时长为秒，封面放大',async()=>{
 const calls=[];
 const http={requestJson:async(url,opts)=>{calls.push({url,opts});return {abslist:[srow(1),srow(2,{DC_TARGETID:'',MUSICRID:'MUSIC_777',SONGNAME:'',web_albumpic_short:''}),srow(3,{DC_TARGETID:'',MUSICRID:'bad'}),srow(4,{SONGNAME:'',NAME:''})]};}};
 const rows=await new KuwoAdapter(http,newStore(LOGGED)).searchSongs('编的歌 歌手甲',12);
 const u=new URL(calls[0].url);
 assert.equal(u.origin+u.pathname,'https://www.kuwo.cn/search/searchMusicBykeyWord');
 assert.equal(u.searchParams.get('all'),'编的歌 歌手甲');assert.equal(u.searchParams.get('rn'),'12');assert.equal(u.searchParams.get('pn'),'0');assert.equal(u.searchParams.get('rformat'),'json');
 assert.equal(calls[0].opts.platform,'kuwo');assert.equal(calls[0].opts.cookie,'','匿名：不带登录信息');
 assert.equal(rows.length,2,'无 id / 无标题的行丢掉');
 const t=rows[0];
 assert.deepEqual([t.id,t.sourceId,t.platform,t.title,t.artist,t.album,t.duration,t.originalUrl],['kuwo:5001','5001','kuwo','编的歌1 (Live)','歌手甲 / 歌手乙','专辑 一',215,'']);
 assert.deepEqual(t.artists,['歌手甲','歌手乙']);
 assert.equal(t.cover,'http://img1.kuwo.cn/star/albumcover/500/s3s94/93/1.jpg');
 assert.deepEqual([t.extra.albumId,t.extra.artistId,t.extra.durationSec],['88','9',215]);
 assert.deepEqual([rows[1].sourceId,rows[1].title,rows[1].cover],['777','编的歌2','']);
});
await test('搜索：失败 / 空词 / 无结果都返回 []，条数夹在 1..50',async()=>{
 let calls=0;const seen=[];
 const http={requestJson:async url=>{calls++;seen.push(new URL(url).searchParams.get('rn'));if(calls===1)throw new Error('HTTP 500');return {abslist:[]};}};
 const a=new KuwoAdapter(http,newStore());
 assert.deepEqual(await a.searchSongs('x'),[]);
 assert.deepEqual(await a.searchSongs('x',999),[]);assert.deepEqual(await a.searchSongs('x',0),[]);
 assert.deepEqual(seen,['10','50','10']);
 assert.deepEqual(await a.searchSongs('   '),[]);assert.equal(calls,3,'空词不发请求');
 assert.deepEqual(await new KuwoAdapter({requestJson:async()=>({})},newStore()).searchSongs('x'),[]);
 assert.deepEqual(await new KuwoAdapter({requestJson:async()=>({abslist:'坏'})},newStore()).searchSongs('x'),[]);
});
await test('会员：有 http 才查；到期晚于服务器时间才算；接口失败不影响登录态',async()=>{
 const NOW=1795140071384,vip=o=>({data:{time:String(NOW),vipExpire:'0',vipLuxuryExpire:'0',vip3Expire:'0',vipmExpire:'0',svipExpire:'0',vipAdExpire:String(NOW+1e9),...o},meta:{code:200}});
 const mk=reply=>{const calls=[];return {calls,http:{requestJson:async(url,opts)=>{calls.push({url,opts});if(reply instanceof Error)throw reply;return reply;}}};};
 let m=mk(vip({vipLuxuryExpire:String(NOW+1000)}));
 let acc=await new KuwoLogin(newStore(LOGGED),m.http).getAccount();
 assert.deepEqual([acc.isVip,acc.isSvip,acc.vipType,acc.loggedIn,acc.authStatus],[true,false,1,true,'unknown']);
 const q=new URL(m.calls[0].url);assert.equal(q.origin+q.pathname,'https://vip1.kuwo.cn/vip/v2/user/vip');assert.equal(q.searchParams.get('uid'),'424242');assert.equal(m.calls[0].opts.cookie,'');
 acc=await new KuwoLogin(newStore(LOGGED),mk(vip({svipExpire:String(NOW+1000)})).http).getAccount();assert.deepEqual([acc.isVip,acc.isSvip,acc.vipType],[true,true,2]);
 acc=await new KuwoLogin(newStore(LOGGED),mk(vip({vipExpire:String(NOW-1000)})).http).getAccount();assert.deepEqual([acc.isVip,acc.isSvip,acc.vipType],[false,false,0],'已过期不算；去广告会员不算');
 for(const bad of [new Error('timeout'),{meta:{code:500}},{meta:{code:200}},null]){
  acc=await new KuwoLogin(newStore(LOGGED),mk(bad).http).getAccount();
  assert.deepEqual([acc.loggedIn,acc.authStatus,'isVip' in acc],[true,'unknown',false]);
 }
 acc=await new KuwoLogin(newStore('sid=x'),m.http).getAccount();assert.equal(acc.authStatus,'missing');assert.equal(m.calls.length,1,'cookie 不完整不发请求');
});
await test('SongResolver 酷我档位透传：不再把 flac / 320 压死成 128',async()=>{
 const seen=[];
 const resolver=new api.SongResolver({
  kuwo:{fetchSongUrl:async(_id,_alb,q)=>{seen.push(q);return {url:'https://kw-er.kuwo.cn/sig/ts/resource/x/f.flac',quality:q};}},
 },()=>{});
 const tr={id:'kuwo:1',title:'歌',artist:'手',album:'',cover:'',duration:200,platform:'kuwo',sourceId:'1',originalUrl:'',fallbackUrl:''};
 const r1=await resolver.resolve(tr,'flac');
 const r2=await resolver.resolve({...tr,sourceId:'2'},'320');
 assert.equal(r1.quality,'flac');
 assert.equal(r2.quality,'320');
 assert.deepEqual(seen,['flac','320']);
});
await test('搜歌手：匿名 ft=artist 映射 ID / 歌手名 / 300px 头像（#322）',async()=>{
 const calls=[];
 const http={requestJson:async(u,o)=>{calls.push({u,o});return {abslist:[
  {ARTISTID:'336',ARTIST:'周杰伦',hts_PICPATH:'120/s4s56/58/291211030.jpg'},
  {ARTISTID:'bad',ARTIST:'无效'},
 ]};}};
 const hits=await new KuwoAdapter(http,newStore()).searchArtists('周杰伦',5);
 assert.equal(hits.length,1);
 assert.equal(hits[0].platform,'kuwo');
 assert.equal(hits[0].id,'336');
 assert.equal(hits[0].avatar,'http://img4.kuwo.cn/star/starheads/300/s4s56/58/291211030.jpg');
 assert.match(calls[0].u,/ft=artist/);
 assert.equal(calls[0].o.cookie,'');
});
console.log(`酷我回归 ${passed}/${passed}`);
