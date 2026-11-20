import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
// 酷狗手机端扫码登录回归：假 http，不联网。依赖 pnpm build:main 产物。
const require=createRequire(import.meta.url);
const api=require('../dist-main/index.cjs');
const {CookieStore,KugouAdapter,KugouLogin,kugouWebSign,kugouMobileSign,parseKugouVip,parseKugouQrStatus,parseKugouTicket,KugouApiError}=api;
const md5=s=>crypto.createHash('md5').update(s).digest('hex');
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'kugou-regression-'));
let seq=0;
const newStore=cookie=>{const s=new CookieStore(path.join(tmp,`c${++seq}.json`));if(cookie)s.set('kugou',cookie);return s;};
const MOBILE_COOKIE='t=fixture-token; KugooID=42; kg_mid=123456; kg_dfid=fixture-dfid; kg_client=mobile';
const WEB_COOKIE='t=fixture-web-token; KugooID=77; kg_mid=999; kg_dfid=-';
const query=url=>Object.fromEntries(new URL(url).searchParams.entries());
const withoutSig=q=>{const {signature,...rest}=q;return rest;};
const fixed={dfid:'-',mid:'123456',uuid:'-',appid:'1005',clientver:'20489',clienttime:'1700000000',token:'tok',userid:'42',plat:'1'};
const fixedBody=JSON.stringify({userid:'42',token:'tok',total_ver:979,type:2,page:1,pagesize:50});
let passed=0;
async function test(name,fn){await fn();passed++;console.log('通过 '+name);}

