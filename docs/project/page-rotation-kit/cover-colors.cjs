// 给每张真实封面算色系：平均明度、彩度、按彩度加权的主色相。只读公开封面图。
const fs = require('fs');
const path = require('path');
const { qaRequire, chrome } = require('E:/CUFE/vibecoding/nebula/scripts/qa-env.cjs');
const { chromium } = qaRequire('playwright-core');
const D = path.join(__dirname, 'data');
const tracks = JSON.parse(fs.readFileSync(path.join(D, 'all-tracks.json'), 'utf8')).filter((t) => t.cover);
(async () => {
  const browser = await chromium.launch({ executablePath: chrome, headless: true, args: ['--disable-web-security'] });
  const page = await browser.newPage();
  await page.goto('about:blank');
  const out = {};
  for (let i = 0; i < tracks.length; i += 12) {
    const batch = tracks.slice(i, i + 12);
    const res = await page.evaluate(async (list) => {
      const one = (t) => new Promise((resolve) => {
        const im = new Image();
        im.crossOrigin = 'anonymous';
        const timer = setTimeout(() => resolve(null), 12000);
        im.onload = () => {
          clearTimeout(timer);
          try {
            const c = document.createElement('canvas');
            c.width = c.height = 48;
            const x = c.getContext('2d');
            x.drawImage(im, 0, 0, 48, 48);
            const d = x.getImageData(0, 0, 48, 48).data;
            let L = 0, S = 0, hx = 0, hy = 0, w = 0, n = 0;
            const bins = new Array(12).fill(0);
            for (let k = 0; k < d.length; k += 4) {
              const r = d[k] / 255, g = d[k + 1] / 255, b = d[k + 2] / 255;
              const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
              const l = (mx + mn) / 2, ch = mx - mn;
              let h = 0;
              if (ch > 0) {
                if (mx === r) h = ((g - b) / ch) % 6; else if (mx === g) h = (b - r) / ch + 2; else h = (r - g) / ch + 4;
                h *= 60; if (h < 0) h += 360;
              }
              L += l; S += ch; n++;
              hx += Math.cos((h * Math.PI) / 180) * ch; hy += Math.sin((h * Math.PI) / 180) * ch; w += ch;
              if (ch > 0.12) bins[Math.floor(h / 30) % 12] += ch;
            }
            const hue = w > 0 ? ((Math.atan2(hy, hx) * 180) / Math.PI + 360) % 360 : 0;
            resolve({ L: +(L / n).toFixed(3), C: +(S / n).toFixed(3), hue: Math.round(hue), bins: bins.map((v) => +v.toFixed(1)) });
          } catch (e) { resolve({ err: String(e) }); }
        };
        im.onerror = () => { clearTimeout(timer); resolve(null); };
        im.src = t.cover;
      });
      return Promise.all(list.map(one));
    }, batch);
    batch.forEach((t, j) => { if (res[j] && !res[j].err) out[t.key] = res[j]; });
  }
  fs.writeFileSync(path.join(D, 'colors.json'), JSON.stringify(out));
  // 色系：黑白灰 / 暗彩 / 亮淡 / 高饱和 + 色相名
  const fam = (c) => {
    if (c.C < 0.08) return c.L < 0.3 ? 'mono-dark' : c.L > 0.65 ? 'mono-light' : 'mono-mid';
    const hn = ['red', 'orange', 'yellow', 'yellow', 'green', 'green', 'cyan', 'blue', 'blue', 'purple', 'magenta', 'red'][Math.floor(c.hue / 30) % 12];
    const tone = c.C > 0.3 ? 'vivid' : c.L < 0.3 ? 'dark' : c.L > 0.62 ? 'pale' : 'mid';
    return `${tone}-${hn}`;
  };
  const cnt = {};
  for (const [k, c] of Object.entries(out)) { c.fam = fam(c); cnt[c.fam] = (cnt[c.fam] || 0) + 1; }
  fs.writeFileSync(path.join(D, 'colors.json'), JSON.stringify(out));
  console.log('colored', Object.keys(out).length, '/', tracks.length);
  console.log(Object.entries(cnt).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join('  '));
  await browser.close();
})();
