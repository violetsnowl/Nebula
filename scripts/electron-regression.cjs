// 使用隔离 userData 和合成 WAV；不访问用户原账号或打开登录窗口。
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {qaRequire}=require('./qa-env.cjs'),{_electron}=qaRequire('playwright-core');
const root=path.resolve(__dirname,'..'),work=path.resolve(root,'../electron-test'),profile=path.join(work,'profile'),music=path.join(work,'music');
fs.mkdirSync(profile,{recursive:true});fs.mkdirSync(music,{recursive:true});
const rate=8000,wav=Buffer.alloc(44+rate*12*2);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(rate,24);wav.writeUInt32LE(rate*2,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(wav.length-44,40);
fs.writeFileSync(path.join(music,'原生本地音频.wav'),wav);
const launcher=path.join(work,'bootstrap.cjs');
fs.writeFileSync(launcher,`const e=require('electron');e.app.setPath('userData',${JSON.stringify(profile)});const Native=e.BrowserWindow,Module=require('node:module'),load=Module._load,main=${JSON.stringify(path.join(root,'electron/main.cjs'))};Module._load=function(id,parent,...rest){if(id==='electron'&&parent?.filename===main)return {...e,BrowserWindow:class extends Native{constructor(opts){super({...opts,show:false});}}};return load.call(this,id,parent,...rest);};e.dialog.showOpenDialog=async()=>({canceled:false,filePaths:[${JSON.stringify(music)}]});require(main);`);
(async()=>{
 const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
 const app=await _electron.launch({executablePath:require('electron'),args:[launcher],env,timeout:30000});
 try{
  const page=await app.firstWindow();await page.waitForFunction(()=>window.nebulaAPI?.openLocalDirectory);
  await page.evaluate(()=>localStorage.setItem('music-nebula.stage-space.v2',JSON.stringify({classic:true})));
  await page.goto('file:///'+path.join(root,'dist/index.html').replace(/\\/g,'/')+'?demo=1');await page.waitForFunction(()=>window.__nebula?.player);
  const imported=await page.evaluate(()=>window.nebulaAPI.openLocalDirectory());assert.equal(imported.ok,true);assert.equal(imported.data.tracks.length,1);assert.equal(imported.data.tracks[0].duration,12);
  await page.evaluate(t=>window.__nebula.player.playSong({id:1,source:'local',sourceId:t.sourceId,title:t.title,artist:t.artist,style:'',hue1:0,hue2:0,audio:t.originalUrl},[{id:1,source:'local',sourceId:t.sourceId,title:t.title,artist:t.artist,style:'',hue1:0,hue2:0,audio:t.originalUrl}]),imported.data.tracks[0]);
  await page.waitForFunction(()=>window.__nebula.player.state.playing&&window.__nebula.player.el.currentTime>0.1);
  await page.evaluate(()=>window.__nebula.player.seek(8));await page.waitForFunction(()=>window.__nebula.player.el.currentTime>8);
  const cancelled=await page.evaluate(async()=>{const t={id:'qq:test',sourceId:'000xLw2D0E5Xjm',platform:'qq',title:'丸ノ内サディスティック',artist:'椎名林檎',duration:235,cover:'',originalUrl:'',fallbackUrl:''};const p=window.nebulaAPI.resolveSong(t,undefined,{requestId:'native-cancel'});await window.nebulaAPI.cancelResolve('native-cancel');return p;});
  assert.equal(cancelled.ok,true);assert.equal(cancelled.data.code,'CANCELLED');
  const isolated=await app.evaluate(({app,BrowserWindow})=>({userData:app.getPath('userData'),visible:BrowserWindow.getAllWindows().some(w=>w.isVisible()),version:process.versions.electron}));assert.equal(isolated.userData,profile);assert.equal(isolated.visible,false);
  const result={pass:true,electron:isolated.version,hidden:true,isolatedProfile:true,localImport:1,localDuration:12,realFilePlayback:true,seekPast8:true,ipcCancelled:true};
  fs.writeFileSync(path.resolve(root,'../electron-result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
 }finally{await app.close()}
})().catch(e=>{console.error(e.message);process.exitCode=1});
