// QQ 登录自动续期离线回归：全部用假接口，不联网、不读真实凭据。
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const api=require('../dist-main/index.cjs');
const {canRenewQq,qqKeyAgeMs,buildQqRenewRequest,applyQqRenewal,QqRenewService,QqLogin,qqSession,QQ_RENEW_AFTER_MS}=api;

const DAY=24*3600_000,NOW=Date.UTC(2026,10,18,12);
const created=(ms)=>String(Math.floor(ms/1000));
const qqCookie=(over={})=>Object.entries({
  pgv_pvid:'fixture-pv',uin:'12345',login_type:'1',tmeLoginType:'2',psrf_qqopenid:'fixture-openid',psrf_qqunionid:'fixture-unionid',
  qm_keyst:'Q_H_L_fixture-old',qqmusic_key:'Q_H_L_fixture-old',psrf_qqaccess_token:'fixture-access',psrf_qqrefresh_token:'fixture-refresh',
  psrf_access_token_expiresAt:'1800100710',psrf_musickey_createtime:created(NOW-3*DAY),...over,
}).filter(([,v])=>v!=null).map(([k,v])=>`${k}=${v}`).join('; ');
const fields=(c)=>Object.fromEntries(c.split('; ').map(p=>[p.slice(0,p.indexOf('=')),p.slice(p.indexOf('=')+1)]));
const okRenew=(data={})=>({code:0,req_0:{code:0,data:{musickey:'Q_H_L_fixture-new',musicid:12345,str_musicid:'12345',openid:'fixture-openid',
  access_token:'fixture-access',refresh_token:'fixture-refresh',expired_at:1800100710,musickeyCreateTime:Math.floor(NOW/1000),keyExpiresIn:259200,refresh_key:'',...data}}});
const valid={code:0,data:{uin:'12345',nick:'fixture'}};

class Store {
  constructor(cookie){this.rec={cookies:cookie,nickname:'QQ 音乐',token:'fixture-token'};this.writes=0;}
  getHeader(){return this.rec?.cookies;} get(){return this.rec;}
  set(_p,cookies,token,nickname){this.writes++;this.rec={cookies,token,nickname};}
}
/** 假 musicu：续期请求回 renew，核验请求按票据回 probe。 */
function fakeHttp({renew=okRenew(),probe=()=>valid,onRenew}={}){
  const calls={renew:0,probe:0};
  return {calls,requestJson:async(_u,o)=>{
    if(o.body?.req_0?.module==='music.login.LoginServer'){calls.renew++;await onRenew?.(o);if(renew instanceof Error)throw renew;return renew;}
    if(o.body?.req_login){calls.probe++;return {req_login:probe(o.cookie)};}
    return {data:{nick:'fixture'}};
  }};
}
const service=(http,store,opts={})=>new QqRenewService(http,store,{now:()=>NOW,log:()=>{},...opts});

let passed=0;
async function test(name,fn){await fn();passed++;console.log('通过 '+name);}

