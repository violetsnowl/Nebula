import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { buildSync } from 'esbuild';
const require = createRequire(import.meta.url);
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'nebula-player-test-'));
buildSync({ entryPoints: ['src/lib/audio/AudioPlayer.ts'], bundle: true, platform: 'node', format: 'cjs', outfile: path.join(temp, 'player.cjs') });
class FakeAudio extends EventTarget {
  _src = ''; currentSrc = ''; paused = true; currentTime = 0; duration = 240;
  readyState = 0; error = null; ended = false; volume = .9; muted = false;
  get src() { return this._src; }
  set src(v) { this._src = v; this.currentSrc = v; this.currentTime = 0; this.error = null; this.readyState = 0; }
  getAttribute(name) { return name === 'src' ? this._src || null : null; }
  removeAttribute(name) { if (name === 'src') this._src = ''; }
  load() { this.currentSrc = this._src; this.currentTime = 0; this.error = null; this.paused = true; this.readyState = 0; }
  async play() {
    if (this.rejectPlay) throw new DOMException('需要用户手势', 'NotAllowedError');
    if (!this._src) throw new DOMException('没有音源', 'NotSupportedError');
    this.paused = false; this.ended = false; this.readyState = 4;
    this.dispatchEvent(new Event('play'));
    this.dispatchEvent(new Event('loadedmetadata'));
    this.dispatchEvent(new Event('playing'));
  }
  pause() { this.paused = true; this.dispatchEvent(new Event('pause')); }
  finish() { this.ended = true; this.paused = true; this.dispatchEvent(new Event('ended')); }
  fail() { this.error = { message: '模拟断流' }; this.dispatchEvent(new Event('error')); }
}
globalThis.Audio = FakeAudio;
globalThis.window = { setTimeout, clearTimeout };
const { audioPlayer } = require(path.join(temp, 'player.cjs'));
const make = () => new audioPlayer.constructor();
const track = (id, audio = '') => ({ id, source: 'netease', sourceId: String(id), title: `测试${id}`, artist: '测试歌手', style: '', hue1: 0, hue2: 0, audio });
const resolved = t => ({ ...t, audio: `https://audio.test/${t.sourceId}.mp3`, resolvedAt: Date.now(), expiresAt: Date.now() + 300000 });
const tick = () => new Promise(r => setImmediate(r));
const wait = ms => new Promise(r => setTimeout(r, ms));
const defer = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const cases = [];
const test = (name, run) => cases.push({ name, run });
test('切歌取链立即停止旧音频并清空旧进度', async p => {
  const a = { ...track(1, 'file:///old.wav'), source: 'local' }, b = track(2), d = defer();
  p.playSong(a, [a, b]); p.el.currentTime = 68; p.emptyResolver = () => d.promise; p.next();
  assert.equal(p.el.paused, true); assert.equal(p.el.getAttribute('src'), null);
  assert.equal(p.state.playing, false); assert.equal(p.position(), 0); assert.equal(p.state.loading, true);
});
test('一秒内五次点歌只接纳最后一次返回', async p => {
  const ds = Array.from({length:5}, defer), songs = ds.map((_,i) => track(i));
  p.emptyResolver = t => ds[t.id].promise;
  songs.forEach(t => p.playSong(t, songs));
  for (const i of [4,2,0,3,1]) { ds[i].resolve(resolved(songs[i])); await tick(); }
  assert.equal(p.state.song.id, 4); assert.match(p.el.src, /4\.mp3/);
});
test('取链途中暂停不会在迟到响应后自动出声', async p => {
  const d = defer(), t = track(1); p.emptyResolver = () => d.promise;
  p.playSong(t); p.toggle(); d.resolve(resolved(t)); await tick();
  assert.equal(p.state.loading, false); assert.equal(p.state.playing, false); assert.equal(p.el.paused, true);
});
test('stop 取消正在解析的歌曲及其回写', async p => {
  const d = defer(), t = track(1); p.emptyResolver = () => d.promise;
  p.playSong(t); p.stop(); d.resolve(resolved(t)); await tick();
  assert.equal(p.state.song, null); assert.equal(p.el.getAttribute('src'), null);
});
test('取链失败有出口且旧音频停止', async p => {
  const songs = [{ ...track(0, 'file:///old.wav'), source:'local' }, track(1), track(2)];
  p.emptyResolver = async t => t.id === 1 ? null : resolved(t);
  p.playSong(songs[0], songs); p.next(); await wait(450);
  assert.equal(p.state.song.id, 2); assert.match(p.el.src, /2\.mp3/);
});
test('失败跳歌计时器不能覆盖后续手动选歌', async p => {
  const songs = [track(1), track(2), track(3)]; p.emptyResolver = async t => t.id === 1 ? null : resolved(t);
  p.playSong(songs[0], songs); await tick(); p.playSong(songs[2], songs); await wait(450);
  assert.equal(p.state.song.id, 3);
});
test('单曲取链失败停止，不无限重试', async p => {
  let n = 0; p.emptyResolver = async () => { n++; return null; };
  p.playSong(track(1)); await wait(450);
  assert.equal(n,1); assert.equal(p.state.failed,true); assert.equal(p.state.loading,false); assert.equal(p.el.paused,true);
});
test('浏览器拒绝 play 时进入明确暂停状态', async p => {
  p.el.rejectPlay = true; p.playSong({ ...track(1,'file:///x.wav'), source:'local' }); await tick();
  assert.equal(p.state.loading,false); assert.equal(p.state.playing,false); assert.ok(p.state.error);
});
test('断流重取保留进度且强制刷新', async p => {
  let options; p.emptyResolver = async t => resolved(t);
  p.retryResolver = async (t, _, o) => { options = o; return resolved(t); };
  p.playSong(track(1)); await tick(); p.el.currentTime = 97; p.el.fail(); await tick();
  assert.equal(p.el.currentTime,97); assert.equal(options?.forceRefresh,true);
});
test('重复插播后仍接回最初队列', async p => {
  const songs = [0,1,2].map(i => ({ ...track(i,`file:///${i}.wav`), source:'local' }));
  p.playSong(songs[0],songs); p.playTransient({...songs[1],id:99}); p.playTransient({...songs[2],id:98}); p.next();
  assert.equal(p.state.song.id,1);
});
test('顺序、随机、单曲循环及队列末尾', async p => {
  const songs = [0,1,2].map(i => ({ ...track(i,`file:///${i}.wav`), source:'local' }));
  p.playSong(songs[2],songs); p.el.finish(); assert.equal(p.state.song.id,0);
  p.setMode('repeat-one'); p.el.finish(); assert.equal(p.state.song.id,0);
  p.setMode('random'); const ids=[p.state.song.id]; p.el.finish(); ids.push(p.state.song.id); p.el.finish(); ids.push(p.state.song.id);
  assert.equal(new Set(ids).size,3);
});
test('31 分钟暂停后继续与拖动刷新过期地址', async p => {
  let n=0; p.emptyResolver=p.retryResolver=async t=>{n++;return resolved(t)};
  p.playSong(track(1)); await tick(); p.el.currentTime=55; p.toggle();
  const now=Date.now; Date.now=()=>now()+31*60000;
  try { p.toggle(); await tick(); assert.equal(n,2); assert.equal(p.el.currentTime,55); p.seek(103); assert.equal(p.el.currentTime,103); }
  finally { Date.now=now; }
});
test('预取的媒体只在下一首开始时接管，旧元素事件不回写', async p => {
  const songs=[track(1),track(2)];let calls=0;
  p.emptyResolver=async t=>{calls++;return resolved(t)};
  p.playSong(songs[0],songs);await tick();const old=p.el;
  old.currentTime=220;old.dispatchEvent(new Event('timeupdate'));await tick();
  assert.equal(calls,2);assert.equal(p.warm.el.paused,true);const warm=p.warm.el;
  old.finish();await tick();assert.equal(p.el,warm);assert.equal(p.state.song.id,2);assert.equal(calls,2);
  old.currentTime=239;old.dispatchEvent(new Event('timeupdate'));assert.equal(p.state.currentTime,0);
});
test('插队后废弃旧预取，按 FIFO 播放新下一首', async p => {
  const songs=[track(1),track(2)];p.emptyResolver=async t=>resolved(t);
  p.playSong(songs[0],songs);await tick();p.el.currentTime=220;p.el.dispatchEvent(new Event('timeupdate'));await tick();
  const old=p.warm.el;p.insertNext(track(3));await tick();assert.equal(old.getAttribute('src'),null);
  p.el.finish();await tick();assert.equal(p.state.song.id,3);
});
test('一秒内连续五次下一首只接纳最终队列项',async p=>{
 const ds=Array.from({length:6},defer),songs=ds.map((_,i)=>track(i));p.emptyResolver=t=>ds[t.id].promise;
 p.playSong(songs[0],songs);for(let i=0;i<5;i++)p.next();for(let i=5;i>=0;i--){ds[i].resolve(resolved(songs[i]));await tick();}
 assert.equal(p.state.song.id,5);assert.match(p.el.src,/5\.mp3/);
});
test('取链途中再次点同一首不会接纳前一次迟到结果',async p=>{
 const first=defer(),second=defer();let calls=0;p.emptyResolver=()=>++calls===1?first.promise:second.promise;
 p.playSong(track(1),[track(1)]);await tick();p.playSong(track(1),[track(1)]);await tick();
 second.resolve({...resolved(track(1)),audio:'https://audio.test/new.mp3'});await tick();first.resolve({...resolved(track(1)),audio:'https://audio.test/old.mp3'});await tick();assert.match(p.el.src,/new\.mp3/);
});
test('试听片段结束明确停止且不伪装完整播放',async p=>{
 const t={...track(1,'https://audio.test/trial.mp3'),trial:true,trialEndTime:30000};p.playSong(t,[t]);p.el.currentTime=31;p.el.dispatchEvent(new Event('timeupdate'));
 assert.equal(p.state.playing,false);assert.equal(p.el.paused,true);assert.match(p.state.error,/试听/);assert.equal(p.state.song.id,1);
});
test('主平台登录原因能到达现有错误栏而不丢失失败出口',async p=>{
 p.emptyResolver=async()=>{throw new Error('当前平台需要登录，其他平台也未找到可用音源')};p.playSong(track(1),[track(1)]);await tick();assert.equal(p.state.failed,true);assert.equal(p.state.loading,false);assert.match(p.state.error,/需要登录/);
});
test('有效地址播放超过两分钟后暂停继续和多次seek不重取',async p=>{
 const now=Date.now;let clock=now(),calls=0;Date.now=()=>clock;
 try{
  p.emptyResolver=p.retryResolver=async t=>{calls++;return {...resolved(t),expiresAt:clock+3600000}};
  p.playSong(track(1));await tick();const original=p.el.src;clock+=180000;
  p.seek(100);p.seek(150);p.toggle();p.toggle();await tick();
  assert.equal(calls,1);assert.equal(p.el.src,original);assert.equal(p.state.loading,false);assert.equal(p.state.playing,true);
 }finally{Date.now=now;}
});
test('未知期限按每首的首次持有时间，前一首播放六分钟不使新曲过期',async p=>{
 const now=Date.now;let clock=now(),calls=0;Date.now=()=>clock;
 try{
  p.emptyResolver=p.retryResolver=async t=>{calls++;return resolved(t)};
  const a=track(1,'https://audio.test/a.mp3'),b=track(2,'https://audio.test/b.mp3');
  p.playSong(a,[a]);clock+=6*60000;p.seek(80);assert.equal(calls,0);
  p.playSong(b,[b]);await tick();assert.equal(calls,0);assert.equal(p.state.song.resolvedAt,clock);
  assert.equal(p.state.song.expiresAt,clock+15*60000);
 }finally{Date.now=now;}
});
test('旧源真的临近上游到期时才重新解析并保留seek位置',async p=>{
 const now=Date.now;let clock=now(),calls=0;Date.now=()=>clock;
 try{
  p.emptyResolver=p.retryResolver=async t=>{calls++;return {...resolved(t),expiresAt:clock+600000}};
  p.playSong(track(1));await tick();clock+=596000;p.seek(120);await tick();
  assert.equal(calls,2);assert.equal(p.el.currentTime,120);assert.equal(p.state.playing,true);
 }finally{Date.now=now;}
});
test('音质换源刷新本曲时间而不继承上一地址的取链时间',async p=>{
 const now=Date.now;let clock=now();Date.now=()=>clock;
 try{
  p.playSong({...track(1,'https://audio.test/a.mp3'),resolvedAt:clock,expiresAt:clock+600000});
  clock+=540000;p.switchSource('https://audio.test/b.mp3',{quality:'flac'});
  assert.equal(p.state.song.resolvedAt,clock);assert.equal(p.state.song.expiresAt,clock+900000);
 }finally{Date.now=now;}
});
let failed=0;
for (const c of cases) { const p=make(); try { await c.run(p); console.log(`通过 ${c.name}`); } catch(e) { failed++; console.log(`失败 ${c.name}: ${e.message}`); } finally { p.stop(); } }
audioPlayer.stop();
fs.rmSync(temp,{recursive:true,force:true});
console.log(`播放回归 ${cases.length-failed}/${cases.length}`);
process.exit(failed ? 1 : 0);
