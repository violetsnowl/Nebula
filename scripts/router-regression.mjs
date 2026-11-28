import assert from 'node:assert/strict';
import http from 'node:http';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {SongResolver,requestScope,withRequestScope,AudioProxy,probeAudioUrl,looksLikeAudio,createFallbackPriorityProvider}=require('../dist-main/index.cjs');
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const song={id:'qq:x',sourceId:'x',platform:'qq',title:'测试曲',artist:'测试歌手',duration:240,album:'测试专辑',originalUrl:'',fallbackUrl:'',cover:''};
const adapters=()=>Object.fromEntries(['qq','netease','kugou','spotify','qishui'].map(platform=>[platform,{platform,searchSongs:async()=>[],fetchSongUrl:async()=>null}]));
const policy={totalMs:150,primaryMs:40,searchMs:30,candidateMs:30,probeMs:20,cacheMs:10000};
const make=a=>new SongResolver(a,()=>{},async()=>true,policy);
let passed=0;
async function test(name,fn){await fn();passed++;console.log('通过 '+name)}
await test('工作回调耗尽总预算时即使计时器尚未执行也必须超时',async()=>{
 const real=Date.now;let now=real();Date.now=()=>now;
 try { await assert.rejects(withRequestScope(20,async()=>{now+=21;return 'too late'}),e=>e.code==='TIMEOUT'); }
 finally {Date.now=real;}
});
await test('挂起的适配器与搜索在截止时间内退出',async()=>{
 const a=adapters();a.qq.fetchSongUrl=()=>new Promise(()=>{});a.netease.searchSongs=()=>new Promise(()=>{});
 const at=Date.now(),r=await make(a).resolve(song);assert.equal(r.playable,false);assert.ok(Date.now()-at<300);
});
await test('HTTP 请求上下文继承并真正触发取消',async()=>{
 const control=new AbortController();let cancelled=false;
 const p=withRequestScope(500,()=>new Promise(r=>requestScope().signal.addEventListener('abort',()=>{cancelled=true;r(null)})),{signal:control.signal});
 await wait(2);control.abort();await p.catch(()=>{});assert.equal(cancelled,true);
});
await test('三次超时不熔断后续主源，平台恢复立即可播',async()=>{
 const a=adapters();let count=0;
 a.qq.fetchSongUrl=async()=>{if(++count<=3)await wait(80);return {url:'https://test/recovered'}};
 const r=make(a);for(let i=0;i<3;i++)await r.resolve({...song,sourceId:String(i)});
 assert.equal((await r.resolve({...song,sourceId:'recovered'})).playable,true);assert.equal(count,4);
});
await test('总预算退出保留 traceId 和阶段，登录失败给出具体原因',async()=>{
 const a=adapters();a.qq.fetchSongUrl=()=>new Promise(()=>{});
 const r=new SongResolver(a,()=>{},undefined,{totalMs:20,primaryMs:100,candidateMs:100});const x=await r.resolve(song);
 assert.equal(x.code,'TIMEOUT');assert.ok(x.traceId);assert.ok(x.timings.length);
 a.qq.fetchSongUrl=async()=>({url:'',playable:false,code:'LOGIN_REQUIRED'});assert.match((await make(a).resolve(song)).error,/登录/);
});
await test('合并并发请求，取消一人不影响另一人',async()=>{
 const a=adapters();let count=0,aborted=false;
 let release,started;const entered=new Promise(r=>{started=r});
 a.qq.fetchSongUrl=()=>{count++;requestScope().signal.addEventListener('abort',()=>{aborted=true});started();return new Promise(r=>{release=r})};
 const r=make(a),control=new AbortController();const p=r.resolve(song,undefined,{signal:control.signal}),q=r.resolve(song);
 await entered;control.abort();assert.equal((await p).code,'CANCELLED');release({url:'https://test/a'});
 assert.equal((await q).playable,true);assert.equal(count,1);assert.equal(aborted,true);
});
await test('最后一人取消回收请求且禁止缓存迟到结果',async()=>{
 const a=adapters();let count=0,signal;a.qq.fetchSongUrl=async()=>{count++;signal=requestScope().signal;await wait(20);return {url:'https://test/a'}};
 const r=make(a),control=new AbortController();const p=r.resolve(song,undefined,{signal:control.signal});await wait(2);control.abort();await p;
 assert.equal(signal.aborted,true);await wait(25);await r.resolve(song);assert.equal(count,2);
});
await test('已探测地址缓存、强制刷新、账号变更失效',async()=>{
 const a=adapters();let count=0;a.qq.fetchSongUrl=async()=>({url:`https://test/${++count}`});const r=make(a);
 const first=await r.resolve({...song,originalUrl:'https://expired.invalid'});assert.match(first.url,/1$/);
 await r.resolve(song);assert.equal(count,1);await r.resolve(song,undefined,{forceRefresh:true});assert.equal(count,2);
 r.invalidate();await r.resolve(song);assert.equal(count,3);
});
await test('临近过期的缓存地址不复用',async()=>{
 const a=adapters();let count=0;a.qq.fetchSongUrl=async()=>({url:`https://test/${++count}`,expiresAt:Date.now()+1000});const r=make(a);
 await r.resolve(song);await r.resolve(song);assert.equal(count,2);
});
await test('只尝试可供流平台，赢家取消其他兜底请求',async()=>{
 const a=adapters();let signal;a.netease.searchSongs=async()=>{signal=requestScope().signal;await wait(100);return []};
 a.kugou.searchSongs=async()=>[{...song,platform:'kugou'}];a.kugou.fetchSongUrl=async()=>({url:'https://test/kg'});
 a.spotify.searchSongs=async()=>{throw Error('不应调用 Spotify')};const r=await make(a).resolve(song);assert.equal(r.platform,'kugou');assert.equal(signal.aborted,true);
});
await test('主源只有试听时优先安全匹配的完整兜底',async()=>{
 const a=adapters();a.qq.fetchSongUrl=async()=>({url:'https://test/trial',trial:true,trialEndTime:30000});
 a.netease.searchSongs=async()=>[{...song,platform:'netease'}];a.netease.fetchSongUrl=async()=>({url:'https://test/full',quality:'exhigh'});
 const r=await make(a).resolve(song);assert.equal(r.fallback,true);assert.equal(r.platform,'netease');assert.ok(!r.trial);assert.equal(r.quality,'exhigh');
});
await test('仅剩试听保留试听标记，权益不足不能报成完整音源',async()=>{
 const a=adapters();a.qq.fetchSongUrl=async()=>({url:'https://test/trial',trial:true,trialEndTime:30000});
 const r=await make(a).resolve(song);assert.equal(r.code,'TRIAL_ONLY');assert.equal(r.trialEndTime,30000);
 a.qq.fetchSongUrl=async()=>({url:'',playable:false,code:'RIGHTS_OR_UNAVAILABLE'});const failed=await make(a).resolve(song);assert.equal(failed.playable,false);assert.match(failed.error,/权限或版权/);
});
await test('会员刷新在后台，不阻塞路由，并排除无供流平台',async()=>{
 const p=createFallbackPriorityProvider(Object.fromEntries(['qq','netease','kugou','spotify'].map(k=>[k,{getAccount:()=>new Promise(()=>{})}])));
 const at=Date.now(),order=await p();assert.ok(Date.now()-at<30);assert.equal(order.length,3);assert.ok(!order.some(t=>t.platform==='spotify'));p.invalidate();
});
await test('兜底顺序含酷我、波点：默认游客顺序在酷狗之后；登录会员的排前面；波点没登录不进（取不到整曲）',async()=>{
 const logins=(accounts={})=>Object.fromEntries(['qq','netease','kugou','kuwo','bodian','spotify','qishui'].map(k=>[k,{getAccount:async()=>accounts[k]??null}]));
 const p=createFallbackPriorityProvider(logins());
 assert.deepEqual((await p()).map(t=>t.platform),['netease','qq','kugou','kuwo']);
 assert.ok((await p()).every(t=>t.tier==='guest'));
 await wait(20); // 后台刷新完成：全部游客，顺序不变（波点游客仍不进）
 assert.deepEqual((await p()).map(t=>t.platform),['netease','qq','kugou','kuwo']);
 p.invalidate();
 const v=createFallbackPriorityProvider(logins({kuwo:{loggedIn:true,isVip:true},bodian:{loggedIn:true,isVip:true,isSvip:true},qq:{loggedIn:true}}));
 await v();await wait(20);
 assert.deepEqual((await v()).map(t=>[t.platform,t.tier]),[['bodian','svip'],['kuwo','vip'],['qq','free'],['netease','guest'],['kugou','guest']]);
 // 没有登录适配器的平台不进顺序；被排除的不进
 assert.deepEqual((await createFallbackPriorityProvider({kuwo:{getAccount:async()=>null}})()).map(t=>t.platform),['kuwo']);
 assert.deepEqual((await createFallbackPriorityProvider(logins(),['qishui','spotify','kuwo'])()).map(t=>t.platform),['netease','qq','kugou']);
});
await test('酷我 / 波点候选能被兜底选中：有 searchSongs 才参与；主源失败时酷我的同一录音出声',async()=>{
 const a=adapters();
 a.qq.fetchSongUrl=async()=>null;
 // 没有 searchSongs 的酷我 / 波点不参与（旧行为）
 a.kuwo={platform:'kuwo',fetchSongUrl:async()=>({url:'https://test/should-not-be-used'})};
 assert.equal((await make(a).resolve(song)).playable,false);
 const kuwoTrack={...song,id:'kuwo:77',sourceId:'77',platform:'kuwo',album:'测试专辑',extra:{durationSec:240}};
 let searched='',fetched=null;
 a.kuwo={platform:'kuwo',searchSongs:async kw=>{searched=kw;return [{...kuwoTrack,sourceId:'76',title:'完全无关的歌',artist:'别人'},kuwoTrack];},
  fetchSongUrl:async(id,album,quality,extra)=>{fetched={id,extra};return id==='77'?{url:'https://test/kuwo-77',quality:'128'}:null;}};
 a.bodian={platform:'bodian',searchSongs:async()=>[],fetchSongUrl:async()=>null};
 const r=await make(a).resolve(song);
 assert.equal(r.playable,true);assert.equal(r.fallback,true);assert.equal(r.platform,'kuwo');assert.equal(r.url,'https://test/kuwo-77');
 assert.match(searched,/测试曲/);assert.equal(fetched.id,'77');assert.equal(fetched.extra.durationSec,240);
 // 经优先级提供器排序后同样能选中
 const resolver=make(a);resolver.setFallbackTargets(createFallbackPriorityProvider({qq:{},netease:{},kugou:{},kuwo:{},bodian:{}}));
 assert.equal((await resolver.resolve({...song,sourceId:'y'})).platform,'kuwo');
 // 波点候选同理
 const b=adapters();b.qq.fetchSongUrl=async()=>null;
 b.bodian={platform:'bodian',searchSongs:async()=>[{...song,id:'bodian:88',sourceId:'88',platform:'bodian'}],fetchSongUrl:async id=>id==='88'?{url:'https://test/bodian-88',quality:'320'}:null};
 const rb=await make(b).resolve(song);assert.equal(rb.platform,'bodian');assert.equal(rb.quality,'320');
});
await test('audio MIME 的 HTML 伪音频拒绝',async()=>{assert.equal(looksLikeAudio(Buffer.from('<html>blocked</html>'),'audio/mpeg'),false)});
let seen=[],closed=false,connections=0;
const data=Buffer.concat([Buffer.from('ID3'),Buffer.alloc(4093,1)]);
const upstream=http.createServer((req,res)=>{
 seen.push({path:req.url,cookie:req.headers.cookie,range:req.headers.range});
 if(req.url==='/redirect'){res.writeHead(302,{Location:'/ncm'});res.end();return}
 if(req.url==='/forbidden'){res.writeHead(302,{Location:'http://127.0.0.2/private'});res.end();return}
 if(req.url==='/slow'){res.on('close',()=>{closed=true});res.writeHead(200,{'Content-Type':'audio/mpeg','Content-Length':99999});res.write(data);return}
 if(req.url==='/broken'){res.writeHead(200,{'Content-Type':'audio/mpeg','Content-Length':99999});res.write(data);setTimeout(()=>res.destroy(),20);return}
 const m=/bytes=(\d+)-(\d*)/.exec(req.headers.range || '');const start=m?+m[1]:0,end=m&&m[2]?+m[2]:data.length-1;
 res.writeHead(m?206:200,{'Content-Type':'audio/mpeg','Content-Length':end-start+1,'Accept-Ranges':'bytes',...(m?{'Content-Range':`bytes ${start}-${end}/${data.length}`}:{})});res.end(data.subarray(start,end+1));
});
upstream.on('connection',()=>connections++);
await new Promise(r=>upstream.listen(0,'127.0.0.1',r));
const root=`http://127.0.0.1:${upstream.address().port}`;
const classify=u=>u.origin===root?(u.pathname==='/ncm'?'netease':'qq'):null;
const proxy=new AudioProxy({getHeader:p=>`account=${p}`},classify);await proxy.start();
try {
 await test('代理 Range/HEAD、重定向重新注入 Cookie、复用端口',async()=>{
  const u=proxy.urlFor(root+'/redirect'),response=await fetch(u,{headers:{Range:'bytes=0-31'}});
  assert.equal(response.status,206);assert.equal(response.headers.get('content-range'),'bytes 0-31/4096');assert.equal((await response.arrayBuffer()).byteLength,32);
  assert.equal(seen.at(-1).cookie,'account=netease');assert.equal(seen.at(-1).range,'bytes=0-31');
  assert.equal((await fetch(proxy.urlFor(root+'/audio'),{method:'HEAD'})).status,200);
  assert.equal(proxy.urlFor(u.replace(/127\.0\.0\.1:\d+/,'127.0.0.1:1')),u);
 });
 await test('重定向到未授权域名被拒绝',async()=>{assert.equal((await fetch(proxy.urlFor(root+'/forbidden'))).status,403)});
 await test('上游中断导致下游失败而非永远等待',async()=>{const r=await fetch(proxy.urlFor(root+'/broken'));await assert.rejects(r.arrayBuffer())});
 await test('客户端切歌中止回收上游连接',async()=>{const c=new AbortController();const r=await fetch(proxy.urlFor(root+'/slow'),{signal:c.signal});await r.body.getReader().read();c.abort();await wait(40);assert.equal(closed,true)});
 await test('探测读取真实签名、限制 Range 并尊重取消',async()=>{
  assert.equal((await probeAudioUrl(root+'/audio',{platform:'qq',classify,timeoutMs:500})).ok,true);
  assert.match(seen.at(-1).range,/^bytes=0-511$/);const c=new AbortController();c.abort();assert.equal((await probeAudioUrl(root+'/slow',{platform:'qq',classify,signal:c.signal})).ok,false);
 });
 await test('完整短 Range 探测连接可复用，避免每首重新握手',async()=>{
  const before=connections;for(const part of ['one','two','three'])assert.equal((await probeAudioUrl(root+'/'+part,{platform:'qq',classify,timeoutMs:500})).ok,true);
  assert.ok(connections-before<=1,`新增连接数 ${connections-before}`);
 });
} finally {proxy.dispose();upstream.closeAllConnections();await new Promise(r=>upstream.close(r))}
await test('汽水（#212）：本平台先走车机取链（主源）；不给别的平台兜底；车机音频 CDN 归到汽水，接口域名不进代理',async()=>{
 const api=require('../dist-main/index.cjs');
 const a=adapters();let asked=0;
 a.qishui.fetchSongUrl=async(id,_al,q)=>{asked++;assert.equal(q,'standard');return {url:'https://v3.douyinvod.com/x.mp3',quality:'standard'}};
 const r=make(a);
 const got=await r.resolve({...song,id:'qishui:9',platform:'qishui',sourceId:'9'});
 assert.equal(got.platform,'qishui');assert.equal(asked,1);
 // 别的平台的歌失败时，不拿汽水兜底（汽水不在兜底名单）
 asked=0;a.qq.fetchSongUrl=async()=>null;a.qishui.searchSongs=async()=>[{...song,id:'qishui:9',platform:'qishui',sourceId:'9'}];
 await make(a).resolve({...song,sourceId:'other'});assert.equal(asked,0);
 if(api.audioPlatform){
  assert.equal(api.audioPlatform(new URL('https://v26.zjcdn.com/a.mp3')),'qishui');
  assert.equal(api.audioPlatform(new URL('https://api.qishui.com/x')),null);
  assert.equal(api.audioPlatform(new URL('https://www.douyin.com/x')),null);
 }
});
await test('汽水取音频不带 Referer / Origin（#215：车机 CDN 带 qishui.com 的 Referer 回 403）；其他平台的头不变',async()=>{
 const api=require('../dist-main/index.cjs');
 const q=api.mediaHeaders('qishui');assert.equal(q.Referer,undefined);assert.equal(q.Origin,undefined);assert.ok(q['User-Agent']);
 assert.deepEqual(api.mediaHeaders('netease'),api.PLATFORM_HEADERS.netease);
 assert.equal(api.PLATFORM_HEADERS.qishui.Referer,'https://www.qishui.com/','接口请求的头不动');
});
await test('手动切换播放来源（#323）：列出可选平台按原平台+VIP排序；指定平台严格单平台解析；preferPlatform 优先并在失败时无缝回落',async()=>{
 const a=adapters();
 a.kuwo={fetchSongUrl:async(id,_al,q)=>({url:'https://kw/128.mp3',quality:'128'}),searchSongs:async()=>[]};
 a.qq.searchSongs=async()=>[{...song,id:'qq:77',platform:'qq',sourceId:'77',title:'PROVE',artist:'Nil',duration:156}];
 a.qq.fetchSongUrl=async(id,_al,q)=>id==='77'?{url:'https://qq/flac.flac',quality:q||'flac'}:null;
 a.netease.searchSongs=async()=>[];
 a.netease.fetchSongUrl=async()=>null;
 a.bodian={fetchSongUrl:async()=>null,searchSongs:async()=>[]};
 const r=make(a);
 r.setFallbackTargets(async()=>[
  {platform:'qq',tier:'vip'},
  {platform:'netease',tier:'svip'},
  {platform:'kugou',tier:'free'},
  {platform:'kuwo',tier:'free'},
  {platform:'bodian',tier:'guest'},
 ]);
 const kuwoSong={id:'kuwo:55',platform:'kuwo',sourceId:'55',title:'PROVE',artist:'Nil',album:'',cover:'',duration:156,originalUrl:'',fallbackUrl:''};
 const list=await r.listPlayableSources(kuwoSong);
 assert.equal(list[0].platform,'kuwo','原平台排第一');
 assert.equal(list[0].isOriginal,true);
 assert.equal(list[1].platform,'netease','SVIP 排在 VIP 前');
 assert.equal(list[2].platform,'qq','VIP 排在普通前');
 assert.ok(!list.some(x=>x.platform==='bodian'),'波点游客不列');
 // 严格单平台解析到 QQ 拿到无损
 const switched=await r.resolveOnPlatform(kuwoSong,'qq','flac');
 assert.equal(switched.platform,'qq');
 assert.equal(switched.sourceId,'77');
 assert.equal(switched.quality,'flac');
 assert.equal(switched.fallback,true);
 // 严格单平台解析到网易云（无匹配）必须明确失败，不能静默落回酷我
 const miss=await r.resolveOnPlatform(kuwoSong,'netease','lossless');
 assert.equal(miss.playable,false);
 assert.equal(miss.platform,'netease');
 // preferPlatform=qq 时直接命中 QQ 无损
 const prefHit=await r.resolve(kuwoSong,'flac',{preferPlatform:'qq'});
 assert.equal(prefHit.platform,'qq');
 assert.equal(prefHit.quality,'flac');
 // preferPlatform=netease（失败）时无缝回落回酷我原平台，不中断播放
 const prefFallback=await r.resolve(kuwoSong,'flac',{preferPlatform:'netease'});
 assert.equal(prefFallback.platform,'kuwo');
 assert.equal(prefFallback.playable,true);
});
console.log(`路由与代理回归 ${passed}/${passed}`);