await test('只给 QQ 号网页登录续期：微信、缺授权令牌、原生 musickey 对都不续',()=>{
  assert.equal(canRenewQq(qqCookie()),true);
  assert.equal(canRenewQq(qqCookie({wxopenid:'fixture-wx'})),false);
  assert.equal(canRenewQq(qqCookie({login_type:'2'})),false);
  assert.equal(canRenewQq(qqCookie({tmeLoginType:'1'})),false);
  for(const k of ['psrf_qqopenid','psrf_qqaccess_token','psrf_qqrefresh_token'])assert.equal(canRenewQq(qqCookie({[k]:null})),false);
  assert.equal(canRenewQq('uin=12345; musicid=12345; musickey=fixture-native; psrf_qqopenid=a; psrf_qqaccess_token=b; psrf_qqrefresh_token=c'),false);
  assert.equal(canRenewQq(qqCookie({qm_keyst:null,qqmusic_key:null})),false);
});
await test('票据年龄按 psrf_musickey_createtime（秒或毫秒）计算，缺失为 null',()=>{
  assert.equal(qqKeyAgeMs(qqCookie(),NOW),3*DAY);
  assert.equal(qqKeyAgeMs(qqCookie({psrf_musickey_createtime:String(NOW-DAY)}),NOW),DAY);
  assert.equal(qqKeyAgeMs(qqCookie({psrf_musickey_createtime:null}),NOW),null);
});
await test('续期请求：Login / loginMode=2 / tmeLoginType=2，参数取自对应 Cookie',()=>{
  const b=buildQqRenewRequest(qqCookie()),p=b.req_0.param;
  assert.equal(b.req_0.module,'music.login.LoginServer');assert.equal(b.req_0.method,'Login');
  assert.equal(b.comm.tmeLoginType,2);assert.equal(b.comm.uin,'12345');assert.equal(b.comm.authst,'Q_H_L_fixture-old');
  assert.deepEqual(p,{openid:'fixture-openid',access_token:'fixture-access',refresh_token:'fixture-refresh',refresh_key:'',
    musickey:'Q_H_L_fixture-old',musicid:12345,expired_in:1800100710,loginMode:2});
});
await test('合并：只换票据、创建时间和新授权令牌，其余字段与顺序原样',()=>{
  const old=qqCookie(),r=applyQqRenewal(old,okRenew({access_token:'fixture-access-2',expired_at:1810000000}));
  assert.ok(r.cookie);const f=fields(r.cookie);
  assert.equal(f.qm_keyst,'Q_H_L_fixture-new');assert.equal(f.qqmusic_key,'Q_H_L_fixture-new');
  assert.equal(f.psrf_musickey_createtime,String(Math.floor(NOW/1000)));
  assert.equal(f.psrf_qqaccess_token,'fixture-access-2');assert.equal(f.psrf_access_token_expiresAt,'1810000000');
  assert.equal(f.psrf_qqrefresh_token,'fixture-refresh');assert.equal(f.pgv_pvid,'fixture-pv');
  assert.deepEqual(Object.keys(f),Object.keys(fields(old)));
  assert.equal(api.qqCredential(r.cookie).key,'Q_H_L_fixture-new');
});
await test('服务器发回 refresh_key 时存下，下次续期带上',()=>{
  const r=applyQqRenewal(qqCookie(),okRenew({refresh_key:'fixture-rk'}));
  assert.equal(fields(r.cookie).refresh_key,'fixture-rk');
  assert.equal(buildQqRenewRequest(r.cookie).req_0.param.refresh_key,'fixture-rk');
});
await test('不合格的返回一律拒绝：接口报错、没有新票据、账号或 openid 对不上',()=>{
  assert.deepEqual(applyQqRenewal(qqCookie(),{code:0,req_0:{code:1000}}),{reject:'rejected',code:1000});
  assert.equal(applyQqRenewal(qqCookie(),{code:500001}).reject,'rejected');
  assert.equal(applyQqRenewal(qqCookie(),okRenew({musickey:''})).reject,'rejected');
  assert.equal(applyQqRenewal(qqCookie(),okRenew({musicid:99999,str_musicid:'99999'})).reject,'mismatch');
  assert.equal(applyQqRenewal(qqCookie(),okRenew({musicid:0,str_musicid:''})).reject,'mismatch');
  assert.equal(applyQqRenewal(qqCookie(),okRenew({openid:'someone-else'})).reject,'mismatch');
});
await test('续期成功：新票据核验有效才写入一次，令牌和昵称保留',async()=>{
  const store=new Store(qqCookie()),http=fakeHttp();
  const r=await service(http,store).renew('manual');
  assert.deepEqual(r,{ok:true,outcome:'renewed'});assert.equal(store.writes,1);
  assert.equal(api.qqCredential(store.getHeader()).key,'Q_H_L_fixture-new');
  assert.equal(store.rec.token,'fixture-token');assert.equal(store.rec.nickname,'QQ 音乐');
  assert.equal(http.calls.renew,1);assert.equal(http.calls.probe,1);
});
await test('新票据核验不是有效（过期或查不到）时不写入，旧票据保留',async()=>{
  for(const probe of [()=>({code:1000}),()=>null]){
    const store=new Store(qqCookie()),old=store.getHeader();
    const r=await service(fakeHttp({probe}),store).renew('manual');
    assert.equal(r.outcome,'unverified');assert.equal(store.writes,0);assert.equal(store.getHeader(),old);
  }
});
await test('网络异常、接口拒绝都不写入',async()=>{
  for(const [renew,outcome] of [[Error('fixture-network'),'network'],[{code:0,req_0:{code:1000}},'rejected']]){
    const store=new Store(qqCookie());
    const r=await service(fakeHttp({renew}),store).renew('manual');
    assert.equal(r.outcome,outcome);assert.equal(store.writes,0);
  }
});
await test('续期期间换号或退出登录：结果丢弃，不覆盖新登录',async()=>{
  for(const next of ['uin=67890; qm_keyst=fixture-other',undefined]){
    const store=new Store(qqCookie());
    const http=fakeHttp({onRenew:()=>{store.rec=next?{cookies:next}:undefined;}});
    const r=await service(http,store).renew('manual');
    assert.equal(r.outcome,'superseded');assert.equal(store.writes,0);assert.equal(store.getHeader(),next);
  }
});
await test('同一时间只续一次；失败后 30 分钟内不再自动试，手动可以',async()=>{
  const store=new Store(qqCookie()),http=fakeHttp();let now=NOW;const s=service(http,store,{now:()=>now});
  const [a,b]=await Promise.all([s.renew('age'),s.renew('expired')]);
  assert.equal(a,b);assert.equal(http.calls.renew,1);
  const bad=fakeHttp({renew:{code:0,req_0:{code:1000}}}),s2=service(bad,new Store(qqCookie()),{now:()=>now});
  assert.equal((await s2.renew('age')).outcome,'rejected');
  now+=10*60_000;assert.equal((await s2.renew('expired')).outcome,'backoff');assert.equal(bad.calls.renew,1);
  assert.equal((await s2.renew('manual')).outcome,'rejected');assert.equal(bad.calls.renew,2);
  now+=31*60_000;await s2.renew('age');assert.equal(bad.calls.renew,3);
});
await test('定时检查：票据不满 2 天跳过，满了才续；不支持的登录不发请求',async()=>{
  const young=new Store(qqCookie({psrf_musickey_createtime:created(NOW-DAY)})),h1=fakeHttp();
  assert.equal((await service(h1,young).maybeRenew()).outcome,'not-needed');assert.equal(h1.calls.renew,0);
  const old=new Store(qqCookie({psrf_musickey_createtime:created(NOW-QQ_RENEW_AFTER_MS-1000)})),h2=fakeHttp();
  assert.equal((await service(h2,old).maybeRenew()).ok,true);assert.equal(h2.calls.renew,1);
  const wx=new Store(qqCookie({wxopenid:'fixture-wx'})),h3=fakeHttp();
  assert.equal((await service(h3,wx).maybeRenew()).outcome,'unsupported');assert.equal(h3.calls.renew,0);
});
await test('确认过期时会话服务发通知，start 订阅后自动续期，停止后取消订阅',async()=>{
  const store=new Store(qqCookie()),http=fakeHttp(),s=service(http,store);
  const stop=s.start({firstDelayMs:3600_000,intervalMs:3600_000});
  qqSession(http).remember(store.getHeader(),'expired');
  await new Promise(r=>setTimeout(r,20));
  assert.equal(http.calls.renew,1);assert.equal(store.writes,1);
  stop();qqSession(http).remember(store.getHeader(),'expired');await new Promise(r=>setTimeout(r,20));
  assert.equal(http.calls.renew,1);
});
await test('账号核验发现过期：先续期，续上了就按新票据显示已登录',async()=>{
  const store=new Store(qqCookie());
  const http=fakeHttp({probe:(c)=>api.qqCredential(c||'').key==='Q_H_L_fixture-new'?valid:{code:1000}});
  const renewer=service(http,store),account=await new QqLogin(http,store,undefined,renewer).getAccount();
  assert.equal(account.loggedIn,true);assert.equal(account.authStatus,'valid');assert.equal(http.calls.renew,1);
});
await test('续不上时照旧提示「登录已过期」，且只试一次',async()=>{
  const store=new Store(qqCookie());
  const http=fakeHttp({probe:()=>({code:1000}),renew:{code:0,req_0:{code:1000}}});
  const login=new QqLogin(http,store,undefined,service(http,store));
  const a=await login.getAccount();assert.equal(a.loggedIn,false);assert.equal(a.error,api.QQ_AUTH_EXPIRED);
  await login.getAccount();assert.equal(http.calls.renew,1);
});
console.log(`QQ 登录自动续期回归 ${passed}/${passed}`);
