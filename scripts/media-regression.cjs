// 原生 Chrome 音频事件与舞台响应测量；固定本地 WAV，避免把公网波动当渲染耗时。
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {buildSync}=require('esbuild'),{qaRequire,chrome}=require('./qa-env.cjs');
const {chromium}=qaRequire('playwright-core');
const args=Object.fromEntries(process.argv.slice(2).map(a=>a.slice(2).split('=')));
const root=path.resolve(__dirname,'..'),temp=path.resolve(root,args.work||'../media-test');fs.mkdirSync(temp,{recursive:true});
const variants=[{name:'after',source:root,html:path.resolve(root,'../nebula-outputs/index.html')}];
if(args.baseline)variants.unshift({name:'baseline',source:path.resolve(root,args.baseline),html:path.resolve(root,'../baseline-outputs/index.html')});
for(const v of variants)buildSync({stdin:{contents:`import {audioPlayer} from ${JSON.stringify(path.join(v.source,'src/lib/audio/AudioPlayer.ts'))};window.__p=audioPlayer;`,resolveDir:root},bundle:true,platform:'browser',outfile:path.join(temp,v.name+'.js')});
const rate=8000,seconds=2.4,wav=Buffer.alloc(44+rate*seconds*2);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(rate,24);wav.writeUInt32LE(rate*2,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(wav.length-44,40);
for(let i=0;i<rate*seconds;i++)wav.writeInt16LE(Math.round(300*Math.sin(2*Math.PI*220*i/rate)),44+i*2);
const longWav=Buffer.alloc(44+rate*180*2);wav.copy(longWav,0,0,44);longWav.writeUInt32LE(longWav.length-8,4);longWav.writeUInt32LE(longWav.length-44,40);const longRanges=[];
const server=http.createServer((req,res)=>{
 const u=new URL(req.url,'http://localhost');res.setHeader('Access-Control-Allow-Origin','*');
 if(u.pathname==='/long.wav'){
  const m=/bytes=(\d+)-(\d*)/.exec(req.headers.range||''),start=m?+m[1]:0,end=m&&m[2]?Math.min(+m[2],longWav.length-1):longWav.length-1;longRanges.push(start);
  res.writeHead(m?206:200,{'Content-Type':'audio/wav','Accept-Ranges':'bytes','Content-Length':end-start+1,...(m?{'Content-Range':`bytes ${start}-${end}/${longWav.length}`}:{})});
  if(start>0){res.end(longWav.subarray(start,end+1));return;}
  let at=Math.min(256044,end+1);res.write(longWav.subarray(0,at));const timer=setInterval(()=>{const next=Math.min(at+16000,end+1);res.write(longWav.subarray(at,next));at=next;if(at>end){clearInterval(timer);res.end()}},1000);res.on('close',()=>clearInterval(timer));return;
 }
 if(u.pathname==='/audio.wav'){const m=/bytes=(\d+)-(\d*)/.exec(req.headers.range||''),start=m?+m[1]:0,end=m&&m[2]?Math.min(+m[2],wav.length-1):wav.length-1;setTimeout(()=>{res.writeHead(m?206:200,{'Content-Type':'audio/wav','Accept-Ranges':'bytes','Content-Length':end-start+1,...(m?{'Content-Range':`bytes ${start}-${end}/${wav.length}`}:{})});res.end(wav.subarray(start,end+1))},40);return;}
 const v=variants.find(v=>u.pathname.startsWith('/'+v.name));if(!v){res.writeHead(404);res.end();return;}
 if(u.pathname.endsWith('.js')){res.setHeader('Content-Type','application/javascript');res.end(fs.readFileSync(path.join(temp,v.name+'.js')));return;}
 res.setHeader('Content-Type','text/html');res.end(u.pathname.endsWith('/app')?fs.readFileSync(v.html):`<!doctype html><script src="/${v.name}.js"></script>`);
});
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;
 const browser=await chromium.launch({executablePath:chrome,headless:true,args:['--autoplay-policy=no-user-gesture-required']});const result={conditions:{audio:'本地 2.4 秒 PCM WAV，响应头延时 40ms，解析延时 350ms',gap:'上首 ended 到下首 playing；不是声卡输出采样',browser:'实际 Chrome HTMLAudioElement'},variants:{}};
 try{for(const v of variants){
  const page=await browser.newPage();
  await page.addInitScript(()=>{const Native=window.Audio;window.Audio=function(...args){const el=new Native(...args);el.addEventListener('playing',()=>{window.__lastPlaying={at:performance.now(),src:el.currentSrc}});return el;};});
  await page.goto(origin+'/'+v.name);
  const media=await page.evaluate(async()=>{
   const p=window.__p,wait=ms=>new Promise(r=>setTimeout(r,ms));
   const until=async f=>{const start=performance.now();while(!f()){if(performance.now()-start>6000)throw Error('媒体状态等待超时 '+JSON.stringify({duration:p.el.duration,ready:p.el.readyState,time:p.el.currentTime,buffered:p.el.buffered.length? p.el.buffered.end(p.el.buffered.length-1):0,error:p.el.error?.message}));await wait(10)}};
   const t=id=>({id,source:'netease',sourceId:String(id),title:'测试'+id,artist:'测试',style:'',hue1:0,hue2:0,audio:''});
   const resolver=async track=>{await wait(350);return {...track,audio:location.origin+'/audio.wav?id='+track.id,expiresAt:Date.now()+120000}};
   p.emptyResolver=p.retryResolver=resolver;
   const gaps=[];for(let n=0;n<5;n++){const a=t(n*2+1),b=t(n*2+2);p.stop();p.playSong(a,[a,b]);await until(()=>!p.el.paused&&p.el.currentTime>0.1);let endedAt;const old=p.el;old.addEventListener('ended',()=>{endedAt=performance.now()},{once:true});await until(()=>endedAt!==undefined);await until(()=>window.__lastPlaying?.src.endsWith('id='+b.id)&&window.__lastPlaying.at>=endedAt);gaps.push(+(window.__lastPlaying.at-endedAt).toFixed(2));p.stop();}
   const first=t(80);p.playSong(first,[first]);await until(()=>p.el.currentTime>0.1);const old=p.el;
   p.playSong(t(81),[t(81)]);const stoppedBeforeResolve=old.paused;const immediateTime=p.state.currentTime;
   for(let i=0;i<5;i++)p.playSong(t(90+i),[t(90+i)]);await until(()=>window.__lastPlaying?.src.endsWith('id=94'));await wait(100);const lastClick=p.state.song?.id;
   p.playSong(t(101),[t(101)]);p.toggle();await wait(500);const pausedDuringResolve=p.el.paused&&!p.state.playing;
   p.emptyResolver=async()=>null;p.playSong(t(102),[t(102)]);await wait(450);const offlineExit=p.state.failed&&!p.state.loading;
   p.emptyResolver=resolver;p.playSong(t(102),[t(102)]);await until(()=>window.__lastPlaying?.src.endsWith('id=102'));const recovered=p.state.playing;
   p.stop();const local={...t(110),source:'local',audio:location.origin+'/long.wav'};p.playSong(local,[local]);await until(()=>p.el.duration===180&&p.el.buffered.length>0);const bufferedBefore=p.el.buffered.end(p.el.buffered.length-1);p.seek(130);await until(()=>p.el.currentTime>130&&p.el.readyState>=3&&!p.el.paused);const unbufferedSeek=bufferedBefore<130&&p.el.currentTime>130;
   p.stop();return {gapsMs:gaps,stoppedBeforeResolve,immediateTime,lastClick,pausedDuringResolve,offlineExit,recovered,bufferedBefore,unbufferedSeek};
  });
  await page.close();const ui=await browser.newPage({viewport:{width:1600,height:900}});
  await ui.route(/soundhelix\.com/,route=>route.fulfill({status:200,contentType:'audio/wav',body:wav}));
  await ui.addInitScript(()=>localStorage.setItem('music-nebula.stage-space.v2',JSON.stringify({classic:true})));
  await ui.goto(origin+'/'+v.name+'/app?demo=1');await ui.waitForFunction(()=>window.__nebula?.player);
  await ui.evaluate(()=>window.__nebula.stageMode('cluster'));await ui.waitForTimeout(1800);
  const frames=await ui.evaluate(async()=>{
   const wait=ms=>new Promise(r=>setTimeout(r,ms)),deltas=[],clicks=[],long=[];
   const observer=new PerformanceObserver(list=>{for(const e of list.getEntries())long.push(e.duration)});observer.observe({type:'longtask'});
   let active=true,last;function tick(now){if(last)deltas.push(now-last);last=now;if(active)requestAnimationFrame(tick)}requestAnimationFrame(tick);
   const cards=[...document.querySelectorAll('.stage-3d .music-card')];for(const card of cards.slice(0,5)){const at=performance.now();card.click();await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));clicks.push(performance.now()-at);await wait(220)}
   await wait(1800);active=false;observer.disconnect();window.__nebula.player.stop();return {cards:cards.length,frameMs:deltas,clickToTwoFramesMs:clicks,longTasksMs:long};
  });await ui.close();result.variants[v.name]={media,frames};console.log(v.name,JSON.stringify(media));
 }}finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r))}
 result.longRangeStarts=longRanges;fs.writeFileSync(path.resolve(root,args.out||'../media-result.json'),JSON.stringify(result,null,2));
 const a=result.variants.after.media;if(!a.stoppedBeforeResolve||a.lastClick!==94||!a.pausedDuringResolve||!a.offlineExit||!a.recovered||!a.unbufferedSeek||!longRanges.some(n=>n>16000*100))process.exitCode=1;
})().catch(e=>{console.error(e.message);process.exitCode=1;server.closeAllConnections();server.close()});
