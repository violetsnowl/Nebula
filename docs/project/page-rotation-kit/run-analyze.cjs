// 对全部真实歌词跑段落切分，输出 data/shapes.json。
const fs = require('fs');
const path = require('path');
const { analyze } = require('./analyze.cjs');
const D = path.join(__dirname, 'data');
const cache = JSON.parse(fs.readFileSync(path.join(D, 'lyric-cache.json'), 'utf8')).entries;
const fetched = fs.existsSync(path.join(D, 'lyrics-fetched.json')) ? JSON.parse(fs.readFileSync(path.join(D, 'lyrics-fetched.json'), 'utf8')) : {};
const meta = new Map();
const allT = fs.existsSync(path.join(D, 'all-tracks.json')) ? JSON.parse(fs.readFileSync(path.join(D, 'all-tracks.json'), 'utf8')) : JSON.parse(fs.readFileSync(path.join(D, 'tracks.json'), 'utf8'));
for (const t of allT) meta.set(t.key, t);
const lyr = {};
for (const [k, v] of Object.entries(cache)) if (v.lyric) lyr[k] = v.lyric;
for (const [k, v] of Object.entries(fetched)) lyr[k] = v;
const out = {};
for (const [k, data] of Object.entries(lyr)) {
  const m = meta.get(k);
  try {
    const r = analyze(data, m?.title, m?.artist, m?.duration);
    if (r.n < 4) continue;
    out[k] = { key: k, title: m?.title ?? null, artist: m?.artist ?? null, cover: m?.cover ?? null, ...r };
  } catch (e) {
    console.error('fail', k, e.message);
  }
}
fs.writeFileSync(path.join(D, 'shapes.json'), JSON.stringify(out));
fs.writeFileSync(path.join(D, 'lyrics-all.json'), JSON.stringify(lyr));
const vals = Object.values(out);
const by = (f) => vals.reduce((m, v) => ((m[f(v)] = (m[f(v)] || 0) + 1), m), {});
console.log('songs', vals.length, 'with meta', vals.filter((v) => v.title).length);
console.log('script', by((v) => v.script));
console.log('confident', by((v) => v.confident));
