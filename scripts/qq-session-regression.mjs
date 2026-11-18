import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import fs from 'node:fs';
import vm from 'node:vm';
const require=createRequire(import.meta.url);
const api=require('../dist-main/index.cjs');
const {qqCredential,qqSession,QqRightsService,QqLogin,QqAdapter,SongResolver,parseQqRights,parseQqLoginProbe,validatePlatformCookie}=api;
const cookie='uin=o12345; qm_keyst=fixture-new; qqmusic_key=fixture-old';
const good={code:0,data:{uin:'12345',nick:'fixture'}};
const vipResponse=fields=>({code:0,req_0:{code:0,data:{infoMap:{'12345':fields}}}});
const song={id:'qq:test',platform:'qq',sourceId:'test',title:'测试',artist:'测试歌手',duration:240,album:'测试专辑',originalUrl:'',fallbackUrl:'',cover:'',extra:{mediaMid:'media'}};
const store=(value=cookie)=>({getHeader:()=>value});
let passed=0;
async function test(name,fn){await fn();passed++;console.log('通过 '+name);}
await test('选择qm_keyst而不是过时别名，p_skey和OAuth不冒充播放票据',()=>{
 assert.equal(qqCredential(cookie).key,'fixture-new');assert.equal(qqCredential(cookie).uin,'12345');
 for(const name of ['p_skey','skey','access_token','refresh_token'])assert.equal(validatePlatformCookie('qq',`uin=12345; ${name}=fixture`).ok,false);
});
await test('微信账号优先wxuin，长音乐账号不转成不安全Number',()=>{
 const c='login_type=2; uin=12345; wxuin=1152921504606846999; wxskey=fixture';
 assert.equal(qqCredential(c).uin,'1152921504606846999');assert.equal(validatePlatformCookie('qq',c).ok,true);
});
await test('完整原生musicid/musickey作为同一身份对使用',()=>{
 const c='uin=12345; musicid=1152921504606846999; musickey=fixture-native; qm_keyst=fixture-web';
 assert.equal(qqCredential(c).key,'fixture-native');assert.equal(qqCredential(c).uin,'1152921504606846999');
 assert.equal(validatePlatformCookie('qq',c).ok,true);
});
await test('音乐票据别名均能结构校验，畸形账号仍拒绝',()=>{
 for(const name of ['qm_keyst','qqmusic_key','music_key','musickey','wxskey'])assert.equal(validatePlatformCookie('qq',`uin=12345; ${name}=fixture`).ok,true);
 assert.equal(validatePlatformCookie('qq','uin=not-an-id; qm_keyst=fixture').ok,false);
});
await test('登录核验只采信有载荷成功与明确过期码，错账号和空响应未知',()=>{
 assert.equal(parseQqLoginProbe(good,'12345'),'valid');
 for(const code of [1000,104400,104401])assert.equal(parseQqLoginProbe({code},'12345'),'expired');
 for(const r of [null,{code:0,data:{}},{code:0,data:[]},{code:500003},good])
   assert.equal(parseQqLoginProbe(r,'99999'),'unknown');
});
await test('会话缓存隔离换账号与换票据，同票据只核验一次',async()=>{
 let calls=0;const http={requestJson:async()=>{calls++;return {req_login:good}}},session=qqSession(http);
 await session.check(cookie);await session.check(cookie);assert.equal(calls,1);
 await session.check(cookie.replace('fixture-new','fixture-rotated'));assert.equal(calls,2);
 assert.equal(session.peek(cookie.replace('12345','67890')),'unknown');
});
await test('核验网络错误是unknown，不是过期或普通会员',async()=>{
 const http={requestJson:async()=>{throw Error('fixture-network')}};
 assert.equal(await qqSession(http).check(cookie),'unknown');
 assert.equal((await new QqLogin(http,store()).getAccount()).authStatus,'unknown');
});
await test('会员查询携带音乐身份、authst与uin_list，解析当前V2会员字段',async()=>{
 let calls=0;const http={requestJson:async(_url,o)=>{
  calls++;assert.equal(o.body.comm.uin,'12345');assert.equal(o.body.comm.authst,'fixture-new');
  assert.equal(o.body.req_0.module,'userInfo.VipQueryServer');assert.deepEqual(o.body.req_0.param.uin_list,['12345']);
  return vipResponse({iVipFlag:1,iSuperVip:1,superEndTime:new Date(Date.now()+3600_000).toISOString()});
 }};
 const service=new QqRightsService(http),r=await service.getRights(cookie);assert.equal(r.isVip,true);assert.equal(r.isSvip,true);
 assert.ok(r.expiresAt>Date.now());await service.getRights(cookie);assert.equal(calls,1);
});
await test('明确普通会员与未知载荷分别返回false和null',async()=>{
 const ordinary=new QqRightsService({requestJson:async()=>vipResponse({iVipFlag:0,iNewVip:0,iSuperVip:0})});
 const r=await ordinary.getRights(cookie);assert.equal(r.known,true);assert.equal(r.isVip,false);
 const unknown=new QqRightsService({requestJson:async()=>({code:0,req_0:{code:0,data:{}}})});
 assert.equal(await unknown.getRights(cookie),null);
});
await test('其他账号权益、OAuth到期和会员宣传字段不冒充当前会员',async()=>{
 const service=new QqRightsService({requestJson:async()=>({code:0,req_0:{code:0,data:{infoMap:{'99999':{isVip:1}}}}})});
 assert.equal(await service.getRights(cookie),null);
 for(const p of [{vipLabel:'VIP',vipPoints:999},{accessTokenExpireTime:Date.now()+86400_000},{vip_info:{end_time:Date.now()+86400_000}}])
   assert.equal(parseQqRights(p).known,false);
});
await test('过期会员不能靠未来OAuth期限变成有效会员，豪华绿钻不是SVIP',()=>{
 const r=parseQqRights({vip_info:{is_vip:1,vip_type:8,end_time:Date.now()-1000,accessTokenExpireTime:Date.now()+86400_000}});
 assert.equal(r.known,true);assert.equal(r.isVip,false);
 const huge=parseQqRights({identity:{HugeVip:1,HugeVipEnd:new Date(Date.now()+3600_000).toISOString()}});
 assert.equal(huge.isVip,true);assert.equal(huge.isSvip,false);
 assert.equal(parseQqRights({svip_info:{is_svip:0}}).known,false);
});
await test('新票据不能命中旧会员缓存，已确认过期时清除权益',async()=>{
 let calls=0;const http={requestJson:async()=>{calls++;return vipResponse({iVipFlag:1})}},s=new QqRightsService(http);
 await s.getRights(cookie);await s.getRights(cookie.replace('fixture-new','fixture-rotated'));assert.equal(calls,2);
 qqSession(http).remember(cookie,'expired');assert.equal(await s.getRights(cookie),null);
});
await test('V2未知时用V1，不能把接口code非0的数据当会员',async()=>{
 const seen=[];const http={requestJson:async(_u,o)=>{const method=o.body.req_0.method;seen.push(method);
  return method==='SRFVipQuery_V2'?{code:0,req_0:{code:500003,data:{infoMap:{'12345':{iVipFlag:1}}}}}:vipResponse({iVipFlag:0});
 }};
 const r=await new QqRightsService(http).getRights(cookie);assert.equal(r.isVip,false);
 assert.deepEqual(seen,['SRFVipQuery_V2','SRFVipQuery']);
});
await test('账号登录成功必须有登录核验，会员字段继续传至AccountInfo',async()=>{
 const http={requestJson:async(_u,o)=>o.body?.req_login?{req_login:good}:o.body?.req_0?vipResponse({iVipFlag:1}):{data:{nick:'fixture'}}};
 const account=await new QqLogin(http,store(),new QqRightsService(http)).getAccount();
 assert.equal(account.loggedIn,true);assert.equal(account.authStatus,'valid');assert.equal(account.isVip,true);
});
await test('仅uin或已过期票据不能被公开个人资料伪装为已登录',async()=>{
 const http={requestJson:async(_u,o)=>o.body?.req_login?{req_login:{code:1000}}:{data:{nick:'public-profile'}}};
 const expired=await new QqLogin(http,store()).getAccount();assert.equal(expired.loggedIn,false);
 assert.equal(expired.error,api.QQ_AUTH_EXPIRED);
 assert.equal((await new QqLogin(http,store('uin=12345; p_skey=fixture')).getAccount()).authStatus,'missing');
});
await test('过期探针与vkey同批请求，空purl返回明确AUTH_EXPIRED',async()=>{
 let calls=0;const http={requestJson:async(_u,o)=>{calls++;assert.equal(o.body.req_login.method,'GetLoginUserInfo');
  return {req_login:{code:1000},req_0:{code:0,data:{midurlinfo:[]}}};
 }};
 const adapter=new QqAdapter(http,store()),r=await adapter.fetchSongUrl('test',undefined,'flac',song.extra);
 assert.equal(r.code,'AUTH_EXPIRED');assert.equal(r.error,api.QQ_AUTH_EXPIRED);
 await adapter.fetchSongUrl('test',undefined,'flac',song.extra);assert.equal(calls,1);
});
await test('登录有效时空purl是歌曲可用性问题，缺核验时保持未知',async()=>{
 for(const [part,expected] of [[good,'RIGHTS_OR_UNAVAILABLE'],[null,'AUTH_UNVERIFIED']]){
  const adapter=new QqAdapter({requestJson:async()=>({req_login:part,req_0:{code:0,data:{midurlinfo:[]}}})},store());
  assert.equal((await adapter.fetchSongUrl('test',undefined,'128k',song.extra)).code,expected);
 }
});
await test('取链参数错误和1901不擅自断言登录过期',async()=>{
 for(const code of [104400,1901,500003]){
  const adapter=new QqAdapter({requestJson:async()=>({req_0:{code}})},store());
  assert.equal((await adapter.fetchSongUrl('test',undefined,'128k',song.extra)).code,'UPSTREAM_ERROR');
 }
});
await test('确认过期的QQ主源禁止跨平台兜底',async()=>{
 let searched=0;const a={qq:{fetchSongUrl:async()=>({url:'',code:'AUTH_EXPIRED'})},netease:{searchSongs:async()=>{searched++;return []}},kugou:{searchSongs:async()=>{searched++;return []}}};
 const r=await new SongResolver(a,()=>{}).resolve(song);assert.equal(r.code,'AUTH_EXPIRED');assert.equal(searched,0);
 assert.equal(r.error,api.QQ_AUTH_EXPIRED);
});
await test('已有解析缓存也不能覆盖后来确认的登录过期',async()=>{
 let expired=false;const a={qq:{getAuthStatus:()=>expired?'expired':'valid',fetchSongUrl:async()=>({url:'https://fixture.test/audio'})}};
 const resolver=new SongResolver(a,()=>{},async()=>true);assert.equal((await resolver.resolve(song)).playable,true);
 expired=true;assert.equal((await resolver.resolve(song)).code,'AUTH_EXPIRED');
});
/** 从 electron/main.cjs 截出 createQqLoginWindow，用假的内嵌弹窗宿主 + 假定时器在沙箱里运行。 */
function loadQqLogin(header){
 const source=fs.readFileSync('electron/main.cjs','utf8');
 const start=source.indexOf('function createQqLoginWindow('),end=source.indexOf('function createKugouLoginWindow(',start);
 const state={timer:null,header,opened:[],closeReason:null};
 let resolveClosed;
 const sheetHost={open:o=>{state.opened.push(o);const closed=new Promise(r=>{resolveClosed=r;});
  return {closed,close:reason=>{state.closeReason=reason;resolveClosed(reason);}};}};
 const fn=vm.runInNewContext('('+source.slice(start,end).trim()+')',{
  session:{fromPartition:()=>({clearStorageData:async()=>{},cookies:{get:async()=>state.header.split('; ').map(x=>({name:x.split('=')[0],value:x.split('=')[1]}))}})},
  sheetHost,normalizeCookieHeader:api.normalizeCookieHeader,validatePlatformCookie,
  setInterval:cb=>{state.timer=cb;return 1;},clearInterval:()=>{},console:{warn:()=>{}},
 });
 return {fn,state,userClose:()=>resolveClosed('user')};
}
await test('官方登录页在内嵌弹窗里打开，用独立分区，等待真正音乐票据，成功收起弹窗而不被关闭事件改成取消',async()=>{
 const {fn,state}=loadQqLogin('uin=12345; p_skey=fixture');let writes=0;
 const result=fn({set:()=>{writes++;}});await new Promise(r=>setImmediate(r));
 assert.equal(state.opened.length,1);assert.equal(state.opened[0].platform,'qq');
 assert.equal(state.opened[0].partition,'persist:qq-music-login');assert.equal(state.opened[0].url,'https://y.qq.com/');
 await state.timer();assert.equal(writes,0);assert.equal(state.closeReason,null);
 state.header='uin=12345; qm_keyst=fixture';await state.timer();
 assert.equal((await result).ok,true);assert.equal(writes,1);assert.equal(state.closeReason,'done');
});
await test('用户关闭登录弹窗得到「登录窗口已关闭」，之后不再写入',async()=>{
 const {fn,state,userClose}=loadQqLogin('uin=12345; p_skey=fixture');let writes=0;
 const result=fn({set:()=>{writes++;}});await new Promise(r=>setImmediate(r));
 userClose();const r=await result;assert.equal(r.ok,false);assert.equal(r.error,'登录窗口已关闭');assert.equal(writes,0);
});
console.log(`QQ 会话与权益回归 ${passed}/${passed}`);
