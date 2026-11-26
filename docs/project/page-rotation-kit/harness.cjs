// 版面真实数据渲染脚本：用真实会话曲库当星云、真实歌词喂版面。
//   node harness.cjs stats            → data/assign.json（每首歌每页用了哪套版式）
//   node harness.cjs shots targets.json → shots/*.png（定向截图）
// 只读用户数据副本；桌面 API 全部本地桩，不发任何平台请求（封面图从 CDN 直接加载，与桌面一致）。
const fs = require('fs');
const path = require('path');
const { qaRequire, chrome } = require('E:/CUFE/vibecoding/nebula/scripts/qa-env.cjs');
const { chromium } = qaRequire('playwright-core');

const D = path.join(__dirname, 'data');
const HTML = process.env.NEBULA_HTML || 'file:///E:/CUFE/vibecoding/nebula-outputs/index.html';
const mode = process.argv[2] || 'stats';
const shapes = JSON.parse(fs.readFileSync(path.join(D, 'shapes.json'), 'utf8'));
const lyr = JSON.parse(fs.readFileSync(path.join(D, 'lyrics-all.json'), 'utf8'));
const allTracks = JSON.parse(fs.readFileSync(path.join(D, 'all-tracks.json'), 'utf8'));

const wav = (sec) => {
  const rate = 4000;
  const n = rate * sec;
  const b = Buffer.alloc(44 + n, 128);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate, 28);
  b.writeUInt16LE(1, 32); b.writeUInt16LE(8, 34); b.write('data', 36); b.writeUInt32LE(n, 40);
  return b;
};

async function boot(opts = {}) {
  const browser = await chromium.launch({ executablePath: chrome, headless: true, args: ['--force-color-profile=srgb', '--hide-scrollbars', '--autoplay-policy=no-user-gesture-required'] });
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: opts.dpr || 1 });
  const page = await ctx.newPage();
  await page.route(/^https:\/\/silence\.local\//, (route) => {
    const sec = Math.max(30, Math.min(900, parseInt(route.request().url().split('/').pop(), 10) || 300));
    return route.fulfill({ status: 200, contentType: 'audio/wav', headers: { 'Access-Control-Allow-Origin': '*' }, body: wav(sec) });
  });
  const session = { tracks: allTracks.map(({ key, ...t }) => ({ ...t, id: key })), playlist: null };
  await page.addInitScript(([sess, sm]) => {
    try {
      localStorage.setItem('music-nebula.session', JSON.stringify(sess));
      localStorage.setItem('music-nebula.lyric-settings', JSON.stringify({ listenDelay: 3, listenPin: true }));
      localStorage.setItem('music-nebula.stage-space.v3', JSON.stringify({ layout: 'chroma', lens: 0.8, tilt: 0, tint: true, lyricShape: true, stageMode: sm }));
    } catch {}
    window.__lyr = null;
    window.__dur = 300;
    const ok = (data) => Promise.resolve({ ok: true, data });
    const silence = (sec) => {
      const rate = 4000, n = rate * sec, b = new Uint8Array(44 + n).fill(128), v = new DataView(b.buffer);
      const w = (o, s) => [...s].forEach((c, i) => (b[o + i] = c.charCodeAt(0)));
      w(0, 'RIFF'); v.setUint32(4, 36 + n, true); w(8, 'WAVEfmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
      v.setUint32(24, rate, true); v.setUint32(28, rate, true); v.setUint16(32, 1, true); v.setUint16(34, 8, true); w(36, 'data'); v.setUint32(40, n, true);
      let bin = '';
      for (let i = 0; i < b.length; i += 0x8000) bin += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
      return 'data:audio/wav;base64,' + btoa(bin);
    };
    const base = {
      resolveSong: (track) => ok({ url: silence(Math.ceil(window.__dur + 15)), quality: 'standard', playable: true, fallback: false, platform: track.platform, sourceId: track.sourceId }),
      cancelResolve: () => ok(null),
      songQualities: () => ok([{ level: 'standard', label: '标准' }]),
      fetchLyric: (track) => (window.__lyr && window.__lyrKey === `${track.platform}:${track.sourceId}` ? ok(window.__lyr) : Promise.resolve({ ok: false, error: 'stub' })),
      loginAccount: () => ok({ loggedIn: false }),
      loginPlaylists: () => ok([]),
      onSheetOpen: () => () => {},
      onSheetClosed: () => () => {},
    };
    window.nebulaAPI = new Proxy(base, { get: (o, k) => (k in o ? o[k] : () => Promise.resolve({ ok: false, error: 'stub' })) });
  }, [session, 'page']);
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(HTML, { waitUntil: 'load' });
  await page.waitForTimeout(2500);
  return { browser, page, errors };
}

