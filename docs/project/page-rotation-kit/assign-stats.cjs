// 版式分配统计：每套出现在多少首歌、占多少页、按语言 / 段落。
const fs = require('fs');
const path = require('path');
const D = path.join(__dirname, 'data');
const sh = JSON.parse(fs.readFileSync(path.join(D, 'shapes.json'), 'utf8'));
const as = JSON.parse(fs.readFileSync(path.join(D, 'assign.json'), 'utf8'));
const BOLD = ['held', 'spine', 'justify', 'foot', 'bleed', 'diag', 'field', 'groove', 'grid', 'corner', 'fault', 'drum', 'register', 'cut'];
const NAME = { held: '一词放大', spine: '书脊', justify: '满版齐行', foot: '脚注', bleed: '出血大字', diag: '斜线', field: '色场', groove: '唱片纹', grid: '稿纸', corner: '转角', fault: '断层', drum: '回声滚筒', register: '错版套印', cut: '负形镂空' };
const keys = Object.keys(as).filter((k) => as[k].ok && sh[k] && as[k].tpl.length === sh[k].stanzas.length);
const pct = (a, b) => (b ? ((100 * a) / b).toFixed(1) : '0') + '%';
let pages = 0, boldPages = 0;
const song = {}, pg = {}, byLang = {}, byKind = {}, langN = {};
const perSongBold = [];
const tplKind = {};
for (const k of keys) {
  const s = sh[k], a = as[k];
  langN[s.script] = (langN[s.script] || 0) + 1;
  const seen = new Set();
  a.tpl.forEach((t, j) => {
    pages++;
    const kind = s.stanzas[j].kind;
    byKind[kind] = byKind[kind] || {};
    byKind[kind][BOLD.includes(t) ? t : 'classic'] = (byKind[kind][BOLD.includes(t) ? t : 'classic'] || 0) + 1;
    pg[t] = (pg[t] || 0) + 1;
    if (BOLD.includes(t)) { boldPages++; seen.add(t); tplKind[t] = tplKind[t] || {}; tplKind[t][kind] = (tplKind[t][kind] || 0) + 1; }
  });
  perSongBold.push(seen.size);
  for (const t of seen) {
    song[t] = (song[t] || 0) + 1;
    byLang[t] = byLang[t] || {};
    byLang[t][s.script] = (byLang[t][s.script] || 0) + 1;
  }
}
console.log('歌', keys.length, '页', pages, '大胆版式页', pct(boldPages, pages), '每首大胆版式数 均值', (perSongBold.reduce((a, b) => a + b, 0) / keys.length).toFixed(2));
const hist = perSongBold.reduce((m, v) => ((m[v] = (m[v] || 0) + 1), m), {});
console.log('每首用到几套大胆版式', JSON.stringify(hist));
console.log('\n版式        出现歌数(占比)   页数   zh / en / ja / ko 内占比        出现在的段落');
for (const t of [...BOLD].sort((a, b) => (song[b] || 0) - (song[a] || 0))) {
  const L = byLang[t] || {};
  const lang = ['zh', 'en', 'ja', 'ko'].map((x) => pct(L[x] || 0, langN[x] || 0)).join(' / ');
  const kinds = Object.entries(tplKind[t] || {}).map(([k, v]) => `${k}${v}`).join(' ');
  console.log(`${NAME[t].padEnd(5, '　')} ${String(song[t] || 0).padStart(4)} (${pct(song[t] || 0, keys.length).padStart(6)})  ${String(pg[t] || 0).padStart(4)}   ${lang}   ${kinds}`);
}
console.log('\n各段落的页用了什么（占该段落页数）');
for (const [kind, m] of Object.entries(byKind)) {
  const tot = Object.values(m).reduce((a, b) => a + b, 0);
  console.log(kind, tot, Object.entries(m).sort((a, b) => b[1] - a[1]).map(([t, v]) => `${NAME[t] || t}:${pct(v, tot)}`).join(' '));
}
// 经典版式细分
const cl = {};
for (const k of keys) for (const t of as[k].tpl) if (!BOLD.includes(t)) cl[t] = (cl[t] || 0) + 1;
console.log('\n经典版式', Object.entries(cl).sort((a, b) => b[1] - a[1]).map(([t, v]) => `${t}:${v}`).join(' '));
// 最长连续经典页
const runs = keys.map((k) => { let b = 0, c = 0; for (const t of as[k].tpl) { if (BOLD.includes(t)) c = 0; else c++; b = Math.max(b, c); } return b; });
runs.sort((a, b) => a - b);
console.log('最长连续经典页 p50/p90/max', runs[runs.length >> 1], runs[Math.floor(runs.length * 0.9)], runs[runs.length - 1]);
// 一首歌里大胆版式集中在前半还是后半
let early = 0, late = 0;
for (const k of keys) as[k].tpl.forEach((t, j, arr) => { if (BOLD.includes(t)) (j < arr.length / 2 ? early++ : late++); });
console.log('大胆版式在前半 / 后半', early, late);
fs.writeFileSync(path.join(D, 'assign-keys.json'), JSON.stringify(keys));
