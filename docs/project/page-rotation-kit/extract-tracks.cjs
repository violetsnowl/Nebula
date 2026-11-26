// 从 Local Storage 副本里逐条提取曲目（标题 / 歌手 / 封面），与歌词缓存副本配对。只读副本。
const fs = require('fs');
const path = require('path');
const D = path.join(__dirname, 'data');
const E = require(path.join(D, 'lyric-cache.json')).entries;
const found = new Map();
const S = '((?:[^"\\\\]|\\\\.)*)';
const re = new RegExp('\\{"id":"([a-z]+):([^"]+)","title":"' + S + '","artist":"' + S + '","album":"' + S + '","cover":"' + S + '","duration":([\\d.]+)', 'g');
const un = (x) => { try { return JSON.parse('"' + x + '"'); } catch { return x; } };
const dir = path.join(D, 'ls', 'leveldb');
for (const f of fs.readdirSync(dir).filter((f) => /\.(log|ldb)$/.test(f))) {
  const b = fs.readFileSync(path.join(dir, f));
  for (const off of [0, 1]) {
    const s = b.subarray(off).toString('utf16le');
    let m;
    while ((m = re.exec(s))) {
      const k = m[1] + ':' + m[2];
      if (!found.has(k)) found.set(k, { key: k, platform: m[1], sourceId: m[2], title: un(m[3]), artist: un(m[4]), album: un(m[5]), cover: un(m[6]), duration: +m[7] });
    }
  }
}
const arr = [...found.values()];
const hit = arr.filter((t) => E[t.key]);
console.log('tracks', arr.length, 'with cached lyric', hit.length, 'cover', hit.filter((t) => t.cover).length);
fs.writeFileSync(path.join(D, 'tracks.json'), JSON.stringify(hit));
console.log(hit.slice(0, 5).map((t) => t.title + ' / ' + t.artist).join('\n'));