/** 播一首歌并等版面建好；返回 pages()。 */
async function playKey(page, key, ov = {}) {
  const sh = shapes[key];
  const t = allTracks.find((x) => x.key === key);
  await page.evaluate(([k, data, dur, meta]) => {
    window.__lyr = data;
    window.__lyrKey = k;
    window.__dur = dur;
    const n = window.__nebula;
    const lib = n.songsData();
    const [platform, ...rest] = k.split(':');
    const sourceId = rest.join(':');
    let s = meta.force ? null : lib.find((x) => x.source === platform && x.sourceId === sourceId);
    if (!s) s = { ...lib[0], id: 900000 + Math.floor(Math.random() * 99999), source: platform, platform, sourceId, title: meta.title || k, artist: meta.artist || '', cover: meta.cover || lib[0].cover };
    n.player.playSong(s, [s]);
  }, [key, lyr[key], Math.max(sh.lastEnd, t?.duration || 0), { title: ov.title || t?.title, artist: t?.artist, cover: ov.cover || t?.cover, force: !!ov.cover }]);
  const want = sh.stanzas.length;
  const okPages = await page
    .waitForFunction((w) => { const p = window.__nebulaLyricPage; const ps = p && p.pages(); return !!ps && ps.length === w; }, want, { timeout: 20000, polling: 50 })
    .then(() => true)
    .catch(() => false);
  const pages = await page.evaluate(() => (window.__nebulaLyricPage ? window.__nebulaLyricPage.pages() : []));
  return { okPages, pages };
}

async function stats() {
  const { browser, page, errors } = await boot();
  const out = {};
  const keys = Object.keys(shapes);
  let i = 0, bad = 0;
  for (const k of keys) {
    const r = await playKey(page, k).catch((e) => ({ okPages: false, pages: [], err: e.message }));
    if (!r.okPages) bad++;
    out[k] = { ok: r.okPages, tpl: r.pages.map((p) => p.tpl), vert: r.pages.map((p) => p.vert), s: r.pages.map((p) => p.s) };
    if (++i % 50 === 0) process.stdout.write(`${i}/${keys.length} bad=${bad}\n`);
  }
  fs.writeFileSync(path.join(D, 'assign.json'), JSON.stringify(out));
  process.stdout.write(`done ${i} bad=${bad} errors=${errors.length}\n${errors.slice(0, 5).join('\n')}\n`);
  await browser.close();
}

/** targets: [{ key, tpl, tag }]；每项按 tpl 找页，跳到该页最后一句开唱后 0.7s（整页大部分唱过、当前句在走）截图。 */
async function shots(file) {
  const targets = JSON.parse(fs.readFileSync(file, 'utf8'));
  const dir = process.env.NEBULA_SHOTS || path.join(__dirname, 'shots');
  fs.mkdirSync(dir, { recursive: true });
  const { browser, page, errors } = await boot();
  const log = [];
  for (const tg of targets) {
    const { okPages, pages } = await playKey(page, tg.key, { cover: tg.cover, title: tg.title });
    const sh = shapes[tg.key];
    let j = tg.page ?? pages.findIndex((p) => p.tpl === tg.tpl);
    if (j < 0 || (!okPages && !process.env.NEBULA_LOOSE)) { log.push({ ...tg, miss: true }); continue; }
    const stz = sh.stanzas[j] || sh.stanzas[sh.stanzas.length - 1];
    const last = sh.lines[stz.to];
    // 页数和 shapes.json 对不上时（歌词引擎改过）：按真实页的起点算，取这页结束前约 1.2s
    const at = tg.at ?? (okPages ? last.s + Math.min(0.6, (last.e - last.s) * 0.45) : (pages[j + 1] ? pages[j + 1].s : sh.lastEnd) - 1.2);
    await page.waitForFunction(() => { const s = window.__nebula.player.getState(); return s.playing && s.duration > 0 && s.currentTime > 0.05; }, null, { timeout: 10000, polling: 50 }).catch(() => {});
    await page.evaluate((s) => window.__nebula.player.seek(s), Math.max(0, at - 2.5));
    await page.mouse.move(800, 450);
    await page.waitForFunction(() => !!document.querySelector('.app[data-listen]'), null, { timeout: 15000 }).catch(() => {});
    const W = Math.min(1.4, Math.max(0.5, at - (okPages ? stz.s : pages[j].s) - 0.2));
    await page.evaluate((s) => window.__nebula.player.seek(s), at - W);
    await page.waitForTimeout(W * 1000);
    const name = `${tg.tag || tg.tpl}-${tg.key.replace(/[^a-z0-9]+/gi, '_')}.png`;
    await page.screenshot({ path: path.join(dir, name) });
    const info = await page.evaluate(() => {
      const b = window.__nebulaLyricPage?.bounds?.() || [];
      return { listen: !!document.querySelector('.app[data-listen]'), bounds: b.filter((x) => x && x.units).map((x) => ({ tpl: x.tpl, out: x.out, clash: x.clash })) };
    });
    log.push({ ...tg, page: j, at, name, ...info });
    process.stdout.write(`${name} listen=${info.listen}\n`);
  }
  fs.writeFileSync(path.join(dir, 'log-' + path.basename(file)), JSON.stringify(log, null, 1));
  process.stdout.write(`errors=${errors.length}\n${errors.slice(0, 5).join('\n')}\n`);
  await browser.close();
}

