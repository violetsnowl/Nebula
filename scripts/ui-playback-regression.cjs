// 使用真实 React/Chrome 运行生产组件，覆盖歌词换数组时的渲染竞态。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { buildSync } = require('esbuild');
const { qaRequire, chrome } = require('./qa-env.cjs');
const { chromium } = qaRequire('playwright-core');
const root = path.resolve(__dirname, '..');
const work = path.resolve(root, '../ui-playback-test');
fs.mkdirSync(work, { recursive: true });
// 只在测试副本暴露私有组件，生产源码没有新增导出或测试接口。
const dock = path.join(root, 'src/components/AccountDock.tsx');
const previewSource = fs.readFileSync(dock, 'utf8') + '\nexport { LyricPreview };\n';
const preview = path.join(work, 'preview.tsx');
// 放到同一源码目录的虚拟入口解析相对依赖；不写入生产目录。
const entry = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { LyricPreview } from './preview';
import { audioPlayer } from ${JSON.stringify(path.join(root, 'src/lib/audio/AudioPlayer.ts'))};
import { BottomPlayer } from ${JSON.stringify(path.join(root, 'src/components/player/BottomPlayer.tsx'))};
import { resolveTrackForPlay } from ${JSON.stringify(path.join(root, 'src/lib/audio/desktopPlayback.ts'))};
const root = createRoot(document.getElementById('root')!);
const settings = {fontSize:44,currentScale:1.22,bold:false,lyricColorSource:'cover',customColor:'#ffffff'} as any;
window.__uiTest = {
  render(lines:any[], time:number) {
    audioPlayer.state.currentTime = time;
    flushSync(() => root.render(<LyricPreview settings={settings} maxFont={100} active={true} lines={lines} />));
  },
  mountPlayer() {
    const noop=()=>{};
    flushSync(() => root.render(<BottomPlayer mode="sequential" qualities={[]} quality="" onCycleMode={noop}
      onSelectQuality={noop} onOpenNowPlaying={noop} onOpenComments={noop} onOpenSongDetail={noop} onOpenArtist={noop} />));
  },
  load(kind:string) {
    audioPlayer.stop();
    const t={id:1,source:kind==='local'?'local':'qq',sourceId:'test',title:'按钮回归',artist:'测试',
      audio:kind==='local'?'/audio.wav':'',hue1:0,hue2:0} as any;
    audioPlayer.emptyResolver=kind==='fail'?async()=>null:()=>new Promise(()=>{});
    audioPlayer.playSong(t,[t]);
  },
  waiting() {audioPlayer.el.dispatchEvent(new Event('waiting'));},
  expired() {
    audioPlayer.stop();let requests=0;
    window.nebulaAPI={importPlaylist:async()=>({ok:false}),resolveSong:async()=>{
      requests++;return {ok:true,data:{url:'',playable:false,code:'AUTH_EXPIRED',error:'QQ 登录已过期，请重新登录'}};
    },cancelResolve:async()=>({ok:true})} as any;
    const t={id:1,source:'qq',sourceId:'fixture',title:'过期提示回归',artist:'测试',audio:'',hue1:0,hue2:0} as any;
    audioPlayer.emptyResolver=resolveTrackForPlay;audioPlayer.playSong(t,[t,{...t,id:2,sourceId:'fixture-2'}]);
    window.__authRequests=()=>requests;
  },
  state() {const {playIntent,playing,loading,failed}=audioPlayer.getState();return {playIntent,playing,loading,failed};},
  stop() { flushSync(() => root.unmount()); audioPlayer.stop(); }
};`;
// buildSync 不支持 plugin：预先将该模块的相对 import 变成绝对路径，只改测试副本。
const absoluteImport = (_, before, name, after) => before + path.resolve(path.dirname(dock), name).replace(/\\/g, '/') + after;
fs.writeFileSync(preview, previewSource.replace(/(from\s*['"])(\.[^'"]+)(['"])/g, absoluteImport)
  .replace(/(import\s*['"])(\.[^'"]+)(['"])/g, absoluteImport));
buildSync({ stdin: { contents: entry, loader: 'tsx', resolveDir: work }, bundle: true, platform: 'browser',
  nodePaths: [path.join(root, 'node_modules')], jsx: 'automatic', define: { 'import.meta.env': '{}' },
  loader: { '.css': 'empty', '.webp': 'dataurl', '.png': 'dataurl', '.svg': 'dataurl', '.jpg': 'dataurl' },
  outfile: path.join(work, 'test.js'), logLevel: 'silent' });
const wav=Buffer.alloc(44+16000*2*10);wav.write('RIFF',0);wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);
wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(16000,24);
wav.writeUInt32LE(32000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(wav.length-44,40);
const server = http.createServer((req, res) => {
  if(req.url==='/audio.wav'){res.setHeader('Content-Type','audio/wav');res.end(wav);return;}
  if (req.url === '/test.js') { res.setHeader('Content-Type', 'application/javascript; charset=utf-8'); res.end(fs.readFileSync(path.join(work, 'test.js'))); }
  else { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end('<!doctype html><meta charset="utf-8"><div id="root"></div><script src="/test.js"></script>'); }
});
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ executablePath: chrome, headless: true, args:['--autoplay-policy=no-user-gesture-required'] });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => { errors.push(error.message); console.error('组件运行异常：' + error.message); });
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    const lines = Array.from({ length: 8 }, (_, i) => ({ timeMs: i * 10000, text: '原歌曲第' + i + '句', translation: '译文' + i }));
    await page.evaluate(rows => window.__uiTest.render(rows, 45), lines);
    await page.waitForFunction(() => document.querySelector('.rp-line')?.textContent.includes('第4句'));
    // useLyrics 切歌先清空，再返回较短的新歌词，旧 pick=4 仍可能活到下一次 effect。
    await page.evaluate(() => window.__uiTest.render([], 0));
    await page.waitForTimeout(50);
    assert.equal(await page.locator('.rp-preview').count(), 1, '清空歌词不能卸载整个预览');
    await page.evaluate(() => window.__uiTest.render([{ timeMs: 0, text: '新歌曲第一句' }], 0));
    await page.waitForFunction(() => document.querySelector('.rp-line')?.textContent.includes('新歌曲第一句'));
    await page.evaluate(rows => window.__uiTest.render(rows, 65), lines);
    await page.waitForFunction(() => document.querySelector('.rp-line')?.textContent.includes('第6句'));
    await page.evaluate(() => window.__uiTest.render([{ timeMs: 0, text: '更短的新歌词' }], 0));
    await page.waitForFunction(() => document.querySelector('.rp-line')?.textContent.includes('更短的新歌词'));
    assert.deepEqual(errors, [], '切歌与数组缩短不能产生渲染异常');
    await page.evaluate(() => {window.__uiTest.mountPlayer();window.__uiTest.load('pending');});
    await page.waitForFunction(() => document.querySelector('.bp-play')?.getAttribute('aria-label')==='暂停');
    assert.deepEqual(await page.evaluate(()=>window.__uiTest.state()),{playIntent:true,playing:false,loading:true,failed:false});
    await page.locator('.bp-play').click();
    await page.waitForFunction(() => document.querySelector('.bp-play')?.getAttribute('aria-label')==='播放');
    assert.equal(await page.evaluate(()=>window.__uiTest.state().playIntent),false);
    await page.evaluate(()=>window.__uiTest.load('local'));
    await page.waitForFunction(()=>window.__uiTest.state().playing);
    await page.evaluate(()=>window.__uiTest.waiting());
    await page.waitForFunction(() => document.querySelector('.bp-play')?.getAttribute('aria-label')==='暂停');
    assert.equal(await page.evaluate(()=>window.__uiTest.state().playing),false);
    await page.locator('.bp-play').click();
    await page.waitForFunction(() => document.querySelector('.bp-play')?.getAttribute('aria-label')==='播放');
    await page.evaluate(()=>window.__uiTest.load('fail'));
    await page.waitForFunction(()=>window.__uiTest.state().failed);
    assert.equal(await page.locator('.bp-play').getAttribute('aria-label'),'播放');
    await page.evaluate(()=>window.__uiTest.expired());
    await page.waitForFunction(()=>document.querySelector('.bp-status')?.textContent==='QQ 登录已过期，请重新登录');
    await page.waitForTimeout(450);
    assert.equal(await page.evaluate(()=>window.__authRequests()),1,'过期不能自动跳到下一首');
    assert.equal(await page.locator('.bp-status').textContent(),'QQ 登录已过期，请重新登录');
    assert.equal(await page.locator('.bp-play').getAttribute('aria-label'),'播放');
    assert.deepEqual(errors, [], '按钮真实组件运行不得报错');
    await page.evaluate(() => window.__uiTest.stop());
    console.log('界面播放回归：歌词换数组2项、按钮3项、过期提示及停止跳歌1项，6/6 通过');
  } finally { await browser.close(); }
})().catch(error => { console.error(error.message); process.exitCode = 1; })
  .finally(() => { server.closeAllConnections(); server.close(); });