await test('网页签名与手机端签名固定输入输出（期望值由 KuGouMusicApi 的 helper 语义独立算出）',()=>{
 assert.equal(kugouWebSign(fixed),'9e91fe588fea0747f9a889d5a92e3d40');
 assert.equal(kugouWebSign(fixed,fixedBody),'2a8b4e734321f8a7de200f89cc793765');
 assert.equal(kugouMobileSign(fixed),'d5d483a6e9963b976e0f46c4f8d0a2fb');
 assert.equal(kugouMobileSign(fixed,fixedBody),'696586fd0b7c0ab5dc80fa656d3e44dd');
});
await test('手机端签名直接拼接，不是旧 androidSign 的 & 拼接',()=>{
 const salt='OIlwieks28dk2k092lksi2UIkp';
 const amp=md5(salt+Object.keys(fixed).sort().map(k=>k+'='+fixed[k]).join('&')+fixedBody+salt);
 assert.notEqual(kugouMobileSign(fixed,fixedBody),amp);
 assert.equal(kugouMobileSign(fixed,fixedBody),md5(salt+Object.keys(fixed).sort().map(k=>k+'='+fixed[k]).join('')+fixedBody+salt));
 // 数字值与字符串值签名一致
 assert.equal(kugouMobileSign({a:1,b:2}),kugouMobileSign({a:'1',b:'2'}));
});
await test('二维码各状态解析：过期 / 等待 / 已扫待确认 / 成功 / 未知',()=>{
 assert.deepEqual(parseKugouQrStatus({data:{status:0}}),{state:'expired'});
 assert.deepEqual(parseKugouQrStatus({data:{status:1}}),{state:'waiting'});
 assert.deepEqual(parseKugouQrStatus({data:{status:2}}),{state:'scanned'});
 const ok=parseKugouQrStatus({data:{status:4,token:'tk',userid:123,nickname:'昵称'}});
 assert.deepEqual(ok,{state:'success',token:'tk',userid:'123',nickname:'昵称'});
 assert.equal(parseKugouQrStatus({data:{status:4,token:'',userid:1}}).state,'unknown');
 assert.equal(parseKugouQrStatus({data:{status:4,token:'tk',userid:0}}).state,'unknown');
 assert.equal(parseKugouQrStatus({status:0,error_code:20006}).state,'unknown');
 assert.equal(parseKugouQrStatus(null).state,'unknown');
});
await test('已有取票据逻辑读得到扫码写入的字段，并识别手机端标记',()=>{
 const t=parseKugouTicket(MOBILE_COOKIE);
 assert.deepEqual({...t},{userid:'42',token:'fixture-token',mid:'123456',dfid:'fixture-dfid',mobile:true});
 assert.equal(parseKugouTicket(WEB_COOKIE).mobile,false);
 assert.equal(parseKugouTicket('KugooID=1'),null);
 assert.equal(parseKugouTicket(''),null);
});
await test('createQr：网页签名、appid=1001、二维码内容带 appid=1005，并本地生成图片',async()=>{
 const calls=[];
 const http={requestJson:async(url,o)=>{calls.push({url,o});return {status:1,error_code:0,data:{qrcode:'fixturekey1001'}}}};
 const login=new KugouLogin(newStore(),http);
 const qr=await login.createQr();
 assert.equal(qr.unikey,'fixturekey1001');
 assert.equal(qr.payload,'https://h5.kugou.com/apps/loginQRCode/html/index.html?appid=1005&qrcode=fixturekey1001');
 assert.match(qr.imageDataUrl,/^data:image\/png;base64,/);
 const u=new URL(calls[0].url);
 assert.equal(u.origin+u.pathname,'https://login-user.kugou.com/v2/qrcode');
 const q=query(calls[0].url);
 assert.equal(q.appid,'1001');assert.equal(q.type,'1');assert.equal(q.plat,'4');assert.equal(q.srcappid,'2919');
 assert.equal(q.qrcode_txt,'https://h5.kugou.com/apps/loginQRCode/html/index.html?appid=1005&');
 assert.equal(q.uuid,'-');assert.equal(q.clientver,'20489');
 assert.equal(q.signature,kugouWebSign(withoutSig(q)));
 assert.equal(calls[0].o.headers['User-Agent'],'Android15-1070-11083-46-0-DiscoveryDRADProtocol-wifi');
 assert.equal(calls[0].o.cookie,'');
 await assert.rejects(()=>new KugouLogin(newStore(),{requestJson:async()=>({status:0,error_code:20006})}).createQr(),/20006/);
});
await test('pollLogin：各状态文案；成功后存 token/userid/mid/dfid 与手机端标记，mid 与取码时一致',async()=>{
 const store=newStore();
 const responses=[{data:{status:1}},{data:{status:2}},{data:{status:0}}];
 const urls=[];
 let phase='create';
 const http={requestJson:async(url)=>{
  urls.push(url);
  if(url.includes('/v2/qrcode'))return {status:1,data:{qrcode:'k1'}};
  if(phase==='success')return {status:1,error_code:0,data:{status:4,token:'new-token',userid:555,nickname:'测试昵称'}};
  return responses.shift();
 }};
 const login=new KugouLogin(store,http);
 await login.createQr();
 const midAtCreate=query(urls[0]).mid;
 assert.equal((await login.pollLogin('k1')).message,'等待扫码…');
 assert.equal((await login.pollLogin('k1')).message,'已扫码，请在手机上确认');
 const q=query(urls[1]);
 assert.equal(new URL(urls[1]).pathname,'/v2/get_userinfo_qrcode');
 assert.equal(q.plat,'4');assert.equal(q.appid,'1005');assert.equal(q.srcappid,'2919');assert.equal(q.qrcode,'k1');
 assert.equal(q.mid,midAtCreate);
 assert.equal(q.signature,kugouWebSign(withoutSig(q)));
 const expired=await login.pollLogin('k1');
 assert.equal(expired.ok,false);assert.match(expired.message,/过期/);
 assert.equal(store.has('kugou'),false);
 phase='success';
 const okSession=new KugouLogin(store,http);
 await okSession.createQr();
 const mid2=query(urls[urls.length-1]).mid;
 const done=await okSession.pollLogin('k1');
 assert.equal(done.ok,true);assert.match(done.message,/登录成功/);
 const t=parseKugouTicket(store.get('kugou').cookies);
 assert.deepEqual({...t},{userid:'555',token:'new-token',mid:mid2,dfid:'-',mobile:true});
 assert.equal(store.get('kugou').nickname,'测试昵称');
});
await test('pollLogin 网络异常不抛出也不写入票据',async()=>{
 const store=newStore();
 const login=new KugouLogin(store,{requestJson:async()=>{throw Error('fixture-network')}});
 const r=await login.pollLogin('k');
 assert.equal(r.ok,false);assert.match(r.message,/网络波动/);
 assert.equal(store.has('kugou'),false);
});
await test('getAccount：20017 判过期（loggedIn=false, authStatus=expired）',async()=>{
 const http={requestJson:async()=>({status:0,error_code:20017})};
 const a=await new KugouLogin(newStore(MOBILE_COOKIE),http).getAccount();
 assert.equal(a.loggedIn,false);assert.equal(a.authStatus,'expired');assert.equal(a.error,'酷狗登录已过期，请重新登录');
 const web=await new KugouLogin(newStore(WEB_COOKIE),http).getAccount();
 assert.equal(web.loggedIn,false);assert.equal(web.authStatus,'expired');
});
await test('getAccount：网络异常不判登出（authStatus=unknown，保持已登录）',async()=>{
 const a=await new KugouLogin(newStore(MOBILE_COOKIE),{requestJson:async()=>{throw Error('fixture-network')}}).getAccount();
 assert.equal(a.loggedIn,true);assert.equal(a.authStatus,'unknown');assert.equal(a.userId,'42');assert.equal(a.nickname,'酷狗用户');
});
await test('getAccount：签名错误（20006）等非票据错误码不判过期',async()=>{
 const a=await new KugouLogin(newStore(MOBILE_COOKIE),{requestJson:async()=>({status:0,error_code:20006})}).getAccount();
 assert.equal(a.loggedIn,true);assert.equal(a.authStatus,'unknown');
});
await test('getAccount：核验成功返回真实昵称；无 cookie 为 null；缺票据为 missing',async()=>{
 const http={requestJson:async()=>({status:1,error_code:0,data:{info:[
  {listid:1,name:'别人的收藏',list_create_userid:9,list_create_username:'路人'},
  {listid:2,name:'我喜欢',list_create_userid:42,list_create_username:'真实昵称'}]}})};
 const a=await new KugouLogin(newStore(MOBILE_COOKIE),http).getAccount();
 assert.equal(a.loggedIn,true);assert.equal(a.authStatus,'valid');assert.equal(a.nickname,'真实昵称');assert.equal(a.userId,'42');
 assert.equal(await new KugouLogin(newStore(),http).getAccount(),null);
 const missing=await new KugouLogin(newStore('KugooID=42'),http).getAccount();
 assert.equal(missing.loggedIn,false);assert.equal(missing.authStatus,'missing');
});
await test('getAccount：手机端票据用手机端参数核验',async()=>{
 const calls=[];
 const http={requestJson:async(url,o)=>{calls.push({url,o});return {status:1,data:{info:[]}}}};
 await new KugouLogin(newStore(MOBILE_COOKIE),http).getAccount();
 const q=query(calls[0].url);
 assert.equal(q.appid,'1005');assert.equal(q.clientver,'20489');assert.equal(q.uuid,'-');
 assert.equal(q.signature,kugouMobileSign(withoutSig(q),JSON.stringify(calls[0].o.body)));
});
await test('手机端票据下「我的歌单」请求用手机端参数、手机端签名和手机端请求头',async()=>{
 const calls=[];
 const http={requestJson:async(url,o)=>{calls.push({url,o});return {status:1,error_code:0,data:{info:[
  {global_collection_id:'collection_3_42_7_0',name:'我喜欢',count:12,pic:'http://x/{size}/a.jpg'},
  {listid:5,name:'<b>跑步</b>',songcount:3}]}}}};
 const adapter=new KugouAdapter(http,newStore(MOBILE_COOKIE));
 const lists=await adapter.fetchMyPlaylists();
 assert.deepEqual(lists.map(l=>[l.id,l.name,l.trackCount]),[['collection_3_42_7_0','我喜欢',12],['5','跑步',3]]);
 assert.equal(lists[0].cover,'https://x/0/a.jpg');
 assert.equal(adapter.lastPlaylistError,null);
 const {url,o}=calls[0];
 const u=new URL(url);
 assert.equal(u.origin+u.pathname,'https://gateway.kugou.com/v7/get_all_list');
 const q=query(url);
 assert.equal(q.appid,'1005');assert.equal(q.clientver,'20489');assert.equal(q.uuid,'-');assert.equal(q.plat,'1');
 assert.equal(q.token,'fixture-token');assert.equal(q.userid,'42');assert.equal(q.mid,'123456');assert.equal(q.dfid,'fixture-dfid');
 assert.equal(q.srcappid,undefined);
 assert.match(q.clienttime,/^\d{10}$/);
 assert.deepEqual(o.body,{userid:'42',token:'fixture-token',total_ver:979,type:2,page:1,pagesize:50});
 assert.equal(q.signature,kugouMobileSign(withoutSig(q),JSON.stringify(o.body)));
 assert.notEqual(q.signature,kugouWebSign(withoutSig(q),JSON.stringify(o.body)));
 assert.equal(o.method,'POST');assert.equal(o.cookie,'');
 assert.equal(o.headers['x-router'],'cloudlist.service.kugou.com');
 assert.equal(o.headers['User-Agent'],'Android15-1070-11083-46-0-DiscoveryDRADProtocol-wifi');
 assert.equal(o.headers.dfid,'fixture-dfid');assert.equal(o.headers.mid,'123456');assert.equal(o.headers.clienttime,q.clienttime);
 assert.equal(o.headers['kg-rc'],'1');assert.equal(o.headers['kg-thash'],'5d816a0');assert.equal(o.headers['kg-rec'],'1');
 assert.equal(o.headers['kg-rf'],'B9EDA08A64250DEFFBCADDEE00F8F25F');
});
await test('网页票据老用户：「我的歌单」保持网页协议（appid=1014 + 网页签名），不崩',async()=>{
 const calls=[];
 const http={requestJson:async(url,o)=>{calls.push({url,o});return {status:1,data:{info:[{listid:9,name:'旧歌单',count:1}]}}}};
 const lists=await new KugouAdapter(http,newStore(WEB_COOKIE)).fetchMyPlaylists();
 assert.equal(lists.length,1);
 const q=query(calls[0].url);
 assert.equal(q.appid,'1014');assert.equal(q.srcappid,'2919');assert.equal(q.clientver,'20000');
 assert.equal(q.signature,kugouWebSign(withoutSig(q),JSON.stringify(calls[0].o.body)));
 assert.equal(calls[0].o.headers['User-Agent'],undefined);
});
await test('status=0 不再静默：返回空的同时记录错误码，20017 标记为票据失效，空歌单与失效可区分',async()=>{
 const expired=new KugouAdapter({requestJson:async()=>({status:0,error_code:20017})},newStore(MOBILE_COOKIE));
 assert.deepEqual(await expired.fetchMyPlaylists(),[]);
 assert.deepEqual({...expired.lastPlaylistError},{code:20017,expired:true});
 const other=new KugouAdapter({requestJson:async()=>({status:0,error_code:20006})},newStore(MOBILE_COOKIE));
 assert.deepEqual(await other.fetchMyPlaylists(),[]);
 assert.deepEqual({...other.lastPlaylistError},{code:20006,expired:false});
 const empty=new KugouAdapter({requestJson:async()=>({status:1,error_code:0,data:{info:[]}})},newStore(MOBILE_COOKIE));
 assert.deepEqual(await empty.fetchMyPlaylists(),[]);
 assert.equal(empty.lastPlaylistError,null);
 const net=new KugouAdapter({requestJson:async()=>{throw Error('fixture-network')}},newStore(MOBILE_COOKIE));
 assert.deepEqual(await net.fetchMyPlaylists(),[]);
 assert.equal(net.lastPlaylistError,null);
});
await test('手机端票据读歌单歌曲：collection 歌单走 pubsongs，手机端签名（无请求体）',async()=>{
 const calls=[];
 const http={requestJson:async(url,o)=>{calls.push({url,o});return {status:1,error_code:0,data:{songs:[
  {hash:'HASHAAA',name:'歌手 - 歌名',singerinfo:[{id:1,name:'歌手'}],albuminfo:{name:'专辑',id:3},timelen:200000}]}}}};
 const adapter=new KugouAdapter(http,newStore(MOBILE_COOKIE));
 const tracks=await adapter.fetchPlaylistTracks('collection_3_42_7_0');
 assert.equal(tracks.length,1);assert.equal(tracks[0].id,'kugou:HASHAAA');assert.equal(tracks[0].title,'歌名');
 const q=query(calls[0].url);
 assert.equal(new URL(calls[0].url).pathname,'/pubsongs/v2/get_other_list_file_nofilt');
 assert.equal(q.global_collection_id,'collection_3_42_7_0');assert.equal(q.begin_idx,'0');assert.equal(q.appid,'1005');
 assert.equal(q.signature,kugouMobileSign(withoutSig(q)));
 assert.equal(calls[0].o.method,undefined);
 const pl=await adapter.fetchPlaylist('collection_3_42_7_0');
 assert.equal(pl.tracks.length,1);assert.equal(pl.platform,'kugou');
});
await test('手机端歌单歌曲接口出错带错误码抛出，fetchPlaylistTracks 返回空而不崩',async()=>{
 const adapter=new KugouAdapter({requestJson:async()=>({status:0,error_code:20017})},newStore(MOBILE_COOKIE));
 assert.deepEqual(await adapter.fetchPlaylistTracks('collection_3_42_7_0'),[]);
 assert.ok(KugouApiError);
});
await test('第四路（手机端网关 /v5/url）：签名是 "k=v" 直接拼接、无请求体，不再是旧 androidSign 的 & 拼接',async()=>{
 const calls=[];
 const http={requestJson:async(url,o)=>{calls.push({url,o});return {status:1,url:['http://cdn.example.invalid/a.mp3','http://cdn.example.invalid/b.mp3'],bitRate:320000}}};
 const adapter=new KugouAdapter(http,newStore(MOBILE_COOKIE));
 const r=await adapter.fetchGateway('HASHAAA','999','320','42','fixture-token','123456','fixture-dfid');
 assert.deepEqual({...r},{url:'https://cdn.example.invalid/a.mp3',quality:'320'});
 const {url,o}=calls[0];
 assert.equal(new URL(url).origin+new URL(url).pathname,'https://gateway.kugou.com/v5/url');
 const q=query(url);
 const salt='OIlwieks28dk2k092lksi2UIkp';
 const sorted=Object.keys(withoutSig(q)).sort().map(k=>k+'='+q[k]);
 assert.equal(q.signature,md5(salt+sorted.join('')+salt));
 assert.notEqual(q.signature,md5(salt+sorted.join('&')+salt));
 assert.equal(q.signature,kugouMobileSign(withoutSig(q)));
 assert.equal(q.appid,'1005');assert.equal(q.clientver,'20489');assert.equal(q.token,'fixture-token');assert.equal(q.userid,'42');
 assert.equal(q.hash,'HASHAAA');assert.equal(q.quality,'320');assert.equal(q.srcappid,undefined);
 assert.equal(q.key,md5('HASHAAA'+'57ae12eb6890223e355ccfcb74edf70d'+'1005'+'123456'+'42'));
 assert.equal(o.headers['x-router'],'trackercdn.kugou.com');
 assert.equal(o.headers['User-Agent'],'Android15-1070-11083-46-0-DiscoveryDRADProtocol-wifi');
 assert.equal(o.cookie,'');
});
await test('第四路：url 为字符串也能取；status 不是 1（如 2 需付费）或没有 url 返回 null；缺票据直接跳过不发请求',async()=>{
 const make=resp=>new KugouAdapter({requestJson:async()=>resp},newStore(MOBILE_COOKIE));
 const ok=await make({status:1,url:'http://cdn.example.invalid/c.flac',bitRate:1000000}).fetchGateway('H','','flac','42','t','1','d');
 assert.deepEqual({...ok},{url:'https://cdn.example.invalid/c.flac',quality:'flac'});
 assert.equal(await make({status:2,url:''}).fetchGateway('H','','320','42','t','1','d'),null);
 assert.equal(await make({status:1,url:[]}).fetchGateway('H','','320','42','t','1','d'),null);
 let sent=0;
 const none=new KugouAdapter({requestJson:async()=>{sent++;return {}}},newStore(MOBILE_COOKIE));
 assert.equal(await none.fetchGateway('H','','320','','','1','d'),null);
 assert.equal(sent,0);
});
await test('会员字段映射（假数据）：非会员 / 普通会员 / 超级会员 / 已过期 / 接口出错',()=>{
 const now=Date.parse('2030-01-01T00:00:00+08:00');
 const free={status:1,error_code:0,data:{is_vip:0,vip_type:0,vip_end_time:'',su_vip_end_time:'',busi_vip:[{is_vip:0,product_type:'',vip_end_time:''},{}]}};
 assert.deepEqual({...parseKugouVip(free,now)},{isVip:false,isSvip:false,vipType:0,expireTime:0});
 const vip={status:1,error_code:0,data:{is_vip:1,vip_end_time:'2030-06-01 12:00:00',su_vip_end_time:'',busi_vip:[{is_vip:1,product_type:'tvip',vip_end_time:'2030-06-01 12:00:00'}]}};
 assert.deepEqual({...parseKugouVip(vip,now)},{isVip:true,isSvip:false,vipType:1,expireTime:Date.parse('2030-06-01T12:00:00+08:00')});
 const svipBusi={status:1,error_code:0,data:{is_vip:1,vip_end_time:'2030-03-01 00:00:00',busi_vip:[{is_vip:1,product_type:'svip',vip_end_time:'2031-01-01 00:00:00'}]}};
 const s1=parseKugouVip(svipBusi,now);
 assert.equal(s1.isVip,true);assert.equal(s1.isSvip,true);assert.equal(s1.vipType,2);assert.equal(s1.expireTime,Date.parse('2031-01-01T00:00:00+08:00'));
 const svipSu={status:1,error_code:0,data:{is_vip:0,su_vip_end_time:'2030-09-09 09:09:09'}};
 const s2=parseKugouVip(svipSu,now);
 assert.equal(s2.isVip,true);assert.equal(s2.isSvip,true);assert.equal(s2.vipType,2);
 const expired={status:1,error_code:0,data:{is_vip:1,vip_end_time:'2029-12-31 23:59:59',su_vip_end_time:'2029-01-01 00:00:00',busi_vip:[{is_vip:1,product_type:'svip',vip_end_time:'2029-01-01 00:00:00'}]}};
 assert.deepEqual({...parseKugouVip(expired,now)},{isVip:false,isSvip:false,vipType:0,expireTime:0});
 assert.equal(parseKugouVip({status:1,error_code:0,data:{is_vip:1}},now).isVip,true);
 assert.equal(parseKugouVip({status:0,error_code:20017},now),null);
 assert.equal(parseKugouVip({status:1,error_code:20006,data:{is_vip:1}},now),null);
 assert.equal(parseKugouVip(null,now),null);
});
await test('getAccount 带会员：手机端票据请求会员接口（手机端签名，不带手机端标识头），字段进 isVip / isSvip / vipType',async()=>{
 const calls=[];
 const http={requestJson:async(url,o)=>{
  calls.push({url,o});
  if(url.includes('/v1/get_union_vip'))return {status:1,error_code:0,data:{is_vip:1,vip_end_time:'2099-01-01 00:00:00',su_vip_end_time:'2099-01-01 00:00:00'}};
  return {status:1,data:{info:[]}};
 }};
 const a=await new KugouLogin(newStore(MOBILE_COOKIE),http).getAccount();
 assert.equal(a.loggedIn,true);assert.equal(a.isVip,true);assert.equal(a.isSvip,true);assert.equal(a.vipType,2);
 const v=calls.find(c=>c.url.includes('/v1/get_union_vip'));
 assert.equal(new URL(v.url).origin,'https://kugouvip.kugou.com');
 const q=query(v.url);
 assert.equal(q.appid,'1005');assert.equal(q.token,'fixture-token');assert.equal(q.userid,'42');
 assert.equal(q.signature,kugouMobileSign(withoutSig(q)));
 assert.equal(v.o.cookie,'');assert.equal(v.o.headers,undefined);
 // 普通会员
 const normal=await new KugouLogin(newStore(MOBILE_COOKIE),{requestJson:async(url)=>url.includes('get_union_vip')?{status:1,error_code:0,data:{is_vip:1,vip_end_time:'2099-01-01 00:00:00'}}:{status:1,data:{info:[]}}}).getAccount();
 assert.equal(normal.isVip,true);assert.equal(normal.isSvip,false);assert.equal(normal.vipType,1);
});
await test('getAccount 会员查询失败（接口错误码 / 网络异常）按非会员处理，登录态不受影响；网页老票据不查会员',async()=>{
 const base={status:1,data:{info:[{listid:2,name:'我喜欢',list_create_userid:42,list_create_username:'昵称'}]}};
 const bad=await new KugouLogin(newStore(MOBILE_COOKIE),{requestJson:async(url)=>url.includes('get_union_vip')?{status:0,error_code:20017}:base}).getAccount();
 assert.equal(bad.loggedIn,true);assert.equal(bad.authStatus,'valid');assert.equal(bad.isVip,false);assert.equal(bad.vipType,0);
 const net=await new KugouLogin(newStore(MOBILE_COOKIE),{requestJson:async(url)=>{if(url.includes('get_union_vip'))throw Error('fixture-network');return base}}).getAccount();
 assert.equal(net.loggedIn,true);assert.equal(net.isVip,false);assert.equal(net.isSvip,false);
 const urls=[];
 const web=await new KugouLogin(newStore(WEB_COOKIE),{requestJson:async(url)=>{urls.push(url);return base}}).getAccount();
 assert.equal(web.loggedIn,true);assert.equal(web.isVip,false);
 assert.equal(urls.some(u=>u.includes('get_union_vip')),false);
});
await test('probeVip：手机端票据走手机端会员接口，会员档位进可选音质',async()=>{
 const http={requestJson:async()=>({status:1,error_code:0,data:{is_vip:1,vip_end_time:'2099-01-01 00:00:00'}})};
 const adapter=new KugouAdapter(http,newStore(MOBILE_COOKIE));
 const v=await adapter.probeVip();
 assert.equal(v.isVip,true);assert.equal(v.isSvip,false);
 assert.deepEqual((await adapter.listQualities()).map(x=>x.level),['128','320','flac']);
});
await test('歌名「歌手1、歌手2 - 歌名」：左边全是这首的歌手才去掉（#211）；不是歌手的「 - 副标题」保留',()=>{
 const f=api.stripKugouFileName;
 assert.equal(f('编的甲、编的乙 - 编的歌','编的甲 / 编的乙'),'编的歌');
 assert.equal(f('Some Band, Other One - Made Up Song','Some Band / Other One'),'Made Up Song');
 assert.equal(f('编的甲 - 编的歌.mp3','编的甲'),'编的歌');
 assert.equal(f('编的歌 - 现场版','编的甲'),'编的歌 - 现场版','左边不是歌手不动');
 assert.equal(f('编的甲、路人 - 编的歌','编的甲 / 编的乙'),'编的甲、路人 - 编的歌','左边有一位不是这首的歌手也不动');
 assert.equal(f('编的甲编的歌','编的甲'),'编的歌','老规则：歌手直接连着歌名');
});
fs.rmSync(tmp,{recursive:true,force:true});
console.log(`酷狗登录回归全部通过：${passed} 项`);
