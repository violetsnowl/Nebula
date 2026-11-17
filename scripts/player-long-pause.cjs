const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const {qaRequire,chrome}=require('./qa-env.cjs');
const {chromium}=qaRequire('playwright-core');
const buildDir=path.resolve(__dirname,'../../nebula-outputs');
const output=path.resolve(__dirname,'../../long-pause-result.json');
const rate=8000, duration=180, wav=Buffer.alloc(44+rate*duration*2);
wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(rate,24);wav.writeUInt32LE(rate*2,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(wav.length-44,40);
for(let i=0;i<rate*duration;i++)wav.writeInt16LE(Math.round(500*Math.sin(i*2*Math.PI*220/rate)),44+i*2);
const server=http.createServer((req,res)=>{
  const u=new URL(req.url,'http://localhost');res.setHeader('Access-Control-Allow-Origin','*');
  if(u.pathname!=='/tone.wav') {
    const f=path.resolve(buildDir,'.'+u.pathname);
    const root=buildDir+path.sep;
    if(!f.startsWith(root)||!fs.existsSync(f)){res.writeHead(404);res.end();return}
    res.setHeader('Content-Type',f.endsWith('.js')?'application/javascript':f.endsWith('.css')?'text/css':'text/html');fs.createReadStream(f).pipe(res);return;
  }
  if(Date.now()-Number(u.searchParams.get('issued'))>5*60000){res.writeHead(403);res.end();return}
  const match=/bytes=(\d+)-(\d*)/.exec(req.headers.range||'');const start=match?Number(match[1]):0,end=match&&match[2]?Math.min(Number(match[2]),wav.length-1):wav.length-1;
  res.writeHead(match?206:200,{'Content-Type':'audio/wav','Accept-Ranges':'bytes','Content-Length':end-start+1,...(match?{'Content-Range':`bytes ${start}-${end}/${wav.length}`}:{})});res.end(wav.subarray(start,end+1));
});
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({executablePath:chrome,headless:true,args:['--autoplay-policy=no-user-gesture-required']});
 try{
  const page=await browser.newPage();
  await page.addInitScript(()=>localStorage.setItem('music-nebula.stage-space.v2',JSON.stringify({classic:true})));
  await page.goto(`http://127.0.0.1:${server.address().port}/index.html?demo=1`);
  await page.waitForFunction(()=>window.__nebula?.player);
  await page.evaluate(port=>{
   const p=window.__nebula.player;window.__refreshes=0;
   p.emptyResolver=p.retryResolver=async t=>{window.__refreshes++;return {...t,audio:`http://127.0.0.1:${port}/tone.wav?issued=${Date.now()}`,expiresAt:Date.now()+300000}};
   p.playSong({id:901,source:'qq',sourceId:'synthetic-expiry',title:'长暂停验证',artist:'测试',style:'',hue1:0,hue2:0,audio:''});
  },server.address().port);
  await page.waitForFunction(()=>window.__nebula.player.state.playing);
  await page.waitForTimeout(1600);await page.evaluate(()=>window.__nebula.player.toggle());
  const pausedAt=Date.now();fs.writeFileSync(output,JSON.stringify({status:'paused',pausedAt:new Date(pausedAt).toISOString(),minutes:31}));console.log('已暂停，31 分钟后检查重新取链与拖动');
  await new Promise(r=>setTimeout(r,31*60000));
  await page.evaluate(()=>window.__nebula.player.toggle());await page.waitForFunction(()=>window.__nebula.player.state.playing);
  await page.evaluate(()=>window.__nebula.player.seek(80));await page.waitForTimeout(1600);
  const result=await page.evaluate(()=>({refreshes:window.__refreshes,playing:window.__nebula.player.state.playing,currentTime:window.__nebula.player.el.currentTime,error:window.__nebula.player.state.error}));
  result.pausedMs=Date.now()-pausedAt;result.pass=result.refreshes===2&&result.playing&&result.currentTime>=80&&!result.error;
  fs.writeFileSync(output,JSON.stringify(result,null,2));console.log(JSON.stringify(result));
 }finally{await browser.close();server.close()}
})().catch(e=>{fs.writeFileSync(output,JSON.stringify({error:e.message}));console.error(e.message);process.exit(1)});
