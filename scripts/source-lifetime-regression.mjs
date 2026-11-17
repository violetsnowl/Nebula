import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { SongResolver, NeteaseAdapter, QqAdapter, KugouAdapter } = require('../dist-main/index.cjs');
const cookie = { getHeader: () => '', get: () => undefined };
const track = { id:'qq:test', sourceId:'test', platform:'qq', title:'同一录音', artist:'测试歌手', duration:240, album:'专辑', cover:'', originalUrl:'', fallbackUrl:'' };
const now = Date.now;
let clock = now(), passed = 0;
Date.now = () => clock;
async function test(name, run) { await run(); passed++; console.log('通过 ' + name); }
try {
  await test('两分钟解析缓存失效不截短上游一小时地址期限', async () => {
    let calls=0; const expiresAt=clock+3600000;
    const resolver=new SongResolver({qq:{fetchSongUrl:async()=>{calls++;return {url:'https://test/audio',expiresAt}}}},()=>{},async()=>true);
    const first=await resolver.resolve(track); assert.equal(first.expiresAt,expiresAt);
    clock+=119000; const hit=await resolver.resolve(track); assert.equal(calls,1);assert.equal(hit.resolvedAt,first.resolvedAt);
    clock+=2000; const fresh=await resolver.resolve(track);assert.equal(calls,2);assert.equal(fresh.expiresAt,expiresAt);
  });
  await test('上游短期限也原样保留，不用保守缺省值延长',async()=>{
    const expiresAt=clock+15000;
    const resolver=new SongResolver({qq:{fetchSongUrl:async()=>({url:'https://test/short',expiresAt})}},()=>{},async()=>true);
    assert.equal((await resolver.resolve(track)).expiresAt,expiresAt);
  });
  await test('缺少有效期时使用实际供流平台的独立保守期限',async()=>{
    for(const [platform,minutes]of [['netease',15],['qq',30],['kugou',15]]){
      const resolver=new SongResolver({[platform]:{fetchSongUrl:async()=>({url:'https://test/default'})}},()=>{},async()=>true);
      const r=await resolver.resolve({...track,platform});assert.equal(r.expiresAt-r.resolvedAt,minutes*60000);
    }
  });
  await test('网易云v1 expi秒数转为地址期限',async()=>{
    const adapter=new NeteaseAdapter({},cookie,async()=>({body:{data:[{url:'https://test/ncm',expi:1200,level:'standard'}]}}));
    assert.equal((await adapter.fetchSongUrl('1')).expiresAt,clock+1200000);
  });
  await test('网易云旧接口expi也保留，不用缓存时间替代',async()=>{
    const adapter=new NeteaseAdapter({},cookie,async name=>({body:{data:name==='song_url'?[{url:'https://test/ncm-old',expi:600,br:128000}]:[]}}));
    assert.equal((await adapter.fetchSongUrl('1')).expiresAt,clock+600000);
  });
  await test('QQ响应expiration秒数原样换算，未返回时保守三十分钟',async()=>{
    let expiration=80400;
    const http={requestJson:async(_url,options)=>({req_0:{code:0,data:{expiration,sip:['https://test/'],midurlinfo:options.body.req_0.param.filename.map(filename=>({filename,purl:filename}))}}})};
    const adapter=new QqAdapter(http,cookie);
    assert.equal((await adapter.fetchSongUrl('id',undefined,'128k',{mediaMid:'media'})).expiresAt,clock+80400000);
    expiration=undefined;assert.equal((await adapter.fetchSongUrl('id',undefined,'128k',{mediaMid:'media'})).expiresAt,clock+1800000);
  });
  await test('酷狗缓存命中保留原到期时刻，缓存寿命另算',async()=>{
    let calls=0;
    const adapter=new KugouAdapter({requestJson:async url=>{calls++;return url.includes('/yy/')?{data:{play_url:'https://test/kg'}}:{};}},cookie);
    const first=await adapter.fetchSongUrl('hash');const initial=calls;
    assert.equal(first.expiresAt,clock+900000);clock+=1000;
    const hit=await adapter.fetchSongUrl('hash');assert.equal(hit.expiresAt,first.expiresAt);assert.equal(calls,initial);
    clock+=120001;const fresh=await adapter.fetchSongUrl('hash');assert.ok(calls>initial);assert.equal(fresh.expiresAt,clock+900000);
  });
} finally { Date.now=now; }
console.log(`地址寿命回归 ${passed}/${passed}`);
