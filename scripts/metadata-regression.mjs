import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),b=require('../dist-main/index.cjs');
let n=0;const test=async(name,fn)=>{await fn();n++;console.log('通过 '+name)};
await test('PNG/JPEG/WebP 实际像素，不采信 URL 尺寸',()=>{
 const png=Buffer.alloc(24);Buffer.from([137,80,78,71,13,10,26,10]).copy(png);png.writeUInt32BE(320,16);png.writeUInt32BE(180,20);assert.deepEqual(b.imageDimensions(png),{width:320,height:180});
 const jpg=Buffer.from([255,216,255,192,0,11,8,2,0,3,0,1,1,17,0]);assert.deepEqual(b.imageDimensions(jpg),{width:768,height:512});
 const webp=Buffer.alloc(30);webp.write('RIFF');webp.write('WEBP',8);webp.write('VP8X',12);webp.writeUIntLE(999,24,3);webp.writeUIntLE(799,27,3);assert.deepEqual(b.imageDimensions(webp),{width:1000,height:800});
 assert.equal(b.imageDimensions(Buffer.from('<html>not image</html>')),null);
});
await test('各平台原图候选保留有效小图',()=>{
 assert.equal(b.coverCandidates({platform:'netease',cover:'https://p1.music.126.net/a.jpg?param=500y500'})[0],'https://p1.music.126.net/a.jpg');
 assert.equal(b.coverCandidates({platform:'qq',cover:'https://y.gtimg.cn/music/photo_new/T002R500x500M000abc.jpg'})[0],'https://y.gtimg.cn/music/photo_new/T002M000abc.jpg');
 assert.deepEqual(b.coverCandidates({platform:'spotify',cover:'https://i.scdn.co/image/a'}),['https://i.scdn.co/image/a']);
});
await test('封面探测拒绝任意内网目标，不伪造像素',async()=>{const r=await new b.CoverService().inspect({platform:'qq',cover:'http://127.0.0.1:1/test'});assert.equal(r.verified,false);assert.equal(r.width,undefined)});
await test('QQ 表情保留实际 emoji，未知编码明确占位',()=>{assert.equal(b.cleanQqComment('你好[em]e400123[/em]'),'你好［表情］');assert.equal(b.cleanQqComment('[em]😀[/em]'),'😀')});
await test('保存凭据不输出任何原文或前缀',async()=>{
 const handlers=new Map();b.registerIpcHandlers({handle:(k,f)=>handlers.set(k,f)},{cookies:{set:()=>{}},adapters:{},audioProxy:{},resolver:{},lyricService:{},login:{}});
 const captured=[],old=console.log;console.log=(...args)=>captured.push(args.join(' '));
 try{const r=await handlers.get('nebula:cookie:set')(null,{platform:'qq',cookie:'uin=o123456; qqmusic_key=SYNTHETIC_SECRET_SENTINEL'});assert.equal(r.ok,true);assert.ok(!captured.join('').includes('SYNTHETIC'));assert.ok(!captured.join('').includes('123456'));}finally{console.log=old;}
});
console.log(`封面与隐私回归 ${n}/${n}`);
