// 真正播放125秒后暂停/继续/seek，验证解析缓存到期不会使有效音频断开重取。
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http'),cp=require('node:child_process');
const {buildSync}=require('esbuild'),{qaRequire,chrome}=require('./qa-env.cjs');
const {chromium}=qaRequire('playwright-core');
const root=path.resolve(__dirname,'..'),work=path.resolve(root,'../valid-source-test');fs.mkdirSync(work,{recursive:true});
const args=Object.fromEntries(process.argv.slice(2).map(a=>a.slice(2).split('=')));
const variants=[{name:'after',backend:require('../dist-main/index.cjs'),source:fs.readFileSync(path.join(root,'src/lib/audio/AudioPlayer.ts'),'utf8')}];
if(args.baseline)variants.unshift({name:'before',backend:require(path.resolve(root,args.baseline)),source:cp.execFileSync('git',['show','41c1404:src/lib/audio/AudioPlayer.ts'],{cwd:root,encoding:'utf8'})});
for(const v of variants){
 buildSync({stdin:{contents:v.source+'\nwindow.__player=audioPlayer;',resolveDir:path.join(root,'src/lib/audio'),loader:'ts'},bundle:true,platform:'browser',outfile:path.join(work,v.name+'.js')});
 v.requests=0;v.fetches=0;
 v.resolver=new v.backend.SongResolver({qq:{fetchSongUrl:async()=>{v.fetches++;return {url:origin+'/audio.wav?issued='+v.fetches,expiresAt:Date.now()+3600000}}}},()=>{},async()=>true);
}
const rate=8000,wav=Buffer.alloc(44+rate*240*2);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(rate,24);wav.writeUInt32LE(rate*2,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(wav.length-44,40);
let origin='';
const server=http.createServer(async(req,res)=>{
 const u=new URL(req.url,'http://localhost');
 if(u.pathname==='/audio.wav'){
  const range=/bytes=(\d+)-(\d*)/.exec(req.headers.range||''),start=range?Number(range[1]):0,end=range?.[2]?Math.min(Number(range[2]),wav.length-1):wav.length-1;
  res.writeHead(range?206:200,{'Content-Type':'audio/wav','Accept-Ranges':'bytes','Content-Length':end-start+1,...(range?{'Content-Range':`bytes ${start}-${end}/${wav.length}`}:{})});res.end(wav.subarray(start,end+1));return;
 }
 const v=variants.find(x=>u.pathname.startsWith('/'+x.name));
 if(!v){res.writeHead(404);res.end();return;}
 if(u.pathname.endsWith('/resolve')){
  v.requests++;const t={id:'qq:valid',platform:'qq',sourceId:'valid',title:'本地合成音频',artist:'测试',album:'',duration:240,cover:'',originalUrl:'',fallbackUrl:''};
  const result=await v.resolver.resolve(t,undefined,{forceRefresh:u.searchParams.get('fresh')==='true'});
  res.setHeader('Content-Type','application/json');res.end(JSON.stringify(result));return;
 }
 if(u.pathname.endsWith('.js')){res.setHeader('Content-Type','application/javascript; charset=utf-8');res.end(fs.readFileSync(path.join(work,v.name+'.js')));return;}
 res.setHeader('Content-Type','text/html; charset=utf-8');res.end(`<!doctype html><meta charset="utf-8"><script src="/${v.name}.js"></script>`);
});
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));origin=`http://127.0.0.1:${server.address().port}`;
 const browser=await chromium.launch({executablePath:chrome,headless:true,args:['--autoplay-policy=no-user-gesture-required']});
 const errors=[];
 try{
  for(const v of variants){
   const page=v.page=await browser.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(origin+'/'+v.name);
   await page.evaluate(name=>{
    const p=window.__player;
    p.emptyResolver=p.retryResolver=async(t,_reason,context)=>{const r=await(await fetch('/'+name+'/resolve?fresh='+!!context?.forceRefresh)).json();return {...t,audio:r.url,resolvedAt:r.resolvedAt,expiresAt:r.expiresAt}};
    const t={id:1,source:'qq',sourceId:'valid',title:'本地合成音频',artist:'测试',audio:'',duration:240};p.playSong(t,[t]);
   },v.name);
   await page.waitForFunction(()=>window.__player.state.playing&&window.__player.el.currentTime>.1);
  }
  const at=Date.now();console.log('开始真实播放125秒，等待跨过两分钟缓存期限。');
  await new Promise(r=>setTimeout(r,125000));
  const result={elapsedMs:Date.now()-at,variants:{}};
  for(const v of variants){
   const before=await v.page.evaluate(()=>({url:window.__player.el.src,time:window.__player.el.currentTime}));
   await v.page.evaluate(()=>{window.__player.toggle();window.__player.toggle()});
   await v.page.waitForFunction(()=>window.__player.state.playing&&!window.__player.state.loading);
   await v.page.evaluate(()=>window.__player.seek(170));
   await v.page.waitForFunction(()=>window.__player.el.currentTime>=170&&window.__player.state.playing);
   const after=await v.page.evaluate(()=>({url:window.__player.el.src,time:window.__player.el.currentTime}));
   result.variants[v.name]={requests:v.requests,fetches:v.fetches,sameUrl:before.url===after.url,timeBefore:before.time,timeAfter:after.time};
   await v.page.evaluate(()=>window.__player.stop());
  }
  assert.deepEqual(errors,[]);assert.ok(result.elapsedMs>=125000);assert.equal(result.variants.after.requests,1);assert.equal(result.variants.after.sameUrl,true);
  if(result.variants.before)assert.ok(result.variants.before.requests>1);
  fs.writeFileSync(path.resolve(root,'../round2-valid-source.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
 }finally{await browser.close();}
})().catch(e=>{console.error(e.message);process.exitCode=1}).finally(()=>{server.closeAllConnections();server.close()});
