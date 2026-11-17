// 联网实测：数据集与原始结果默认写到仓库外，不输出凭据、直链或歌词原文。
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = Object.fromEntries(process.argv.slice(2).map(x => { const i = x.indexOf('='); return i < 0 ? [x.replace(/^--/, ''), true] : [x.slice(2, i), x.slice(i + 1)]; }));
const backendPath = path.resolve(root, String(args.backend || 'dist-main/index.cjs'));
const b = require(backendPath);
const dataDir = path.resolve(root, String(args.profile || '../benchmark-profile'));
fs.mkdirSync(dataDir, { recursive: true });
b.setCookieDataDir(dataDir);
const cookies = new b.CookieStore();
const adapters = b.createAdapters(new b.HttpClient(cookies), cookies);
const dataset = path.resolve(root, String(args.samples || '../benchmark-samples.json'));
const out = path.resolve(root, String(args.out || '../benchmark-result.json'));
const print = console.log.bind(console);
// 适配器旧日志可能包含带签名的地址：本工具只保留结构化统计。
console.log = console.warn = console.error = () => {};
const bounded = async (p, ms) => {
  let timer;
  try { return await Promise.race([p, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('watchdog')), ms); })]); }
  finally { clearTimeout(timer); }
};
const clean = x => String(x || '').replace(/<[^>]*>/g, '').trim();
if (args.prepare) {
  const groups = {
    zh: ['七里香 周杰伦', '红豆 王菲', '十年 陈奕迅', '海阔天空 Beyond'],
    ja: ['丸ノ内サディスティック 椎名林檎', 'アイドル YOASOBI', 'First Love 宇多田ヒカル', 'Lemon 米津玄師'],
    en: ['Love Story Taylor Swift', 'Hello Adele', 'Bohemian Rhapsody Queen', 'Yesterday Beatles'],
    ko: ['Dynamite BTS', 'DDU-DU DDU-DU BLACKPINK', '밤편지 IU', '봄날 BTS'],
  };
  const rows = [];
  for (const [language, queries] of Object.entries(groups)) {
    const lists = { netease: [], qq: [], kugou: [] };
    for (const query of queries) {
      await Promise.all(Object.keys(lists).map(async platform => {
        try {
          let found = await bounded(adapters[platform].searchSongs(query, 12), 16000);
          if (platform === 'netease' && !found.length) {
            const r = await bounded(b.callNcmSafe('cloudsearch', { keywords: query, type: 1, limit: 12 }), 16000);
            found = (r?.body?.result?.songs || []).map(b.mapNeteaseTrack).filter(Boolean);
          }
          for (const t of found) if (!lists[platform].some(x => x.id === t.id)) lists[platform].push({ ...t, title: clean(t.title), artist: clean(t.artist), album: clean(t.album), language, query });
        } catch {}
      }));
    }
    // 平台交错采样；保留同歌不同版本，以覆盖翻唱、Live、Remaster。
    for (let i = 0, n = 0; n < 25 && i < 60; i++) {
      for (const platform of Object.keys(lists)) {
        if (lists[platform][i] && n < 25) { rows.push(lists[platform][i]); n++; }
      }
    }
    print(`样本 ${language}: ${rows.filter(x => x.language === language).length}`);
  }
  fs.writeFileSync(dataset, JSON.stringify(rows, null, 2));
  print(`公开候选数据集 ${rows.length} 首；语种按搜索种子分组，需人工核对。`);
  process.exit(rows.length >= 100 ? 0 : 2);
}
const samples = JSON.parse(fs.readFileSync(dataset, 'utf8')).slice(0, Number(args.limit || 100));
const resolver = new b.SongResolver(adapters, () => {}, (url, platform, signal) => b.canPlayAudio(url, { platform, cookie: cookies.getHeader(platform), signal }));
const lyricService = new b.LyricService(adapters); // 每轮不使用磁盘歌词缓存，便于前后公平比较。
const watchdog = Number(args.watchdog || 25000);
const rows = [];
let cursor = 0;
const startedAt = new Date().toISOString();
async function run() {
  while (cursor < samples.length) {
    const i = cursor++, t = samples[i], row = { index: i, platform: t.platform, language: t.language || 'unknown', id: t.id };
    const start = performance.now();
    try {
      const r = await bounded(resolver.resolve({ ...t, originalUrl: '', fallbackUrl: '' }), watchdog);
      row.resolveMs = Math.round(performance.now() - start);
      row.playable = !!r?.url && r.playable !== false;
      row.full = row.playable && !r.trial;
      row.fallback = !!r?.fallback;
      row.servedBy = r?.url ? r.platform : null;
      row.servedId = r?.url ? r.sourceId : null;
      row.errorCode = r?.code || (row.playable ? null : 'NO_SOURCE');
    } catch { row.resolveMs = Math.round(performance.now() - start); row.playable = false; row.errorCode = 'WATCHDOG'; }
    try {
      const l = await bounded(lyricService.fetchLyric(t), watchdog);
      row.lyricLines = l?.lines?.length || 0;
      row.word = !!(l?.yrc || l?.qrc);
      row.translatedLines = l?.lines?.filter(x => x.translation?.trim()).length || 0;
      row.translation = row.lyricLines > 0 && row.translatedLines / row.lyricLines >= 0.5;
    } catch { row.lyricLines = 0; row.word = false; row.translatedLines = 0; row.translation = false; row.lyricTimeout = true; }
    rows.push(row);
    fs.writeFileSync(out, JSON.stringify({ startedAt, incomplete: rows.length !== samples.length, rows }, null, 2));
    print(`实测 ${rows.length}/${samples.length} ${t.platform} ${row.resolveMs}ms ${row.playable ? (row.fallback ? '兜底' : '直取') : row.errorCode}`);
  }
}
await Promise.all(Array.from({ length: Number(args.concurrency || 3) }, run));
const percentile = (values, q) => values.length ? [...values].sort((a,b) => a-b)[Math.ceil(values.length * q) - 1] : null;
const metrics = list => {
  const ok = list.filter(x => x.playable), direct = ok.filter(x => !x.fallback), fallback = ok.filter(x => x.fallback), foreign = list.filter(x => x.language !== 'zh');
  return { n: list.length, direct: direct.length, fallback: fallback.length, playable: ok.length, full: list.filter(x => x.full).length, watchdog: list.filter(x => x.errorCode === 'WATCHDOG').length,
    directP50: percentile(direct.map(x => x.resolveMs), .5), directP95: percentile(direct.map(x => x.resolveMs), .95), fallbackP95: percentile(fallback.map(x => x.resolveMs), .95), word: list.filter(x => x.word).length, foreignN: foreign.length, translation: foreign.filter(x => x.translation).length };
};
const summary = { total: metrics(rows), byPlatform: {}, byLanguage: {} };
for (const key of new Set(rows.map(x => x.platform))) summary.byPlatform[key] = metrics(rows.filter(x => x.platform === key));
for (const key of new Set(rows.map(x => x.language))) summary.byLanguage[key] = metrics(rows.filter(x => x.language === key));
fs.writeFileSync(out, JSON.stringify({ startedAt, finishedAt: new Date().toISOString(), backend: path.basename(backendPath), conditions: { concurrency: Number(args.concurrency || 3), watchdogMs: watchdog, authenticated: ['netease','qq','kugou'].filter(x => cookies.has(x)), measurement: '到通过音频探测的可播地址；不是实际出声', censored: 'WATCHDOG 为测试工具截断，不计入成功耗时分位数' }, summary, rows: rows.sort((a,b) => a.index-b.index) }, null, 2));
print(JSON.stringify(summary));
// 原版超时仅放弃等待，底层请求可能继续；结束隔离测试进程回收这些连接。
process.exit(0);
