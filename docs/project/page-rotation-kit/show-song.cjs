// 打印一首歌的段落 / 页 / 版式，人工核对切分。用法：node show-song.cjs 标题关键字 [...]
const fs = require('fs');
const path = require('path');
const D = path.join(__dirname, 'data');
const sh = JSON.parse(fs.readFileSync(path.join(D, 'shapes.json'), 'utf8'));
const as = JSON.parse(fs.readFileSync(path.join(D, 'assign.json'), 'utf8'));
const K = { verse: '主', pre: '预', chorus: '副', bridge: '桥', outro: '尾' };
for (const q of process.argv.slice(2)) {
  const s = Object.values(sh).find((x) => (x.title || '').includes(q) || x.key === q);
  if (!s) { console.log('none', q); continue; }
  const a = as[s.key];
  console.log(`\n=== ${s.title} / ${s.artist} [${s.script}] ${s.n}句 ${s.stanzas.length}页 confident=${s.confident} hook=${s.hook}`);
  s.stanzas.forEach((z, j) => {
    const gapBefore = j > 0 ? (z.s - s.stanzas[j - 1].e).toFixed(1) : '-';
    const sec = s.sections[z.section];
    console.log(`p${String(j + 1).padStart(2)} ${K[z.kind]}${sec.occ + 1}/${sec.of} ${(a?.tpl[j] || '?').padEnd(9)} ${z.s.toFixed(0).padStart(4)}s 隔${gapBefore.padStart(5)}  ${s.lines.slice(z.from, z.to + 1).map((l) => l.t).join(' / ').slice(0, 110)}`);
  });
}
