// 段落切分形态统计。
const fs = require('fs');
const path = require('path');
const sh = Object.values(JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'shapes.json'), 'utf8')));
const q = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const pct = (a, b) => ((100 * a) / b).toFixed(1) + '%';
const kinds = ['verse', 'pre', 'chorus', 'bridge', 'outro'];
console.log('歌曲', sh.length);
console.log('句数 p10/50/90', q(sh.map((s) => s.n), 0.1), q(sh.map((s) => s.n), 0.5), q(sh.map((s) => s.n), 0.9));
console.log('页数 p10/50/90', q(sh.map((s) => s.stanzas.length), 0.1), q(sh.map((s) => s.stanzas.length), 0.5), q(sh.map((s) => s.stanzas.length), 0.9));
// 每页句数分布
const per = {};
for (const s of sh) for (const z of s.stanzas) { const n = z.to - z.from + 1; per[n] = (per[n] || 0) + 1; }
const totalPages = Object.values(per).reduce((a, b) => a + b, 0);
console.log('每页句数', Object.entries(per).map(([k, v]) => `${k}句:${pct(v, totalPages)}`).join(' '));
// 每页时长
const dur = sh.flatMap((s) => s.stanzas.map((z) => z.e - z.s));
console.log('每页时长秒 p10/50/90', q(dur, 0.1).toFixed(1), q(dur, 0.5).toFixed(1), q(dur, 0.9).toFixed(1));
// 段落种类：每首歌有几段、页按种类分布
const pk = {};
for (const s of sh) for (const z of s.stanzas) pk[z.kind] = (pk[z.kind] || 0) + 1;
console.log('页按段落', kinds.map((k) => `${k}:${pct(pk[k] || 0, totalPages)}`).join(' '));
const has = {};
for (const k of kinds) has[k] = sh.filter((s) => s.sections.some((x) => x.kind === k)).length;
console.log('含该段落的歌', kinds.map((k) => `${k}:${pct(has[k], sh.length)}`).join(' '));
const occ = {};
for (const k of kinds) occ[k] = q(sh.map((s) => s.sections.filter((x) => x.kind === k).length), 0.5);
console.log('每首该段落出现次数中位', JSON.stringify(occ));
// 各段落每段几页
for (const k of kinds) {
  const xs = [];
  for (const s of sh) s.sections.forEach((sec, i) => { if (sec.kind === k) xs.push(s.stanzas.filter((z) => z.section === i).length); });
  if (xs.length) console.log(`  ${k} 每段页数 p50/p90/max`, q(xs, 0.5), q(xs, 0.9), Math.max(...xs), ' 段数', xs.length);
}
console.log('不自信（无副歌）', sh.filter((s) => !s.confident).length);
// 按语言
for (const sc of ['zh', 'en', 'ja', 'ko']) {
  const g = sh.filter((s) => s.script === sc);
  console.log(sc, g.length, '页中位', q(g.map((s) => s.stanzas.length), 0.5), '无副歌', g.filter((s) => !s.confident).length, '有桥', pct(g.filter((s) => s.sections.some((x) => x.kind === 'bridge')).length, g.length), '有预副歌', pct(g.filter((s) => s.sections.some((x) => x.kind === 'pre')).length, g.length), '有尾声', pct(g.filter((s) => s.sections.some((x) => x.kind === 'outro')).length, g.length));
}
// 副歌占全曲句子比例
const chorusShare = sh.filter((s) => s.confident).map((s) => s.sections.filter((x) => x.kind === 'chorus').reduce((m, x) => m + x.to - x.from + 1, 0) / s.n);
console.log('副歌句占比 p10/50/90', q(chorusShare, 0.1).toFixed(2), q(chorusShare, 0.5).toFixed(2), q(chorusShare, 0.9).toFixed(2));
// 主歌段内页数
const firstVerse = sh.map((s) => { const i = s.sections.findIndex((x) => x.kind === 'verse'); return i < 0 ? 0 : s.stanzas.filter((z) => z.section === i).length; });
console.log('第一段主歌页数分布', JSON.stringify(firstVerse.reduce((m, v) => ((m[v] = (m[v] || 0) + 1), m), {})));
// 连续同类页的最长串（太平的信号）
const runs = sh.map((s) => { let best = 1, cur = 1; for (let i = 1; i < s.stanzas.length; i++) { if (s.stanzas[i].kind === s.stanzas[i - 1].kind) cur++; else cur = 1; best = Math.max(best, cur); } return best; });
console.log('最长同段落连续页 p50/p90/max', q(runs, 0.5), q(runs, 0.9), Math.max(...runs));
// 钩子词
console.log('有钩子词', pct(sh.filter((s) => s.hook).length, sh.length));
