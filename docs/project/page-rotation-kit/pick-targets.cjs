// 定向挑截图：每套大胆版式 × 不同封面色系 × 横 / 竖排。
const fs = require('fs');
const path = require('path');
const D = path.join(__dirname, 'data');
const sh = JSON.parse(fs.readFileSync(path.join(D, 'shapes.json'), 'utf8'));
const as = JSON.parse(fs.readFileSync(path.join(D, 'assign.json'), 'utf8'));
const col = JSON.parse(fs.readFileSync(path.join(D, 'colors.json'), 'utf8'));
const BOLD = ['held', 'spine', 'justify', 'foot', 'bleed', 'diag', 'field', 'groove', 'grid', 'corner', 'fault', 'drum', 'register', 'cut'];
const bucket = (c) => (c.fam.startsWith('mono-dark') ? 'black' : c.fam.startsWith('mono') ? 'grey/white' : c.fam.startsWith('vivid') ? 'vivid' : c.fam.startsWith('pale') ? 'pale' : 'muted');
const per = Number(process.argv[2] || 4);
const targets = [];
const used = new Map();
for (const t of BOLD) {
  const cands = Object.keys(as).filter((k) => col[k] && as[k].ok && as[k].tpl.includes(t)).map((k) => ({ k, b: bucket(col[k]), sc: sh[k].script, fam: col[k].fam, vert: as[k].vert[as[k].tpl.indexOf(t)] }));
  const picked = [];
  const wantOrder = ['vivid', 'black', 'pale', 'grey/white', 'muted'];
  const dirs = [true, false];
  // 先保证横竖都有，再按色系铺开；同一首歌尽量不在多套里重复出现
  for (let round = 0; round < 3 && picked.length < per; round++) {
    for (const b of wantOrder) {
      if (picked.length >= per) break;
      if (picked.some((p) => p.b === b) && round === 0) continue;
      const dirNeed = dirs.find((d) => !picked.some((p) => p.vert === d));
      const pool = cands.filter((c) => c.b === b && !picked.some((p) => p.k === c.k));
      const pref = pool.filter((c) => dirNeed === undefined || c.vert === dirNeed);
      const list = (pref.length ? pref : pool).sort((x, y) => (used.get(x.k) || 0) - (used.get(y.k) || 0));
      if (list[0]) { picked.push(list[0]); used.set(list[0].k, (used.get(list[0].k) || 0) + 1); }
    }
  }
  for (const p of picked) targets.push({ key: p.k, tpl: t, tag: `${t}-${p.b.replace('/', '')}-${p.vert ? 'v' : 'h'}-${p.sc}`, fam: p.fam, title: sh[p.k].title });
  console.log(t.padEnd(9), cands.length, picked.map((p) => `${p.b}/${p.vert ? 'v' : 'h'}/${p.sc} ${sh[p.k].title}`).join(' | '));
}
fs.writeFileSync(path.join(__dirname, 'targets.json'), JSON.stringify(targets, null, 1));
console.log('total', targets.length);

// 横排补充：英文 / 日文歌词 + 借用同色系的真实封面
const covers = Object.entries(col).map(([k, c]) => ({ k, c, cover: JSON.parse(fs.readFileSync(path.join(D, 'all-tracks.json'), 'utf8')).find((t) => t.key === k).cover }));
const pickCover = (b, hueAvoid) => covers.filter((x) => bucket(x.c) === b && (hueAvoid == null || Math.abs(((x.c.hue - hueAvoid + 540) % 360) - 180) > 60)).sort((a, z) => z.c.C - a.c.C)[0];
const extra = [];
let rot = 0;
for (const t of BOLD) {
  const langs = t === 'grid' ? ['ja'] : ['en', 'ja'];
  const cands = Object.keys(as).filter((k) => as[k].ok && langs.includes(sh[k].script) && as[k].tpl.includes(t) && !as[k].vert[as[k].tpl.indexOf(t)]);
  if (!cands.length) { console.log('no horizontal', t); continue; }
  const plans = [['vivid', null], ['pale', null], ['black', null]];
  const want = t === 'foot' ? 3 : 2;
  for (let i = 0; i < want && i < cands.length; i++) {
    const k = cands[(rot + i * 7) % cands.length];
    const [b] = plans[(rot + i) % plans.length];
    const cv = pickCover(b, i ? 20 + rot * 40 : rot * 70);
    if (!cv) continue;
    extra.push({ key: k, tpl: t, tag: `${t}-${b}-h-${sh[k].script}-cv`, cover: cv.cover, fam: cv.c.fam, coverOf: cv.k });
  }
  rot++;
}
fs.writeFileSync(path.join(__dirname, 'targets-h.json'), JSON.stringify(extra, null, 1));
console.log('extra', extra.length, extra.map((e) => e.tag + ' ' + e.fam).join('\n'));