(mode === 'audit' ? Promise.resolve() : mode === 'stats' ? stats() : shots(process.argv[3])).catch((e) => {
  console.error(e);
  process.exit(1);
});

/** audit：每套版式抽 N 首，跳到该页最后一句，读 bounds（out / clash / bar / no），不截图。 */
async function audit(n) {
  const BOLD = process.env.NEBULA_TPLS ? process.env.NEBULA_TPLS.split(',') : ['held', 'spine', 'justify', 'foot', 'bleed', 'diag', 'field', 'groove', 'grid', 'corner', 'fault', 'drum', 'register', 'cut'];
  const as = JSON.parse(fs.readFileSync(path.join(D, 'assign.json'), 'utf8'));
  const { browser, page, errors } = await boot();
  const res = [];
  for (const t of BOLD) {
    const keys = Object.keys(as).filter((k) => as[k].ok && as[k].tpl.includes(t));
    const step = Math.max(1, Math.floor(keys.length / n));
    for (let i = 0; i < keys.length && i / step < n; i += step) {
      const key = keys[i];
      const { okPages, pages } = await playKey(page, key);
      const j = pages.findIndex((p) => p.tpl === t);
      if (!okPages || j < 0) { res.push({ t, key, miss: true }); continue; }
      const sh = shapes[key];
      const stz = sh.stanzas[j];
      const last = sh.lines[stz.to];
      const at = last.s + Math.min(0.6, (last.e - last.s) * 0.45);
      await page.waitForFunction(() => { const s = window.__nebula.player.getState(); return s.playing && s.duration > 0 && s.currentTime > 0.05; }, null, { timeout: 10000, polling: 50 }).catch(() => {});
      await page.evaluate((s) => window.__nebula.player.seek(s), at - 0.9);
      await page.waitForFunction(() => !!document.querySelector('.app[data-listen]'), null, { timeout: 15000 }).catch(() => {});
      await page.waitForTimeout(900);
      const b = await page.evaluate((x) => (window.__nebulaLyricPage.bounds() || []).find((q) => q.tpl === x) || null, t);
      res.push({ t, key, vert: pages[j].vert, script: sh.script, ...(b || { hidden: true }) });
    }
    const mine = res.filter((r) => r.t === t && !r.miss && !r.hidden);
    process.stdout.write(`${t.padEnd(9)} n=${mine.length} out>0:${mine.filter((r) => r.out > 0).length} clash>2:${mine.filter((r) => r.clash > 2).length} bar>0:${mine.filter((r) => r.bar > 0).length} no>0:${mine.filter((r) => r.no > 0).length} hidden:${res.filter((r) => r.t === t && r.hidden).length}\n`);
  }
  fs.writeFileSync(path.join(D, `audit-${process.argv[4] || 'x'}.json`), JSON.stringify(res));
  process.stdout.write(`errors=${errors.length}\n`);
  await browser.close();
}
if (mode === 'audit') audit(Number(process.argv[3] || 20)).catch((e) => { console.error(e); process.exit(1); });
