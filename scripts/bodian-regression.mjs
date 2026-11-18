import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
// 波点适配器 / 登录回归：假传输层，不联网（所有 ID、token 都是合成的）。依赖 pnpm build:main 产物。
const require=createRequire(import.meta.url);
const api=require('../dist-main/index.cjs');
const {CookieStore,BodianAdapter,BodianLogin,bodianSelfFromPlaylists,bodianSign,encodeBodianQuery,parseBodianSession,parseBodianPlaylistId,createAdapters,resolveAdapterByUrl,validatePlatformCookie,normalizeCookieHeader,coverCandidates,audioPlatform}=api;
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'bodian-regression-'));
let seq=0;
const UID='424242',TOKEN='0123456789abcdef0123456789abcdef',DEV='a'.repeat(32);
const LOGGED=`uid=${UID}; token=${TOKEN}; devid=${DEV}`;
const newStore=cookie=>{const s=new CookieStore(path.join(tmp,`c${++seq}.json`));if(cookie)s.set('bodian',cookie);return s;};
const md5=t=>crypto.createHash('md5').update(t,'utf8').digest('hex');
let passed=0;
async function test(name,fn){await fn();passed++;console.log('通过 '+name);}

/** 独立于实现的验签：直接用请求 URL 里实际发出的查询串（去掉末尾的 sign）按文档公式重算。 */
function checkSign(url,signBody=''){
 const u=new URL(url),raw=u.search.slice(1),i=raw.lastIndexOf('&sign=');
 assert.ok(i>0,'没有 sign');
 const query=raw.slice(0,i),sign=raw.slice(i+6);
 const seed='kuwotest'+[...query].filter(c=>/[A-Za-z0-9]/.test(c)).sort().join('')+(signBody?md5(signBody+'kuwotest'):'')+u.pathname;
 assert.equal(sign,md5(seed),'签名不符 '+u.pathname);
 return u.searchParams;
}
/** 假传输层：按路径分发；记录每次请求。handler 返回 JSON 对象，抛错 = 网络失败。 */
function fake(routes){
 const calls=[];
 const transport=async req=>{
  const u=new URL(req.url);calls.push({...req,path:u.pathname,q:u.searchParams});
  const h=routes[u.pathname];assert.ok(h,'未预期的请求 '+u.pathname);
  const out=await h(req,u.searchParams,calls.filter(c=>c.path===u.pathname).length);
  return {status:out?.__status??200,text:JSON.stringify(out?.__body??out)};
 };
 return {transport,calls};
};
const ok=data=>({code:200,msg:'success',data});
const track=i=>({id:900000+i,name:`歌${i}`,albumId:77,album:'专辑',albumPic:'https://img4.kuwo.cn/star/albumcover/800/a/b/1.webp',albumPic120:'https://img4.kuwo.cn/star/albumcover/240/a/b/1.webp',artist:'歌手甲',artistId:5,artists:[{id:5,name:'歌手甲'},{id:6,name:'歌手乙'}],duration:200+i});

