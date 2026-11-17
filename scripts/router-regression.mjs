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
 a.qq.fetchSongUrl=async()=>{count++;requestScope().signal.addEventListener('abort',()=>{aborted=true});await wait(20);return {url:'https://test/a'}};
 const r=make(a),control=new AbortController();const p=r.resolve(song,undefined,{signal:control.signal}),q=r.resolve(song);
 await wait(2);control.abort();assert.equal((await p).code,'CANCELLED');assert.equal((await q).playable,true);assert.equal(count,1);assert.equal(aborted,true);
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
await test('会员刷新在后台，不阻塞路由，并排除无供流平台',async()=>{
 const p=createFallbackPriorityProvider(Object.fromEntries(['qq','netease','kugou','spotify'].map(k=>[k,{getAccount:()=>new Promise(()=>{})}])));
 const at=Date.now(),order=await p();assert.ok(Date.now()-at<30);assert.equal(order.length,3);assert.ok(!order.some(t=>t.platform==='spotify'));p.invalidate();
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
console.log(`路由与代理回归 ${passed}/${passed}`);
