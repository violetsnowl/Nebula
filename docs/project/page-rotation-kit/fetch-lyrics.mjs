// 给会话曲目里没有缓存歌词的那些补歌词。用全新空配置目录（匿名，不碰用户任何登录），只取歌词，不取播放地址。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const here = path.dirname(new URL(import.meta.url).pathname).replace(/^\/(\w:)/, '$1');
const require = createRequire(import.meta.url);
const { CookieStore, setCookieDataDir, HttpClient, createAdapters, LyricService } = require('E:/CUFE/vibecoding/nebula/dist-main/index.cjs');
const quiet = () => {};
for (const k of ['log', 'info', 'warn', 'error', 'debug']) console[k] = quiet;
const out = (...a) => process.stdout.write(a.join(' ') + '\n');

const D = path.join(here, 'data');
const all = [];
// 会话曲目全集（重新提取，包括没有缓存歌词的）
{
  const S = '((?:[^"\\\\]|\\\\.)*)';
  const re = new RegExp('\\{"id":"([a-z]+):([^"]+)","title":"' + S + '","artist":"' + S + '","album":"' + S + '","cover":"' + S + '","duration":([\\d.]+)', 'g');
  const un = (x) => { try { return JSON.parse('"' + x + '"'); } catch { return x; } };
  const seen = new Set();
  const dir = path.join(D, 'ls', 'leveldb');
  for (const f of fs.readdirSync(dir).filter((f) => /\.(log|ldb)$/.test(f))) {
    const b = fs.readFileSync(path.join(dir, f));
    for (const off of [0, 1]) {
      const s = b.subarray(off).toString('utf16le');
      let m;
      while ((m = re.exec(s))) {
        const k = m[1] + ':' + m[2];
        if (seen.has(k)) continue;
        seen.add(k);
        all.push({ key: k, id: k, platform: m[1], sourceId: m[2], title: un(m[3]), artist: un(m[4]), album: un(m[5]), cover: un(m[6]), duration: +m[7] });
      }
    }
  }
}
const cache = JSON.parse(fs.readFileSync(path.join(D, 'lyric-cache.json'), 'utf8')).entries;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nebula-lyr-'));
setCookieDataDir(tmp);
const cookies = new CookieStore();
const http = new HttpClient(cookies);
const adapters = createAdapters(http, cookies);
const svc = new LyricService(adapters);

const result = {};
const todo = all.filter((t) => !cache[t.key]);
out('all', all.length, 'todo', todo.length);
let i = 0, ok = 0;
const worker = async () => {
  while (i < todo.length) {
    const t = todo[i++];
    try {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), 20000);
      const l = await svc.fetchLyric(t, ac.signal).catch(() => null);
      clearTimeout(timer);
      if (l && l.lines && l.lines.length) { result[t.key] = l; ok++; }
    } catch {}
    if (i % 25 === 0) out('progress', i, ok);
  }
};
await Promise.all([worker(), worker(), worker()]);
fs.writeFileSync(path.join(D, 'all-tracks.json'), JSON.stringify(all));
fs.writeFileSync(path.join(D, 'lyrics-fetched.json'), JSON.stringify(result));
out('done ok', ok, '/', todo.length);
process.exit(0);