await test('签名：Python 参考实现的固定向量 + 编码规则',()=>{
 // 向量由 PyBodian 的 _query_sign 算出（MIT）。
 assert.equal(bodianSign('/api/ucenter/login/qrCode',{uid:'-1',token:'',timestamp:'1700000000000'}),'17b8045ad51552cc07bf30c399c3e5f3');
 assert.equal(bodianSign('/api/ucenter/users/login',{uid:'-1',token:'',timestamp:'1700000000000'},'{"authType":10,"qrCode":"abc123"}'),'5480548d41253ab048d22034dd192e2d');
 // 空格 / + / ~ / ! / * / 中文 / 斜杠 / 等号都要按 Python urlencode 的方式编码后再参与签名
 assert.equal(bodianSign('/api/play/music/v2/checkRight',{uid:'12345',token:'a b+c~!*中',timestamp:'1700000000000',musicId:'226543302',freeSign:'x/y=='}),'63d6649bdbafa84af5ac06124db11fa2');
 assert.equal(encodeBodianQuery({a:'a b+c~!*中',b:1}),'a=a+b%2Bc~%21%2A%E4%B8%AD&b=1');
 // 按文档公式独立重算
 const params={uid:'7',token:'tk',timestamp:'1',z:'9'},q=new URLSearchParams(params).toString();
 const expect=md5('kuwotest'+[...q].filter(c=>/[A-Za-z0-9]/.test(c)).sort().join('')+md5('{"a":1}kuwotest')+'/p');
 assert.equal(bodianSign('/p',params,'{"a":1}'),expect);
 assert.notEqual(bodianSign('/p',params,'{"a":1}'),bodianSign('/p',params,''));
});
await test('登录凭证解析 / cookie 校验 / 歌单 ID 解析',()=>{
 assert.deepEqual(parseBodianSession(LOGGED),{uid:UID,token:TOKEN,devId:DEV});
 assert.deepEqual(parseBodianSession('uid=9; token=t'),{uid:'9',token:'t',devId:''});
 for(const bad of ['','uid=0; token=t','uid=abc; token=t','uid=9','token=t',null])assert.equal(parseBodianSession(bad),null,String(bad));
 const v=c=>validatePlatformCookie('bodian',normalizeCookieHeader(c));
 assert.equal(v(LOGGED).ok,true);assert.equal(v('uid=0; token=t').ok,false);assert.equal(v('uid=5').ok,false);assert.equal(v('').ok,false);
 assert.match(v('uid=5').error,/INVALID_BODIAN_COOKIE/);
 assert.deepEqual(parseBodianPlaylistId('102919156:5'),{id:'102919156',source:5});
 assert.deepEqual(parseBodianPlaylistId('55:4'),{id:'55',source:4});
 assert.deepEqual(parseBodianPlaylistId('55'),{id:'55',source:5});
 for(const bad of ['','abc','1:','1:x',':5','1:2:3'])assert.equal(parseBodianPlaylistId(bad),null,bad);
});
await test('二维码：取码带签名、未登录身份、统一请求头；二维码内容与图片',async()=>{
 const f=fake({'/api/ucenter/login/qrCode':()=>ok({qrCode:'qr0123456789abcd'})});
 const r=await new BodianLogin(newStore(),f.transport).createQr();
 const c=f.calls[0],q=checkSign(c.url);
 assert.equal(c.method,'GET');assert.equal(c.body,undefined);
 assert.equal(q.get('uid'),'-1');assert.equal(q.get('token'),'');assert.ok(/^\d{13}$/.test(q.get('timestamp')));
 assert.equal(c.headers['user-agent'],'Dart/3.3 (dart:io)');assert.equal(c.headers.plat,'win');assert.equal(c.headers.channel,'W1');
 assert.equal(c.headers.ver,'1.1.7');assert.equal(c.headers.svrver,'13');assert.equal(c.headers['api-ver'],'application/json');
 assert.match(c.headers.devid,/^[0-9a-f]{32}$/);assert.equal(c.headers.qimei36,c.headers.devid);
 assert.equal(r.unikey,'qr0123456789abcd');
 assert.equal(r.payload,'https://bodian-oia.kuwo.cn/bodian/download.html?pageName=login_pc&pt=3&id=qr0123456789abcd');
 assert.match(r.imageDataUrl,/^data:image\/png;base64,/);
 // 取码失败明确报错
 await assert.rejects(new BodianLogin(newStore(),fake({'/api/ucenter/login/qrCode':()=>({code:500,msg:'x'})}).transport).createQr(),/获取波点二维码失败/);
});
await test('扫码轮询：等待 / 过期 / 状态异常 / 网络波动都不落凭证',async()=>{
 let state=1,boom=false,code=200;
 const store=newStore();
 const f=fake({'/api/ucenter/login/qrCodeStatus':(_r,q)=>{if(boom)throw new Error('ECONNRESET');assert.equal(q.get('qrCode'),'QRX');return {code,msg:'',data:{status:state}};}});
 const login=new BodianLogin(store,f.transport);
 assert.deepEqual(await login.pollLogin('QRX'),{ok:false,message:'等待扫码…'});
 checkSign(f.calls[0].url);
 state=2;assert.deepEqual(await login.pollLogin('QRX'),{ok:false,message:'二维码已过期，请刷新'});
 state=9;assert.match((await login.pollLogin('QRX')).message,/已扫码，请在手机上确认/);
 code=500;assert.match((await login.pollLogin('QRX')).message,/状态异常.*500/);
 code=200;boom=true;const r=await login.pollLogin('QRX');assert.equal(r.ok,false);assert.match(r.message,/网络波动.*ECONNRESET/);
 assert.equal(store.has('bodian'),false);
});
await test('扫码确认：状态 3 → users/login（authType 10，体参与签名）换凭证 → 存 uid / token / devid / 昵称',async()=>{
 const store=newStore();
 const f=fake({
  '/api/ucenter/login/qrCodeStatus':()=>ok({status:3}),
  '/api/ucenter/users/login':req=>{assert.equal(req.method,'POST');return ok({id:777,token:TOKEN,userInfo:{nickname:'测试用户',authType:10},payInfo:{vipType:0}});},
 });
 const r=await new BodianLogin(store,f.transport).pollLogin('QRX');
 assert.deepEqual(r,{ok:true,message:'登录成功：测试用户',nickname:'测试用户'});
 const ex=f.calls[1];
 assert.equal(ex.body,'{"authType":10,"qrCode":"QRX"}');assert.equal(ex.headers['content-length'],String(Buffer.byteLength(ex.body)));
 const q=checkSign(ex.url,ex.body);assert.equal(q.get('uid'),'-1');assert.equal(q.get('token'),'');
 assert.ok(!ex.body.includes('"authType":9'));
 const rec=store.get('bodian');
 assert.equal(rec.nickname,'测试用户');
 const s=parseBodianSession(store.getHeader('bodian'));
 assert.deepEqual([s.uid,s.token],['777',TOKEN]);
 assert.equal(s.devId,ex.headers.devid);assert.match(s.devId,/^[0-9a-f]{32}$/);
 assert.equal(f.calls[0].headers.devid,ex.headers.devid); // 登录前后设备 ID 一致
});
await test('扫码确认：状态里直接带凭证不再换取；换取失败 / 凭证无效不落凭证',async()=>{
 const direct=newStore(),f=fake({'/api/ucenter/login/qrCodeStatus':()=>ok({status:3,uid:55,token:TOKEN,userInfo:{nickname:'直发'}})});
 const r=await new BodianLogin(direct,f.transport).pollLogin('Q');
 assert.equal(r.ok,true);assert.equal(f.calls.length,1);assert.equal(parseBodianSession(direct.getHeader('bodian')).uid,'55');
 const s1=newStore(),f1=fake({'/api/ucenter/login/qrCodeStatus':()=>ok({status:3}),'/api/ucenter/users/login':()=>({code:11001,msg:'失败'})});
 const r1=await new BodianLogin(s1,f1.transport).pollLogin('Q');
 assert.equal(r1.ok,false);assert.match(r1.message,/换取登录凭证失败/);assert.equal(s1.has('bodian'),false);
 const s2=newStore(),f2=fake({'/api/ucenter/login/qrCodeStatus':()=>ok({status:3}),'/api/ucenter/users/login':()=>ok({id:5,token:'bad token;x'})});
 assert.equal((await new BodianLogin(s2,f2.transport).pollLogin('Q')).ok,false);assert.equal(s2.has('bodian'),false);
 const s3=newStore(),f3=fake({'/api/ucenter/login/qrCodeStatus':()=>ok({status:3}),'/api/ucenter/users/login':()=>{throw new Error('timeout');}});
 const r3=await new BodianLogin(s3,f3.transport).pollLogin('Q');assert.equal(r3.ok,false);assert.match(r3.message,/网络波动/);assert.equal(s3.has('bodian'),false);
});
await test('账号信息：无凭证 null / 残缺 missing / 有效 valid / -101 expired / 其他 unknown',async()=>{
 assert.equal(await new BodianLogin(newStore(),fake({}).transport).getAccount(),null);
 assert.deepEqual(await new BodianLogin(newStore('foo=1'),fake({}).transport).getAccount(),{loggedIn:false,authStatus:'missing',error:'波点登录信息不完整，请重新登录'});
 // 资料取自自建歌单的作者字段：只认作者是本人的歌单；http 头像升 https；users/login 不再调用
 const lists={playLists:[
  {id:1,name:'别人的',creatorId:999,author:{id:999,name:'别人',icon:'http://thirdqq.qlogo.cn/x/other/100',isVip:1}},
  {id:2,name:'我喜欢',creatorId:Number(UID),creatorName:'平铺昵称',creatorIcon:'http://thirdqq.qlogo.cn/x/me/100',author:{id:Number(UID),name:'作者昵称',icon:'http://thirdqq.qlogo.cn/x/me/100',isVip:1}},
 ]};
 const f=fake({'/api/service/playlist/userCreate':()=>ok(lists)});
 const acc=await new BodianLogin(newStore(LOGGED),f.transport).getAccount();
 assert.deepEqual(acc,{loggedIn:true,authStatus:'valid',userId:UID,nickname:'作者昵称',avatarUrl:'https://thirdqq.qlogo.cn/x/me/100',vipType:1,isVip:true,isSvip:false});
 const uq=f.calls[0].q;assert.equal(uq.get('userId'),UID);assert.equal(uq.get('uid'),UID);assert.equal(uq.get('token'),TOKEN);assert.equal(f.calls[0].headers.devid,DEV);
 assert.equal(f.calls.length,1,'只请求一次 userCreate');
 // 只有平铺字段也能取到
 assert.deepEqual(bodianSelfFromPlaylists({playLists:[{creatorId:UID,creatorName:'平铺',creatorIcon:'https://img4.kuwo.cn/h.jpg'}]},UID),{nickname:'平铺',avatarUrl:'https://img4.kuwo.cn/h.jpg',isVip:false});
 // 没有自建歌单：有效判定不受影响，昵称回退到登录时存的，没有头像
 const s=newStore();s.set('bodian',LOGGED,undefined,'存的昵称');
 const a2=await new BodianLogin(s,fake({'/api/service/playlist/userCreate':()=>ok({playLists:[]})}).transport).getAccount();assert.equal(a2.authStatus,'valid');assert.equal(a2.nickname,'存的昵称');assert.equal(a2.avatarUrl,undefined);
 // 过期
 const exp=await new BodianLogin(newStore(LOGGED),fake({'/api/service/playlist/userCreate':()=>({code:-101,msg:'登录失效'})}).transport).getAccount();
 assert.deepEqual(exp,{loggedIn:false,authStatus:'expired',error:'波点登录已过期，请重新登录'});
 // 未知业务码 / 网络失败 / 非 JSON：保持登录，状态未知
 for(const h of [()=>({code:500,msg:'busy'}),()=>{throw new Error('ENOTFOUND');},()=>({__status:502,__body:'<html>'})]){
  const a=await new BodianLogin(newStore(LOGGED),fake({'/api/service/playlist/userCreate':h}).transport).getAccount();
  assert.equal(a.loggedIn,true);assert.equal(a.authStatus,'unknown');assert.equal(a.userId,UID);assert.equal(a.nickname,'波点用户');
 }
});
await test('账号信息：不再调用 users/login（读资料实测 HTTP 500），票据原样保留',async()=>{
 const f=fake({'/api/service/playlist/userCreate':()=>ok({playLists:[]}),'/api/ucenter/users/login':()=>{throw new Error('不该调用');}});
 const s=newStore(LOGGED);const a=await new BodianLogin(s,f.transport).getAccount();
 assert.equal(a.authStatus,'valid');assert.equal(f.calls.length,1);
 assert.deepEqual(parseBodianSession(s.getHeader('bodian')),{uid:UID,token:TOKEN,devId:DEV});
});
await test('我的歌单：红心第一 + 自建 + 收藏；专辑排除；过滤后为空的页不算结束；ID 带 source',async()=>{
 const pages={1:[{id:1,name:'专辑A',sourceType:6},{id:2,name:'专辑B',sourceType:6}],2:[{id:300,name:'收藏甲 &amp; 乙',pic:'http://img1.kwcdn.kuwo.cn/a_700.jpg',sourceType:4,musicCount:12},{id:1,name:'专辑C',sourceType:6}],3:[{id:301,name:'收藏丙',sourceType:4,musicCount:3}],4:[]};
 const f=fake({
  '/api/service/playlist/fond':()=>ok({id:100,name:'',pic:'http://img1.kwcdn.kuwo.cn/f.jpg',musicCount:8,sourceType:5}),
  '/api/service/playlist/userCreate':()=>ok({playLists:[{id:200,name:'自建一',pic:'https://img4.kuwo.cn/c.jpg',musicCount:5,isFond:0},{id:100,name:'我喜欢的音乐',isFond:1,musicCount:8},{id:201,name:'',musicCount:1}]}),
  '/api/service/collect/4/list':(_r,q)=>ok({total:99,playLists:pages[q.get('pn')]??[]}),
 });
 const list=await new BodianAdapter({},newStore(LOGGED),f.transport).fetchMyPlaylists();
 assert.deepEqual(list,[
  {id:'100:5',name:'我喜欢',cover:'http://img1.kwcdn.kuwo.cn/f.jpg',trackCount:8},
  {id:'200:5',name:'自建一',cover:'https://img4.kuwo.cn/c.jpg',trackCount:5},
  {id:'300:4',name:'收藏甲 & 乙',cover:'http://img1.kwcdn.kuwo.cn/a_700.jpg',trackCount:12},
  {id:'301:4',name:'收藏丙',cover:'',trackCount:3},
 ]);
 const cc=f.calls.filter(c=>c.path==='/api/service/collect/4/list');
 assert.deepEqual(cc.map(c=>c.q.get('pn')),['1','2','3','4']);
 assert.equal(cc[0].q.get('userId'),UID);assert.equal(cc[0].q.get('fromUid'),UID);assert.equal(cc[0].q.get('rn'),'50');assert.equal(cc[0].q.get('uid'),UID);assert.equal(cc[0].q.get('token'),TOKEN);
});
await test('我的歌单：未登录不发请求；登录失效 / 网络失败返回 []；红心接口失败不影响其他',async()=>{
 const none=fake({});assert.deepEqual(await new BodianAdapter({},newStore(),none.transport).fetchMyPlaylists(),[]);assert.equal(none.calls.length,0);
 assert.deepEqual(await new BodianAdapter({},newStore(LOGGED),fake({'/api/service/playlist/userCreate':()=>({code:-101,msg:'登录失效'})}).transport).fetchMyPlaylists(),[]);
 assert.deepEqual(await new BodianAdapter({},newStore(LOGGED),fake({'/api/service/playlist/userCreate':()=>{throw new Error('断网');}}).transport).fetchMyPlaylists(),[]);
 const f=fake({'/api/service/playlist/fond':()=>{throw new Error('x');},'/api/service/playlist/userCreate':()=>ok({playLists:[{id:5,name:'唯一'}]}),'/api/service/collect/4/list':()=>({code:500})});
 assert.deepEqual((await new BodianAdapter({},newStore(LOGGED),f.transport).fetchMyPlaylists()).map(p=>p.id),['5:5']);
});
await test('歌单详情：<id>:<source> 解析、多页 musicList 拼全、字段映射',async()=>{
 const rows=(from,n)=>Array.from({length:n},(_,i)=>track(from+i));
 const f=fake({
  '/api/service/playlist/info/555':(_r,q)=>{assert.equal(q.get('source'),'4');return ok({id:555,name:'公开 &amp; 测试',pic:'http://img1.kwcdn.kuwo.cn/p_700.jpg',description:'简介<br>x',musicCount:150});},
  '/api/service/playlist/555/musicList':(_r,q)=>{
   assert.equal(q.get('source'),'4');assert.equal(q.get('rn'),'100');const pn=Number(q.get('pn'));
   const list=pn===1?[...rows(0,99),{id:'',name:'无 id'}]:pn===2?rows(100,50):[];
   return ok({pageNum:pn,total:pn===1?150:0,list});
  },
 });
 const pl=await new BodianAdapter({},newStore(),f.transport).fetchPlaylist('555:4');
 assert.equal(f.calls.filter(c=>c.path.endsWith('/musicList')).length,2); // 读到 total 就停，不多请求一页
 assert.deepEqual([pl.id,pl.platform,pl.name,pl.cover,pl.description],['555:4','bodian','公开 & 测试','http://img1.kwcdn.kuwo.cn/p_700.jpg','简介x']);
 assert.equal(pl.tracks.length,149);
 const t=pl.tracks[0];
 assert.deepEqual([t.id,t.sourceId,t.platform,t.title,t.artist,t.album,t.duration,t.originalUrl,t.fallbackUrl],['bodian:900000','900000','bodian','歌0','歌手甲 / 歌手乙','专辑',200,'','']);
 assert.deepEqual(t.artists,['歌手甲','歌手乙']);assert.equal(t.cover,'https://img4.kuwo.cn/star/albumcover/800/a/b/1.webp');
 assert.deepEqual(t.extra,{albumId:'77',artistId:'5',durationSec:200});
 // 未登录读公开歌单：uid -1 / token 空
 const q0=f.calls[0].q;assert.equal(q0.get('uid'),'-1');assert.equal(q0.get('token'),'');
 // 登录后带身份（读私密歌单）
 const g=fake({'/api/service/playlist/info/9':()=>ok({}),'/api/service/playlist/9/musicList':(_r,q)=>{assert.equal(q.get('source'),'5');assert.equal(q.get('uid'),UID);return ok({list:Number(q.get('pn'))===1?[{...track(1),freeSign:'fs%2Bx'},{...track(2),fsig:'raw'}]:[]});}});
 const p2=await new BodianAdapter({},newStore(LOGGED),g.transport).fetchPlaylist('9'); // 没有 source → 5
 assert.equal(p2.id,'9:5');assert.equal(p2.name,'波点歌单 9');
 assert.equal(p2.tracks[0].extra.freeSign,'fs%2Bx');assert.equal(p2.tracks[1].extra.freeSign,'raw');
 assert.equal(g.calls.filter(c=>c.path.endsWith('/musicList')).length,2); // total 未知：翻到空页为止
});
await test('歌单详情：无效 ID / 空歌单 / 接口错误 / 网络失败都明确失败',async()=>{
 const empty=new BodianAdapter({},newStore(),fake({'/api/service/playlist/info/9':()=>ok({}),'/api/service/playlist/9/musicList':()=>ok({list:[]})}).transport);
 await assert.rejects(empty.fetchPlaylist('9:5'),/不存在|为空/);
 await assert.rejects(empty.fetchPlaylist('abc'),/无效/);
 await assert.rejects(new BodianAdapter({},newStore(),fake({'/api/service/playlist/info/9':()=>ok({}),'/api/service/playlist/9/musicList':()=>({code:-10,msg:'参数错误'})}).transport).fetchPlaylist('9'),/错误码 -10/);
 await assert.rejects(new BodianAdapter({},newStore(),fake({'/api/service/playlist/info/9':()=>{throw new Error('x');},'/api/service/playlist/9/musicList':()=>{throw new Error('断网');}}).transport).fetchPlaylist('9'),/断网/);
 // 分页上限：永远不空也会停
 const endless=fake({'/api/service/playlist/info/9':()=>ok({}),'/api/service/playlist/9/musicList':()=>ok({list:[track(1)]})});
 await new BodianAdapter({},newStore(),endless.transport).fetchPlaylist('9');
 assert.ok(endless.calls.length<=61);
});
const RIGHT_OK=()=>ok({status:1});
const AUDIO_OK=(_r,q)=>ok({audioHttpsUrl:`https://ga-sycdn.kuwo.cn/s/${q.get('br')}.mp3`,audioUrl:'http://x.kuwo.cn/a.mp3'});
await test('取链：成功——checkRight + audioUrl 都是带体 GET、体不参与签名、audioUrl 带 uid/token 头',async()=>{
 const f=fake({'/api/play/music/v2/checkRight':RIGHT_OK,'/api/play/music/v2/audioUrl':AUDIO_OK});
 const a=new BodianAdapter({},newStore(LOGGED),f.transport);
 const r=await a.fetchSongUrl('226543302',undefined,'flac',{freeSign:'a%2Fb%3D'});
 assert.deepEqual(r,{url:'https://ga-sycdn.kuwo.cn/s/2000kflac.mp3',quality:'flac'});
 const [c1,c2]=f.calls;
 for(const c of [c1,c2]){assert.equal(c.method,'GET');const q=checkSign(c.url,'');assert.equal(q.get('uid'),UID);assert.equal(q.get('token'),TOKEN);assert.equal(q.get('freeSign'),'a/b=');assert.equal(q.get('musicId'),'226543302');assert.equal(c.headers.devid,DEV);}
 // 体确实没参与签名：带体算出来的签名不同
 assert.notEqual(new URL(c1.url).searchParams.get('sign'),bodianSign('/api/play/music/v2/checkRight',Object.fromEntries([...new URL(c1.url).searchParams].filter(([k])=>k!=='sign')),c1.body));
 assert.equal(c1.body,'{"musicId":226543302,"freeSign":"a/b="}');
 assert.equal(c2.body,`{"devId":"${DEV}","musicId":226543302,"format":"flac","br":"2000kflac","freeSign":"a/b="}`);
 assert.equal(c2.q.get('devId'),DEV);assert.equal(c2.q.get('format'),'flac');assert.equal(c2.q.get('br'),'2000kflac');
 assert.equal(c2.headers.uid,UID);assert.equal(c2.headers.token,TOKEN);
 assert.equal(c2.headers['content-length'],String(Buffer.byteLength(c2.body)));
 // 没有 https 地址时用 audioUrl；档位映射 mp3
 const f2=fake({'/api/play/music/v2/checkRight':()=>ok({status:4}),'/api/play/music/v2/audioUrl':()=>ok({audioUrl:'http://a.kuwo.cn/x.mp3'})});
 assert.deepEqual(await new BodianAdapter({},newStore(LOGGED),f2.transport).fetchSongUrl('1',undefined,'128'),{url:'http://a.kuwo.cn/x.mp3',quality:'128'});
 assert.equal(f2.calls[1].q.get('br'),'128kmp3');assert.equal(f2.calls[1].q.get('format'),'mp3');
 // 默认从 320 起
 const f3=fake({'/api/play/music/v2/checkRight':RIGHT_OK,'/api/play/music/v2/audioUrl':AUDIO_OK});
 assert.equal((await new BodianAdapter({},newStore(LOGGED),f3.transport).fetchSongUrl('1')).quality,'320');
 assert.equal(f3.calls[1].q.get('br'),'320kmp3');
});
await test('取链：请求的档位拿不到时依次降档；全部失败返回 null',async()=>{
 const f=fake({'/api/play/music/v2/checkRight':RIGHT_OK,'/api/play/music/v2/audioUrl':(_r,q)=>q.get('format')==='flac'?{code:20018,msg:'没有解锁付费歌曲'}:AUDIO_OK(_r,q)});
 const r=await new BodianAdapter({},newStore(LOGGED),f.transport).fetchSongUrl('1',undefined,'flac');
 assert.equal(r.quality,'320');assert.deepEqual(f.calls.filter(c=>c.path.endsWith('audioUrl')).map(c=>c.q.get('br')),['2000kflac','320kmp3']);
 const none=fake({'/api/play/music/v2/checkRight':RIGHT_OK,'/api/play/music/v2/audioUrl':()=>({code:20018,msg:'没有解锁付费歌曲'})});
 assert.equal(await new BodianAdapter({},newStore(LOGGED),none.transport).fetchSongUrl('1',undefined,'flac'),null);
 assert.equal(none.calls.filter(c=>c.path.endsWith('audioUrl')).length,3);
});
await test('取链：试听(3) / 缺权益(7) / 未知状态 / 接口错误 / 地址非法 / 网络失败 / 无登录 / 非法 ID 都返回 null',async()=>{
 const audio=fake({'/api/play/music/v2/checkRight':()=>ok({status:3,audition:{https:'https://ga-sycdn.kuwo.cn/audition.mp3',duration:244}}),'/api/play/music/v2/audioUrl':AUDIO_OK});
 assert.equal(await new BodianAdapter({},newStore(LOGGED),audio.transport).fetchSongUrl('1',undefined,'320'),null);
 assert.equal(audio.calls.length,1); // 试听不继续取链，更不会把试听当整曲
 for(const status of [7,0,9,undefined]){
  const f=fake({'/api/play/music/v2/checkRight':()=>ok({status}),'/api/play/music/v2/audioUrl':AUDIO_OK});
  assert.equal(await new BodianAdapter({},newStore(LOGGED),f.transport).fetchSongUrl('1'),null,String(status));assert.equal(f.calls.length,1);
 }
 assert.equal(await new BodianAdapter({},newStore(LOGGED),fake({'/api/play/music/v2/checkRight':()=>({code:500,msg:'x'})}).transport).fetchSongUrl('1'),null);
 assert.equal(await new BodianAdapter({},newStore(LOGGED),fake({'/api/play/music/v2/checkRight':RIGHT_OK,'/api/play/music/v2/audioUrl':()=>ok({audioHttpsUrl:'javascript:alert(1)'})}).transport).fetchSongUrl('1'),null);
 assert.equal(await new BodianAdapter({},newStore(LOGGED),fake({'/api/play/music/v2/checkRight':()=>{throw new Error('断网');}}).transport).fetchSongUrl('1'),null);
 assert.equal(await new BodianAdapter({},newStore(LOGGED),fake({'/api/play/music/v2/checkRight':RIGHT_OK,'/api/play/music/v2/audioUrl':()=>{throw new Error('超时');}}).transport).fetchSongUrl('1'),null);
 const noLogin=fake({});
 assert.equal(await new BodianAdapter({},newStore(),noLogin.transport).fetchSongUrl('1'),null);
 assert.equal(await new BodianAdapter({},newStore('uid=0; token=t'),noLogin.transport).fetchSongUrl('1'),null);
 assert.equal(await new BodianAdapter({},newStore(LOGGED),noLogin.transport).fetchSongUrl('abc'),null);
 assert.equal(noLogin.calls.length,0);
});
await test('取链：地区限制 407 返回 null、只记一次日志、不清登录',async()=>{
 const warns=[],orig=console.warn;console.warn=(...a)=>warns.push(a.join(' '));
 try{
  const store=newStore(LOGGED);
  const a=new BodianAdapter({},store,fake({'/api/play/music/v2/checkRight':()=>({code:407,msg:'region'})}).transport);
  assert.equal(await a.fetchSongUrl('1'),null);assert.equal(await a.fetchSongUrl('2'),null);
  const b=new BodianAdapter({},store,fake({'/api/play/music/v2/checkRight':RIGHT_OK,'/api/play/music/v2/audioUrl':()=>({code:407,msg:'region'})}).transport);
  assert.equal(await b.fetchSongUrl('1'),null);assert.equal(await b.fetchSongUrl('2'),null);
  assert.equal(warns.filter(w=>w.includes('407')).length,2); // 每个适配器实例一次
  assert.equal(store.has('bodian'),true);
 }finally{console.warn=orig;}
});
await test('接入：createAdapters 含 bodian；歌词 null；音质；链接识别（分享页 → bodian，酷我链接仍是 kuwo）',async()=>{
 const adapters=createAdapters({},newStore());
 assert.equal(adapters.bodian.platform,'bodian');assert.equal(await adapters.bodian.fetchLyric('1'),null);
 assert.equal(adapters.bodian.searchSongs,undefined);
 assert.deepEqual((await adapters.bodian.listQualities()).map(q=>q.level),['128','320','flac']);
 const share=(q)=>`https://h5app.kuwo.cn/m/bodian/collection.html?${q}`;
 assert.deepEqual(resolveAdapterByUrl(share('uid=111&playlistId=222&source=4&ownerId=')),{platform:'bodian',id:'222:4'});
 assert.deepEqual(resolveAdapterByUrl(share('uid=111&playlistId=222&source=&ownerId=')),{platform:'bodian',id:'222:5'});
 assert.deepEqual(resolveAdapterByUrl(share('playlistId=222')),{platform:'bodian',id:'222:5'});
 assert.deepEqual(resolveAdapterByUrl(' '+share('ownerId=&source=4&playlistId=222')+' '),{platform:'bodian',id:'222:4'});
 assert.equal(resolveAdapterByUrl(share('uid=1')),null);
 assert.deepEqual(resolveAdapterByUrl('https://www.kuwo.cn/playlist_detail/3678617986'),{platform:'kuwo',id:'3678617986'});
 assert.deepEqual(resolveAdapterByUrl('https://m.kuwo.cn/h5app/playlist?pid=3678617986&from=app'),{platform:'kuwo',id:'3678617986'});
 assert.deepEqual(resolveAdapterByUrl('http://h5app.kuwo.cn/m/x/index.html#/?pid=3678617986'),{platform:'kuwo',id:'3678617986'});
 assert.equal(resolveAdapterByUrl('https://example.com/bodian/collection.html?playlistId=1&u=kuwo.cn'),null);
});
await test('封面 / 音频域名：波点封面保持原协议；*.kuwo.cn 音频走代理白名单',()=>{
 assert.deepEqual(coverCandidates({platform:'bodian',cover:'http://img1.kwcdn.kuwo.cn/star/userpl2015/1/2/3_700.jpg'}),['http://img1.kwcdn.kuwo.cn/star/userpl2015/1/2/3_700.jpg']);
 assert.deepEqual(coverCandidates({platform:'bodian',cover:'https://img4.kuwo.cn/star/albumcover/800/a/b/1.webp'}),['https://img4.kuwo.cn/star/albumcover/800/a/b/1.webp']);
 assert.equal(audioPlatform(new URL('https://ga-sycdn.kuwo.cn/a/b.mp3')),'kuwo');
});
console.log(`波点回归 ${passed}/${passed}`);
