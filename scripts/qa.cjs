/* eslint-disable */
// Phase 1.5 自动化 QA（无头 Chrome + 本机 Chrome）
// 验证：曲库总量 / 视口密度 / 重叠 / 透镜景深 / 悬浮转正 / 缩放下限 / 首尾相接 / 虚拟化 / 背景系统 / 拖动不闪烁

const fs = require('fs');
const os = require('os');
const path = require('path');
const { qaRequire, chrome } = require('./qa-env.cjs');
const { PNG } = qaRequire('pngjs');
const { chromium } = qaRequire('playwright-core');

const CHROME = chrome;
const OUT_DIR = path.join(__dirname, '..', '..', 'nebula-outputs');
const HTML_PATH = path.join(OUT_DIR, 'index.html');

function log(label, value) {
  console.log(`[QA] ${label}: ${value}`);
}

/** 主舞台同时挂成 DOM 卡片的上限（与 src/hooks/stage/useStage.ts 的 MAX_MOUNT 一致）。 */
const MAX_MOUNT = 140;
/** 缩放下限（最远约 0.28 倍，封面还认得出；1000 首、1600×900 下约在这附近）。 */
const ZOOM_FLOOR = 0.279;

function parseMatrixScale(transform) {
  const m = transform.match(/^matrix(?:3d)?\((.*)\)$/);
  if (!m) return 0;
  const n = m[1].split(',').map(Number);
  return Math.hypot(n[0], n[1]);
}

function parseBlur(filter) {
  const m = filter.match(/blur\(([\d.]+)px\)/);
  return m ? Number(m[1]) : 0;
}

function parseRotationDeg(transform) {
  const m = transform.match(/^matrix(?:3d)?\((.*)\)$/);
  if (!m) return null;
  const n = m[1].split(',').map(Number);
  return (Math.atan2(n[1], n[0]) * 180) / Math.PI;
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  // 构造一张测试用上传背景图
  const testPng = path.join(os.tmpdir(), 'qa-bg-test.png');
  {
    const p = new PNG({ width: 320, height: 180 });
    for (let y = 0; y < 180; y++) {
      for (let x = 0; x < 320; x++) {
        const i = (y * 320 + x) * 4;
        p.data[i] = 30 + (x * 200) / 320;
        p.data[i + 1] = 80 + (y * 120) / 180;
        p.data[i + 2] = 220;
        p.data[i + 3] = 255;
      }
    }
    fs.writeFileSync(testPng, PNG.sync.write(p));
  }

  // 本地静音音频（20 秒，8kHz 8 位单声道 WAV 的 data URL）：空域歌词逐字层那一项用它播放，
  // 不再依赖外网 soundhelix.com（网慢时 10 秒内播不到第一句歌词，偶发失败，#139）
  const lyricAudio = (() => {
    const rate = 8000;
    const n = rate * 20;
    const b = Buffer.alloc(44 + n, 128);
    b.write('RIFF', 0);
    b.writeUInt32LE(36 + n, 4);
    b.write('WAVEfmt ', 8);
    b.writeUInt32LE(16, 16);
    b.writeUInt16LE(1, 20);
    b.writeUInt16LE(1, 22);
    b.writeUInt32LE(rate, 24);
    b.writeUInt32LE(rate, 28);
    b.writeUInt16LE(1, 32);
    b.writeUInt16LE(8, 34);
    b.write('data', 36);
    b.writeUInt32LE(n, 40);
    return `data:audio/wav;base64,${b.toString('base64')}`;
  })();

  const browser = await chromium.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--force-color-profile=srgb', '--hide-scrollbars'],
  });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  const errors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error' && !/Failed to load resource|ERR_|net::|Audio|media/i.test(msg.text())) {
      errors.push(`console: ${msg.text()}`);
    }
  });
  page.on('pageerror', (err) => errors.push(`pageerror: ${String(err)}`));

  // 舞台测试依赖演示星云（1000 首）：首次启动默认是空状态，这里用 ?demo=1 显式打开演示曲库
  const APP_URL = `file:///${HTML_PATH.replace(/\\/g, '/')}`;
  await page.goto(`${APP_URL}?demo=1`, { waitUntil: 'load' });
  await page.waitForTimeout(1500);

  // ---------- 0) 首次启动空状态（不带 demo 开关、全新存储）----------
  let emptyOk = false;
  // 新开一个独立上下文（localStorage 全空），断言：标题可见、没有卡片、没有显示播放条 / 回到中心
  {
    const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
    const first = await ctx.newPage();
    first.on('pageerror', (err) => errors.push(`pageerror(first-run): ${String(err)}`));
    await first.goto(APP_URL, { waitUntil: 'load' });
    await first.waitForTimeout(1500);
    const emptyState = await first.evaluate(() => {
      const vis = (el) => !!el && getComputedStyle(el).visibility !== 'hidden' && el.getBoundingClientRect().width > 0;
      const h = document.querySelector('.empty-nebula .en-hero h2');
      return {
        title: h ? h.textContent : '',
        titleVisible: vis(h),
        cards: document.querySelectorAll('.music-card').length,
        ghosts: document.querySelectorAll('.en-ghosts span').length,
        buttons: Array.from(document.querySelectorAll('.en-acts .en-btn')).map((b) => b.textContent),
        barVisible: vis(document.querySelector('.player-surface')),
        centerVisible: vis(document.querySelector('.center-btn')),
      };
    });
    log('首次启动：标题', emptyState.title);
    log('首次启动：空卡轮廓数(35–45)', emptyState.ghosts);
    log('首次启动：无 .music-card', emptyState.cards === 0);
    log('首次启动：播放条 / 回到中心均不显示', !emptyState.barVisible && !emptyState.centerVisible);
    emptyOk =
      emptyState.title === '把你的歌，放进星云' &&
      emptyState.titleVisible &&
      emptyState.cards === 0 &&
      emptyState.ghosts >= 35 &&
      emptyState.ghosts <= 45 &&
      emptyState.buttons.join('|') === '登录音乐平台|粘贴歌单链接|本地文件夹…' &&
      !emptyState.barVisible &&
      !emptyState.centerVisible;
    await ctx.close();
  }

  // ---------- 1) 密度与虚拟化 ----------
  const stats = await page.evaluate(() => {
    const vw = innerWidth;
    const vh = innerHeight;
    const cards = Array.from(document.querySelectorAll('.music-card')).map((el) => {
      const r = el.getBoundingClientRect();
      return {
        x: r.left,
        y: r.top,
        w: r.width,
        h: r.height,
        cx: r.left + r.width / 2,
        cy: r.top + r.height / 2,
        intersect: r.left < vw && r.top < vh && r.right > 0 && r.bottom > 0,
        transform: getComputedStyle(el).transform,
        filter: getComputedStyle(el).filter,
        z: Number(getComputedStyle(el).zIndex) || 0,
      };
    });
    const visible = cards.filter((c) => c.intersect);
    const stage = document.querySelector('.stage-3d');
    return {
      total: window.__nebula?.total ?? -1,
      mounted: cards.length,
      onScreen: visible.length,
      pan: window.__nebula?.pan(),
      cards: visible,
      // 新星云的结构：有界舞台、星层画布；所有挂载卡片（不只是屏幕内的）都不带模糊滤镜
      bounded: !!(stage && stage.classList.contains('is-bounded')),
      canvas: !!document.querySelector('canvas.space-stars'),
      blurred: cards.filter((c) => /blur\(/.test(c.filter)).length,
    };
  });
  log('曲库总量', stats.total);
  log(`已挂载 DOM 卡片数(≤${MAX_MOUNT})`, stats.mounted);
  log('视口内卡片数(15–140)', stats.onScreen);
  log('初始 pan', JSON.stringify(stats.pan));
  log('有界舞台 / 星层画布', `${stats.bounded} / ${stats.canvas}`);

  // ---------- 2) 零重叠 ----------
  let overlaps = 0;
  for (let i = 0; i < stats.cards.length; i++) {
    for (let j = i + 1; j < stats.cards.length; j++) {
      const a = stats.cards[i];
      const b = stats.cards[j];
      const ix = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
      const iy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      if (ix > 1 && iy > 1) overlaps++;
    }
  }
  log('重叠卡片对数(允许自然重叠，仅记录)', overlaps);

  // ---------- 3) 透镜景深 ----------
  // 新星云过 Sarkar–Brown 透镜：中心的卡片放大、层叠更高，外圈压缩变小；任何卡片都不加模糊
  const vw = 1600;
  const vh = 900;
  let nearest = null;
  let farthest = null;
  for (const c of stats.cards) {
    const d = Math.hypot(c.cx - vw / 2, c.cy - vh / 2);
    c.dist = d;
    c.scale = parseMatrixScale(c.transform);
    c.blur = parseBlur(c.filter);
    if (!nearest || d < nearest.dist) nearest = c;
    if (!farthest || d > farthest.dist) farthest = c;
  }
  log('中心最近卡片 scale/blur/dist', `${nearest.scale.toFixed(3)} / ${nearest.blur.toFixed(2)}px / ${Math.round(nearest.dist)}`);
  log('边缘最远卡片 scale/blur/dist', `${farthest.scale.toFixed(3)} / ${farthest.blur.toFixed(2)}px / ${Math.round(farthest.dist)}`);
  log('中心卡 z-index / 边缘卡 z-index', `${nearest.z} / ${farthest.z}`);
  log('带模糊滤镜的卡片数(应为 0)', stats.blurred);

  // ---------- 4) 帧耗时 ----------
  const idleFrameMs = await page.evaluate(
    () =>
      new Promise((resolve) => {
        let n = 0;
        const t0 = performance.now();
        const loop = () => {
          n++;
          if (n >= 30) resolve(Number(((performance.now() - t0) / n).toFixed(2)));
          else requestAnimationFrame(loop);
        };
        requestAnimationFrame(loop);
      }),
  );
  log('空闲平均帧耗时(ms)', idleFrameMs);


  const activePanMs = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const stage = document.querySelector('.stage-3d');
        stage.dispatchEvent(
          new PointerEvent('pointerdown', {
            pointerId: 1,
            clientX: 700,
            clientY: 400,
            bubbles: true,
            pointerType: 'mouse',
            button: 0,
          }),
        );
        let x = 700;
        const iv = setInterval(() => {
          x -= 8;
          window.dispatchEvent(
            new PointerEvent('pointermove', { pointerId: 1, clientX: x, clientY: 400, bubbles: true }),
          );
        }, 16);
        let n = 0;
        const t0 = performance.now();
        const tick = () => {
          n++;
          if (n >= 20) {
            clearInterval(iv);
            window.dispatchEvent(
              new PointerEvent('pointerup', { pointerId: 1, clientX: x, clientY: 400, bubbles: true }),
            );
            resolve(Number(((performance.now() - t0) / n).toFixed(2)));
          } else {
            requestAnimationFrame(tick);
          }
        };
        requestAnimationFrame(tick);
      }),
  );
  log('平移中平均帧耗时(ms)', activePanMs);

  // 停稳惯性
  await page.mouse.wheel(0, 1);
  await page.waitForTimeout(1600);

  // ---------- 5) 悬浮焦点 ----------
  const hoverTarget = await page.evaluate(() => {
    const vw = innerWidth;
    const vh = innerHeight;
    let best = null;
    let bestD = Infinity;
    for (const el of document.querySelectorAll('.music-card')) {
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const d = Math.hypot(cx - vw / 2, cy - vh / 2);
      if (d < bestD) {
        bestD = d;
        // 同时记下悬浮前的缩放，悬浮后要比它大
        const m = getComputedStyle(el).transform.match(/^matrix(?:3d)?\((.*)\)$/);
        const n = m ? m[1].split(',').map(Number) : [0, 0];
        best = { x: cx, y: cy, baseScale: Math.hypot(n[0], n[1]) };
      }
    }
    return best;
  });
  if (!hoverTarget) {
    console.error('[QA] 未找到可悬浮的卡片');
    process.exit(1);
  }
  await page.mouse.move(hoverTarget.x, hoverTarget.y);
  await page.mouse.move(hoverTarget.x + 1, hoverTarget.y + 1);
  await page.waitForTimeout(900);
  const hoverState = await page.evaluate(() => {
    const el = document.querySelector('.music-card.is-hovered');
    if (!el) return null;
    const cs = getComputedStyle(el);
    return {
      transform: cs.transform,
      filter: cs.filter,
      z: cs.zIndex,
      scale: parseMatrixScaleSafe(cs.transform),
    };
    function parseMatrixScaleSafe(t) {
      const m = t.match(/^matrix(?:3d)?\((.*)\)$/);
      if (!m) return 0;
      const n = m[1].split(',').map(Number);
      return Math.hypot(n[0], n[1]);
    }
  });
  const hoverDeg = hoverState ? parseRotationDeg(hoverState.transform) : null;
  const hoverBlur = hoverState ? parseBlur(hoverState.filter) : null;
  log('悬浮后存在', !!hoverState);
  log('悬浮后旋转角(应≈0)', hoverDeg);
  log('悬浮后 blur(应=0)', hoverBlur);
  log('悬浮后 zIndex', hoverState?.z);
  log('悬浮前 / 后 scale(后应更大)', `${hoverTarget.baseScale.toFixed(3)} / ${hoverState?.scale.toFixed(3)}`);
  await page.mouse.move(20, 20);

  // ---------- 6) 拖拽平移 ----------
  const beforeDrag = await page.evaluate(() => {
    const el = document.querySelector('.music-card');
    return {
      x: el?.style.getPropertyValue('--x'),
      pan: window.__nebula?.pan(),
    };
  });
  await page.mouse.move(80, 80);
  await page.mouse.down();
  await page.mouse.move(280, 200, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(700);
  const afterDrag = await page.evaluate(() => {
    const el = document.querySelector('.music-card');
    return {
      x: el?.style.getPropertyValue('--x'),
      pan: window.__nebula?.pan(),
      mounted: document.querySelectorAll('.music-card').length,
    };
  });
  log('拖拽前 pan / 卡片--x', `${JSON.stringify(beforeDrag.pan)} / ${beforeDrag.x}`);
  log('拖拽后 pan / 卡片--x', `${JSON.stringify(afterDrag.pan)} / ${afterDrag.x}`);
  log('拖拽后挂载数', afterDrag.mounted);

  // ---------- 7) 缩放下限 + 首尾相接 ----------
  // 滚轮一直往外缩：停在下限（最远约 0.28 倍），再滚也不会更低
  await page.mouse.move(800, 450);
  const wheelOut = async (n) => {
    for (let i = 0; i < n; i++) {
      await page.mouse.wheel(0, 1600);
      await page.waitForTimeout(50);
    }
    await page.waitForTimeout(500);
  };
  await wheelOut(6);
  const zoomFloor1 = await page.evaluate(() => window.__nebula.zoom());
  await wheelOut(10);
  const zoomFloor2 = await page.evaluate(() => window.__nebula.zoom());
  log('滚轮缩到底后 zoom(应 ≥ 下限)', zoomFloor1.toFixed(4));
  log('继续滚轮后 zoom(应不再变小)', zoomFloor2.toFixed(4));
  // 首尾相接：镜头飞到离原点很近的地方（pan 本该是负的），pan 要回绕进 [0, period)；再长距离拖几次仍在范围内
  const period = await page.evaluate(() => window.__nebula.space().period);
  await page.evaluate((T) => window.__nebula.lookAt(T * 0.02, T * 0.02, 1), period);
  await page.waitForTimeout(600);
  const wrapA = await page.evaluate(() => ({ pan: window.__nebula.pan(), mounted: document.querySelectorAll('.music-card').length }));
  for (const [x0, x1, dy] of [[100, 1500, 120], [1500, 100, -180], [100, 1500, 200], [1500, 100, -60]]) {
    await page.mouse.move(x0, 300);
    await page.mouse.down();
    await page.mouse.move(x1, 300 + dy, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(250);
  }
  await page.waitForTimeout(1200);
  const afterWheel = await page.evaluate(() => ({
    pan: window.__nebula.pan(),
    mounted: document.querySelectorAll('.music-card').length,
  }));
  const inPeriod = (p) => p.x >= 0 && p.x < period && p.y >= 0 && p.y < period;
  log('period', Math.round(period));
  log('飞到原点附近后 pan(应在 [0,period)，且 x 回绕到靠近 period)', JSON.stringify(wrapA.pan));
  log('长距离拖动后 pan(应仍在 [0,period))', JSON.stringify(afterWheel.pan));
  log('回绕后挂载数(应>0)', `${wrapA.mounted} / ${afterWheel.mounted}`);

  // ---------- 8) 回到中心 ----------
  // 还没有当前歌时「回到中心」按设计隐藏（visibility:hidden），Playwright 的可见性检查点不了；
  // 这里直接触发 DOM click，照样走 React 的 onClick，断言（重置后 pan）保持不变
  await page.evaluate(() => document.querySelector('.center-btn').click());
  await page.waitForTimeout(500);
  const afterReset = await page.evaluate(() => window.__nebula?.pan());
  log('重置后 pan', JSON.stringify(afterReset));

  // ---------- 9) 背景系统 ----------
  // 右侧 Dock 由边缘感应触发：先移到右边缘
  await page.mouse.move(1596, 420);
  await page.waitForTimeout(600);
  // 点「设置」小球滑出右侧面板（样张 F：小球 → 固定侧面板）→ 切到背景设置
  await page.locator('.sd-rail.sd-right .sd-orb[aria-label="设置"]').click();
  await page.waitForTimeout(600);
  await page.locator('.sd-panel.sd-right .seg.wide button', { hasText: '背景' }).click();
  await page.waitForTimeout(400);
  // 跟随当前播放歌曲封面（底部第三张方案卡）；无歌单时回退隐藏的午夜星空
  await page.locator('.sd-panel.sd-right [data-bg="env"]').click();
  await page.waitForTimeout(400);
  log('封面背景(无封面→环境光中性兜底)', await page.evaluate(() => !!document.querySelector('.bg-layer.bg-env, .bg-layer.bg-midnight')));

  await page.waitForTimeout(200);
  await page.setInputFiles('input[type="file"]', testPng);
  await page.waitForFunction(() => {
    const img = document.querySelector('.bg-media');
    return img && img.complete && img.naturalWidth > 0;
  });
  log('自定义图片上传生效', await page.evaluate(() => {
    const img = document.querySelector('.bg-media');
    return img ? `${img.naturalWidth}x${img.naturalHeight}` : 'none';
  }));

  await page.waitForTimeout(200);
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(1200);
  log('刷新后背景存在(默认封面/午夜备用)', await page.evaluate(() => !!document.querySelector('.bg-layer')));

  // ---------- 10) 歌单导入与播放器 ----------
  // 10a. 导入演示歌单（输入留空）
  // 左侧 Dock 由边缘感应触发：小球浮出后点「导入」，滑出左侧面板
  await page.mouse.move(4, 420);
  await page.waitForTimeout(600);
  await page.locator('.sd-rail.sd-left .sd-orb[aria-label="导入"]').click();
  await page.waitForTimeout(500);
  await page.locator('.manual-import .input').fill('');
  await page.locator('.manual-import .input').press('Enter');
  await page.waitForFunction(() => window.__nebula && window.__nebula.total === 16, null, {
    timeout: 15000,
  });
  await page.waitForFunction(
    () => window.__nebula.revealed() >= 16 && document.querySelectorAll('.music-card').length >= 10,
    null,
    { timeout: 15000 },
  );
  const importTotal = await page.evaluate(() => window.__nebula.total);
  const mountedAfterImport = await page.evaluate(() => document.querySelectorAll('.music-card').length);
  log('导入后曲库数(应为16)', importTotal);
  log('导入后挂载卡片数', mountedAfterImport);

  // 10a+. 侧面板点开后常驻（样张 F）：鼠标移开不收起；Esc 关闭后小球列按延迟收回
  await page.mouse.move(800, 450);
  await page.waitForTimeout(800);
  const panelStays = await page.evaluate(() => !!document.querySelector('.sd-panel.sd-left.is-open'));
  log('左侧面板移开后保持打开', panelStays);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(900);
  const edgeHideOk = await page.evaluate(
    () => !document.querySelector('.sd-panel.sd-left.is-open') && !document.querySelector('.sd-rail.sd-left.is-shown'),
  );
  log('Esc 关闭后左侧收回', edgeHideOk);

  // 10a++. 播放模式：顺序 → 单曲循环 → 随机（Fisher-Yates 全歌单洗牌）
  const modeCycle = await page.evaluate(() => {
    const p = window.__nebula.player;
    const all = window.__nebula.songsData();
    p.playSong(all[0], all);
    const seen = [];
    for (let i = 0; i < 3; i++) {
      p.cycleMode();
      seen.push(p.getState().mode);
    }
    return seen;
  });
  await page.evaluate(() => window.__nebula.player.setMode('random'));
  const shuffle = await page.evaluate(() => {
    const p = window.__nebula.player;
    const ids = new Set();
    for (let i = 0; i < 12; i++) {
      p.next();
      ids.add(p.getState().song?.id);
    }
    return { mode: p.getState().mode, unique: ids.size };
  });
  await page.evaluate(() => window.__nebula.player.setMode('sequential'));
  const modeOk = JSON.stringify(modeCycle) === JSON.stringify(['random', 'repeat-one', 'sequential']);
  log('播放模式循环', modeCycle.join(' -> '));
  log('随机模式 12 次切歌不重复', `${shuffle.unique}/12`);
  const shuffleOk = modeOk && shuffle.mode === 'random' && shuffle.unique === 12;

  // 10a++++. 「下一首播放」插队位置（随机 / 顺序两种模式；被插歌曲在当前曲之前；对当前曲自己插队）
  const insertNext = await page.evaluate(() => {
    const p = window.__nebula.player;
    const all = window.__nebula.songsData();
    const up = () => p.getQueueSnapshot();
    const out = {};
    p.setMode('random');
    p.playSong(all[0], all);
    p.next(); p.next(); p.next();
    // 挑两首不是当前曲的歌（随机模式下当前曲可能正好是任何一首；对当前曲插队按设计会被忽略）
    const cur = p.getState().song?.id;
    const [a, b] = all.filter((t) => t.id !== cur);
    p.insertNext(a);
    p.insertNext(b);
    out.randomFifo = up().upcoming[0]?.id === a.id && up().upcoming[1]?.id === b.id;
    p.setMode('sequential');
    p.playSong(all[5], all);
    p.insertNext(all[2]);
    out.beforeCurrent = up().current?.id === all[5].id && up().upcoming[0]?.id === all[2].id;
    p.insertNext(all[5]);
    out.selfNoop = up().current?.id === all[5].id && up().upcoming[0]?.id === all[2].id;
    p.next();
    out.playsInserted = p.getState().song?.id === all[2].id;
    return out;
  });
  const insertOk = Object.values(insertNext).every(Boolean);
  log('下一首播放插队', JSON.stringify(insertNext));

  // 10a+++++. 会话恢复后第一次点播放：要真的开始播放（以前卡在「播放中 + 加载中」）
  await page.evaluate(() => {
    const p = window.__nebula.player;
    const all = window.__nebula.songsData();
    p.stop();
    p.restore(all[3], all);
    p.toggle();
  });
  const restorePlay = await page
    .waitForFunction(
      () => {
        const s = window.__nebula.player.getState();
        return s.playing && !s.loading && s.currentTime > 0.05;
      },
      null,
      { timeout: 12000 },
    )
    .then(() => true)
    .catch(() => false);
  log('恢复后首次播放', restorePlay);

  // 10a+++. 音量面板悬停向上展开
  await page.locator('.bp-tools .vol-ctl').hover();
  await page.waitForSelector('.vol-pop .vol-slider', { state: 'visible', timeout: 4000 });
  const volAfter = await page.locator('.vol-pop .vol-slider').count();
  log('音量面板展开', `0 -> ${volAfter}`);
  const volOk = volAfter > 0;

  // 10a++++. 自绘细滑杆（2026-11-16）：拖到 25% 时音量、读数、图标声波档位跟着变；胶囊高度不超过 34px
  const vol0 = await page.evaluate(() => window.__nebula.player.getState().volume);
  const vBox = await page.locator('.vol-pop .vol-slider').boundingBox();
  await page.mouse.move(vBox.x + vBox.width * 0.4, vBox.y + vBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(vBox.x + vBox.width * 0.25, vBox.y + vBox.height / 2, { steps: 4 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  const volUi = await page.evaluate(() => {
    const sl = document.querySelector('.vol-pop .vol-slider');
    const pop = document.querySelector('.vol-pop');
    return {
      now: Number(sl?.getAttribute('aria-valuenow')),
      vol: +window.__nebula.player.getState().volume.toFixed(2),
      num: document.querySelector('.vol-pop .vol-num')?.textContent,
      lv: document.querySelector('.bp-vol .vol-ico')?.getAttribute('data-lv'),
      h: pop ? Math.round(pop.getBoundingClientRect().height) : 0,
      native: !!document.querySelector('.vol-pop input[type=range]'),
    };
  });
  await page.evaluate((v) => window.__nebula.player.setVolume(v), vol0);
  const volUiOk =
    Math.abs(volUi.now - 25) <= 3 &&
    Math.abs(volUi.vol - 0.25) <= 0.03 &&
    volUi.num === String(volUi.now) &&
    volUi.lv === '1' &&
    volUi.h > 0 &&
    volUi.h <= 34 &&
    !volUi.native;
  log('音量细滑杆', JSON.stringify(volUi));

  // 10a++++++. 状态提示不改变播放条高度（以前「正在解析音源」插成一行，把整条播放条顶高）；
  // 嵌在播放条里的弹层不能继承播放条的折射贴图（以前队列顶部被套出一块「独立的胶囊」）
  const barLayout = await page.evaluate(async () => {
    const bar = document.querySelector('.player-surface');
    const h0 = bar.getBoundingClientRect().height;
    window.__nebula.player.setError('正在获取音源…');
    await new Promise((r) => setTimeout(r, 120));
    const h1 = bar.getBoundingClientRect().height;
    const inMeta = !!document.querySelector('.bp-meta .bp-status');
    window.__nebula.player.setError(null);
    const pop = document.querySelector('.vol-pop');
    const popFilter = pop ? getComputedStyle(pop).backdropFilter : '';
    return { h0: Math.round(h0), h1: Math.round(h1), inMeta, popFilter };
  });
  const barLayoutOk =
    barLayout.h0 === 72 && barLayout.h0 === barLayout.h1 && barLayout.inMeta && !/url\(/.test(barLayout.popFilter);
  log('状态提示与弹层材质', JSON.stringify(barLayout));

  // 10a+++++++. 播放条新规格（NEBULA_UI_SYSTEM §9.1）：几何、回到中心的位置、平时不显示时间、
  // 悬停播放条出时间、悬停细线出时间点气泡、封面带 data-np-cover、播放条上不再有来源平台文字
  await page.mouse.move(700, 250);
  await page.waitForTimeout(500);
  const barGeo = await page.evaluate(() => {
    const bar = document.querySelector('.player-surface');
    const btn = document.querySelector('.center-btn');
    const b = bar.getBoundingClientRect();
    const c = btn.getBoundingClientRect();
    const cover = document.querySelector('.bp-cover[data-np-cover]');
    const cr = cover ? cover.getBoundingClientRect() : null;
    return {
      w: Math.round(b.width),
      expectW: Math.round(Math.min(920, Math.max(560, innerWidth * 0.56))),
      bottom: Math.round(innerHeight - b.bottom),
      gap: Math.round(c.left - b.right),
      dy: Math.round(c.top + c.height / 2 - (b.top + b.height / 2)),
      cover: cr ? Math.round(cr.width) : 0,
      noSrc: !document.querySelector('.bp-artist-src'),
      timeIdle: Number(getComputedStyle(document.querySelector('.bp-time')).opacity),
      trackH: document.querySelector('.bp-progress-track').getBoundingClientRect().height,
      leftTimeIdle: Number(getComputedStyle(document.querySelector('.bp-left-time')).opacity),
    };
  });
  const barBox = await page.locator('.player-surface').boundingBox();
  await page.mouse.move(barBox.x + barBox.width * 0.45, barBox.y + barBox.height * 0.55);
  await page.waitForTimeout(500);
  const barHover = await page.evaluate(() => ({
    time: Number(getComputedStyle(document.querySelector('.bp-time')).opacity),
    trackH: document.querySelector('.bp-progress-track').getBoundingClientRect().height,
    text: document.querySelector('.bp-time').textContent,
  }));
  const hasDur = await page.evaluate(() => window.__nebula.player.getState().duration > 0);
  const trackBox = await page.locator('.player-surface .bp-progress-track').boundingBox();
  await page.mouse.move(trackBox.x + trackBox.width * 0.3, trackBox.y + trackBox.height / 2);
  await page.waitForTimeout(250);
  const bubbleText = await page.evaluate(() => document.querySelector('.bp-seek-bubble')?.textContent ?? null);
  await page.mouse.move(700, 250);
  await page.waitForTimeout(300);
  const bubbleGone = await page.evaluate(() => !document.querySelector('.bp-seek-bubble'));
  const barNewOk =
    Math.abs(barGeo.w - barGeo.expectW) <= 1 &&
    barGeo.bottom === 20 &&
    barGeo.gap === 14 &&
    Math.abs(barGeo.dy) <= 1 &&
    barGeo.cover === 48 &&
    barGeo.noSrc &&
    barGeo.timeIdle === 0 &&
    barGeo.leftTimeIdle === 0 &&
    barGeo.trackH === 2 &&
    barHover.time > 0.95 &&
    barHover.trackH === 3 &&
    /^\d+:\d\d \/ \d+:\d\d$/.test(barHover.text) &&
    (!hasDur || /^\d+:\d\d$/.test(bubbleText ?? '')) &&
    bubbleGone;
  log('播放条新规格', JSON.stringify({ barGeo, barHover, bubbleText, bubbleGone }));

  // 10a++++++++. 听音空间（NEBULA_UI_SYSTEM §9.9）：点播放条封面进入（.app[data-ls]、听音空间显示、播放条缩成胶囊、
  // 播放条封面让位）；大封面落在位置槽上；Esc 收起后大封面卸下、播放条封面复原（同帧交接，不能留在隐藏状态）
  const lsOpen = await page.evaluate(async () => {
    const cover = document.querySelector('.bp-cover[data-np-cover]');
    if (!cover) return { ok: false };
    cover.click();
    await new Promise((r) => setTimeout(r, 1000));
    const hero = document.querySelector('.ls-hero');
    const slot = document.querySelector('.ls-slot');
    const hr = hero ? hero.getBoundingClientRect() : null;
    const sr = slot ? slot.getBoundingClientRect() : null;
    return {
      ok: true,
      dataLs: document.querySelector('.app').hasAttribute('data-ls'),
      shown: !!document.querySelector('.ls-root.is-shown'),
      heroOnSlot: !!hr && !!sr && Math.abs(hr.left - sr.left) < 1.5 && Math.abs(hr.top - sr.top) < 1.5 && Math.abs(hr.width - sr.width) < 1.5,
      barW: Math.round(document.querySelector('.player-surface').getBoundingClientRect().width),
      coverHidden: getComputedStyle(cover).visibility === 'hidden',
    };
  });
  // 水平布局（#129）：中等窗口位置和原来一样（封面左边距 ≈ 10.6vw）；2K 下整组居中，右边留白和左边相当
  const lsGeo = () =>
    page.evaluate(() => {
      const sr = document.querySelector('.ls-slot')?.getBoundingClientRect();
      const col = document.querySelector('.ls-col')?.getBoundingClientRect();
      if (!sr || !col) return null;
      // 歌词栏宽 = 一行最宽 + 40k（QA 的歌可能没有歌词，按栏右边量，右边留白会比按最长一行量少约 45px）
      return { W: innerWidth, left: Math.round(sr.left), top: Math.round(sr.top), cv: Math.round(sr.width), gap: Math.round(col.left - sr.right), right: Math.round(innerWidth - col.right), colW: Math.round(col.width) };
    });
  const lsMid = await lsGeo();
  await page.setViewportSize({ width: 2544, height: 1375 });
  await page.waitForTimeout(500);
  const lsWide = await lsGeo();
  // 窄窗口（#131）：封面和歌词之间至少 0.24 × 封面；竖长窗口里封面中心落在 37.7% 高处
  await page.setViewportSize({ width: 1024, height: 700 });
  await page.waitForTimeout(500);
  const lsNarrow = await lsGeo();
  await page.setViewportSize({ width: 1280, height: 1380 });
  await page.waitForTimeout(500);
  const lsTall = await lsGeo();
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.waitForTimeout(500);
  const lsLayoutOk =
    !!lsMid && !!lsWide &&
    Math.abs(lsMid.left - 1600 * 0.106) <= 4 &&
    lsWide.right / lsWide.left > 0.65 && lsWide.right / lsWide.left < 1 &&
    lsWide.colW < 2544 * 0.4 &&
    !!lsNarrow && lsNarrow.gap >= lsNarrow.cv * 0.24 - 2 &&
    !!lsTall && lsTall.gap >= lsTall.cv * 0.24 - 2 && Math.abs(lsTall.top + lsTall.cv / 2 - 1380 * 0.377) <= 3;
  log('听音空间整组居中', JSON.stringify({ lsMid, lsWide, lsNarrow, lsTall }));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(1000);
  const lsClosed = await page.evaluate(() => ({
    dataLs: document.querySelector('.app').hasAttribute('data-ls'),
    root: !!document.querySelector('.ls-root'),
    hero: !!document.querySelector('.ls-hero'),
    coverVisible: getComputedStyle(document.querySelector('.bp-cover[data-np-cover]')).visibility !== 'hidden',
  }));
  const listenOk =
    lsOpen.ok && lsOpen.dataLs && lsOpen.shown && lsOpen.heroOnSlot && lsOpen.barW <= 641 && lsOpen.coverHidden &&
    !lsClosed.dataLs && !lsClosed.root && !lsClosed.hero && lsClosed.coverVisible;
  log('听音空间进出', JSON.stringify({ lsOpen, lsClosed }));

  // 主舞台星云（#133 / #134 / #135 / #136 / #137）：三种排法都能排布（位置都是有限数）、有封面层画布；
  // 画布首尾相接、没有边界；滚轮一直往外缩会停在下限（最远约 0.28 倍，封面还认得出；小歌单下限更高）；
  // 拖动不闪烁（#137 回归）：换排法等够久之后，拖动期间没有卡片重放进场动画、DOM 里没有卡片被挪动，也没有同一首歌挂了两张。
  // 顺序最后落在默认排法（按颜色），后面的用例都跑在默认体验上。
  const spaceLab = { ok: true };
  if (!(await page.evaluate(() => !!(window.__nebula && window.__nebula.stageMode)))) spaceLab.ok = false;
  const probeStage = () =>
    page.evaluate(() => {
      const n = window.__nebula;
      const st = document.querySelector('.stage-3d');
      const cards = [...document.querySelectorAll('.stage-3d .music-card')];
      const bad = cards.filter((c) => !Number.isFinite(parseFloat(c.style.getPropertyValue('--x')))).length;
      const sp = n.space();
      const ids = cards.map((c) => c.getAttribute('data-song-id'));
      return {
        bounded: !!(st && st.classList.contains('is-bounded')),
        canvas: !!document.querySelector('.space-stars'),
        cards: cards.length,
        bad,
        dups: ids.length - new Set(ids).size,
        zoom: +sp.zoom.toFixed(3),
        period: Math.round(sp.period),
        clusters: sp.clusters,
        labelsIsArray: Array.isArray(sp.labels),
      };
    });
  for (const m of spaceLab.ok ? ['cluster', 'random', 'chroma'] : []) {
    // 每次换排法舞台都会重建 __nebula，所以每次都取最新的；等够久（> 1s），让进场淡入（data-arriving 约 0.9s）过去
    await page.evaluate((mode) => window.__nebula.stageMode(mode), m);
    await page.waitForTimeout(1400);
    const a = await probeStage();
    // 拖动不闪烁：监听进场动画重放 + 卡片 DOM 节点被挪动（同一次回调里既被移除又被加入）
    await page.evaluate(() => {
      const st = document.querySelector('.stage-3d');
      const plane = document.querySelector('.space-plane');
      const w = (window.__qaFlicker = { anim: 0, moved: 0, arriving: st.hasAttribute('data-arriving') });
      st.addEventListener(
        'animationstart',
        (e) => {
          if (e.animationName === 'space-card-in') w.anim++;
        },
        true,
      );
      new MutationObserver((recs) => {
        const removed = new Set();
        const added = new Set();
        for (const r of recs) {
          r.removedNodes.forEach((x) => x.classList && x.classList.contains('music-card') && removed.add(x));
          r.addedNodes.forEach((x) => x.classList && x.classList.contains('music-card') && added.add(x));
        }
        for (const x of added) if (removed.has(x)) w.moved++;
      }).observe(plane, { childList: true });
    });
    await page.evaluate(() => {
      const c = window.__nebula.space().center;
      window.__nebula.lookAt(c.x, c.y, 1);
    });
    await page.waitForTimeout(1200);
    for (const [x0, y0, x1, y1] of [[400, 450, 1100, 450], [1100, 450, 400, 520], [800, 200, 800, 700], [800, 700, 820, 150]]) {
      await page.mouse.move(x0, y0);
      await page.mouse.down();
      await page.mouse.move(x1, y1, { steps: 14 });
      await page.mouse.up();
      await page.waitForTimeout(350);
    }
    await page.waitForTimeout(800);
    const flicker = await page.evaluate(() => ({ ...window.__qaFlicker, dragMounted: document.querySelectorAll('.stage-3d .music-card').length }));
    const dragDups = (await probeStage()).dups;
    await page.mouse.move(20, 20);
    // 滚轮一直往外缩，看停在不在下限
    await page.evaluate(async () => {
      const st = document.querySelector('.stage-3d');
      const r = st.getBoundingClientRect();
      for (let i = 0; i < 20; i++) st.dispatchEvent(new WheelEvent('wheel', { deltaY: 120, clientX: r.width / 2, clientY: r.height / 2, bubbles: true, cancelable: true }));
    });
    await page.waitForTimeout(1000);
    spaceLab[m] = { a, b: await probeStage(), flicker: { ...flicker, dragDups } };
  }
  const spaceOk =
    spaceLab.ok &&
    ['cluster', 'chroma', 'random'].every((m) => {
      const v = spaceLab[m];
      return (
        v.a.bounded && v.a.canvas && v.a.cards >= 8 && v.a.bad === 0 && v.a.dups === 0 && v.a.period > 0 && v.b.zoom >= 0.279 && v.b.bad === 0 &&
        // #137 回归：拖动期间没有进场动画重放、没有卡片 DOM 被挪动、没有重复的歌
        !v.flicker.arriving && v.flicker.anim === 0 && v.flicker.moved === 0 && v.flicker.dragDups === 0 && v.flicker.dragMounted > 0
      );
    }) &&
    spaceLab.cluster.a.clusters > 1 &&
    spaceLab.cluster.a.labelsIsArray;
  log('主舞台星云', JSON.stringify(spaceLab));


  // 10b. 点击卡片播放
  const cardCenter = await page.evaluate(() => {
    const vw = innerWidth;
    const vh = innerHeight;
    let best = null;
    let bestD = Infinity;
    for (const el of document.querySelectorAll('.music-card')) {
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      if (cx < 20 || cx > vw - 20 || cy < 20 || cy > vh - 20) continue;
      const d = Math.hypot(cx - vw / 2, cy - vh / 2);
      if (d < bestD) {
        bestD = d;
        best = { x: cx, y: cy };
      }
    }
    return best;
  });
  if (!cardCenter) {
    console.error('[QA] 导入后未找到可播放卡片');
    process.exit(1);
  }
  await page.mouse.click(cardCenter.x, cardCenter.y);
  await page.waitForFunction(() => window.__nebula.player.getState().song !== null, null, {
    timeout: 8000,
  });
  // playing 事件才表示实际出流；不能在点击后的同一帧把 play 请求当作已播放。
  await page.waitForFunction(() => {
    const s = window.__nebula.player.getState();
    return s.playing && !s.loading;
  }, null, { timeout: 10000 });
  const playState1 = await page.evaluate(() => {
    const s = window.__nebula.player.getState();
    return { title: s.song?.title, playing: s.playing };
  });
  log('点击卡片后播放状态', JSON.stringify(playState1));
  let duration = 0;
  try {
    await page.waitForFunction(() => window.__nebula.player.getState().duration > 0, null, {
      timeout: 8000,
    });
    duration = await page.evaluate(() => window.__nebula.player.getState().duration);
  } catch {
    log('音频元数据加载超时（网络受限，跳过时长断言）', 'n/a');
  }
  log('音频时长(秒)', duration.toFixed(1));

  // 10b+. 点击卡片会打开二级播放窗口：先 Esc 关闭，回到主界面操作底部条
  await page.keyboard.press('Escape');
  await page.waitForTimeout(350);

  // 10c. 播放 / 暂停
  await page.locator('.player-surface .bp-play').click();
  await page.waitForFunction(() => !window.__nebula.player.getState().playing);
  log('暂停后 playing=false', await page.evaluate(() => window.__nebula.player.getState().playing === false));
  await page.locator('.player-surface .bp-play').click();
  await page.waitForFunction(() => window.__nebula.player.getState().playing);
  log('恢复播放 playing=true', 'ok');


  // 10c+. 进度填充逐帧亚像素推进（2026-11-16）：连续 40 帧采样填充右缘，应基本每帧都在动、出现小数像素、整体单调
  await page.waitForTimeout(600);
  const progSmooth = await page.evaluate(
    () =>
      new Promise((res) => {
        const fill = document.querySelector('.bp-progress-fill');
        const xs = [];
        const step = () => {
          xs.push(fill.getBoundingClientRect().right);
          if (xs.length < 40) requestAnimationFrame(step);
          else {
            let moved = 0;
            let back = 0;
            let frac = 0;
            for (let i = 1; i < xs.length; i++) {
              if (xs[i] > xs[i - 1] + 1e-4) moved++;
              if (xs[i] < xs[i - 1] - 0.5) back++;
              if (Math.abs(xs[i] - Math.round(xs[i])) > 0.01) frac++;
            }
            res({ frames: xs.length - 1, moved, back, frac, tf: fill.style.transform.slice(0, 40) });
          }
        };
        requestAnimationFrame(step);
      }),
  );
  const progSmoothOk = progSmooth.moved >= progSmooth.frames * 0.6 && progSmooth.back === 0 && progSmooth.frac > 0;
  log('进度填充逐帧推进', JSON.stringify(progSmooth));

  // 10d. 下一首 / 上一首
  const idBefore = await page.evaluate(() => window.__nebula.player.getState().song.id);
  await page.locator('.player-surface .bp-ctrl[aria-label="下一首"]').click();
  await page.waitForFunction(
    (prev) => {
      const s = window.__nebula.player.getState();
      return s.song && s.song.id !== prev;
    },
    idBefore,
    { timeout: 8000 },
  );
  const idAfterNext = await page.evaluate(() => window.__nebula.player.getState().song.id);
  log('下一首切换', `${idBefore} -> ${idAfterNext}`);
  await page.locator('.player-surface .bp-ctrl[aria-label="上一首"]').click();
  await page.waitForFunction(
    (prev) => {
      const s = window.__nebula.player.getState();
      return s.song && s.song.id === prev;
    },
    idBefore,
    { timeout: 8000 },
  );
  log('上一首返回', 'ok');

  // 10e. 进度条 seek：断言「点进度条 60% 处 → 发出跳到 60% 的请求」。
  // 不看 currentTime：QA 用的是网络 MP3，刚缓冲时浏览器不允许跳到很远的位置，会复位到 0，和界面接线无关。
  // （以前 ProgressLine 没挂 ref，点了根本不会发请求，这里又只打印不断言，所以一直没发现。）
  let seekOk = true;
  const curDuration = await page
    .waitForFunction(() => window.__nebula.player.getState().duration > 0, null, { timeout: 15000 })
    .then(() => page.evaluate(() => window.__nebula.player.getState().duration))
    .catch(() => 0);
  if (curDuration > 0) {
    await page.evaluate(() => {
      const p = window.__nebula.player;
      window.__seekCalls = [];
      const orig = Object.getPrototypeOf(p).seek;
      p.seek = function (t) {
        window.__seekCalls.push(t);
        return orig.call(this, t);
      };
    });
    const box = await page.locator('.player-surface .bp-progress-track').boundingBox();
    await page.mouse.click(box.x + box.width * 0.6, box.y + box.height / 2);
    await page.waitForTimeout(300);
    const calls = await page.evaluate(() => {
      delete window.__nebula.player.seek;
      return window.__seekCalls;
    });
    const last = calls[calls.length - 1];
    log('进度条点 60% 发出的跳转', calls.length ? `${last.toFixed(1)}s / ${curDuration.toFixed(1)}s` : '没有调用 seek');
    seekOk = typeof last === 'number' && last >= curDuration * 0.55 && last <= curDuration * 0.65;
  } else {
    log('seek 测试', '跳过（当前歌曲没有时长）');
  }

  // 10f. 坏链接自动跳歌 + 卡片置灰
  const goodAudio0 = await page.evaluate(() => window.__nebula.songsData()[0].audio);
  await page.evaluate(() => {
    window.__nebula.setSongAudio(0, 'https://127.0.0.1:1/broken.mp3');
  });
  await page.waitForTimeout(500);
  const brokenCard = await page.evaluate(() => {
    const el = document.querySelector('.music-card[data-song-id="0"]');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    if (cx < 20 || cx > innerWidth - 20 || cy < 20 || cy > innerHeight - 20) return null;
    return { x: cx, y: cy };
  });
  if (brokenCard) {
    await page.mouse.click(brokenCard.x, brokenCard.y);
  } else {
    await page.evaluate(() => {
      const n = window.__nebula;
      const bad = { ...n.songsData()[0], audio: 'https://127.0.0.1:1/broken.mp3' };
      n.player.playSong(bad, [bad, n.songsData()[1]]);
    });
  }
  await page.waitForFunction(() => {
    const s = window.__nebula.player.getState();
    return s.song && s.song.id !== 0;
  }, null, { timeout: 10000 });
  const skippedTo = await page.evaluate(() => window.__nebula.player.getState().song.id);
  await page.waitForFunction(() => document.querySelectorAll('.music-card.is-failed').length > 0, null, {
    timeout: 5000,
  });
  const failedCount = await page.evaluate(() => document.querySelectorAll('.music-card.is-failed').length);
  log('坏链接自动跳到下一首(期望1)', skippedTo);
  log('置灰卡片数(应≥1)', failedCount);

  // 10f+. 同一首之后真正播起来（如重新登录后再点）→ 置灰恢复
  await page.evaluate((url) => {
    const n = window.__nebula;
    n.setSongAudio(0, url);
  }, goodAudio0);
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    const n = window.__nebula;
    n.player.playSong(n.songsData()[0], n.songsData());
  });
  const failedRecovered = await page
    .waitForFunction(
      () => {
        const s = window.__nebula.player.getState();
        return s.song?.id === 0 && s.playing && !document.querySelector('.music-card.is-failed[data-song-id="0"]');
      },
      null,
      { timeout: 15000 },
    )
    .then(() => true)
    .catch(() => false);
  log('重新播放成功后置灰恢复', failedRecovered);
  if (!failedRecovered) {
    log('置灰恢复诊断', JSON.stringify(await page.evaluate(() => {
      const s = window.__nebula.player.getState();
      const el = document.querySelector('.music-card[data-song-id="0"]');
      return { id: s.song?.id, playing: s.playing, loading: s.loading, failed: s.failed, error: s.error, t: s.currentTime,
        audio0: String(window.__nebula.songsData()[0].audio).slice(0, 60), card: el ? el.className : null,
        failedCards: [...document.querySelectorAll('.music-card.is-failed')].map((e) => e.getAttribute('data-song-id')) };
    })));
  }

  // 10g. 音质选择（注入桌面 API stub，验证列表拉取 + 菜单交互 + 切源）
  await page.evaluate(() => {
    window.nebulaAPI = {
      importPlaylist: async () => ({ ok: true, data: null }),
      importPlaylistId: async () => ({ ok: true, data: null }),
      resolveSong: async (track, quality) => ({
        ok: true,
        data: {
          url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3',
          quality,
          playable: true,
          fallback: false,
          platform: 'netease',
          sourceId: track.sourceId,
        },
      }),
      songQualities: async () => ({
        ok: true,
        data: [
          { level: 'lossless', label: '无损' },
          { level: 'exhigh', label: '极高' },
          { level: 'standard', label: '标准' },
        ],
      }),
      fallbackSong: async () => ({ ok: false, error: 'no' }),
      // 逐字歌词（YRC 格式）：每 3.5 秒一句、每字 300ms，用来验证空域歌词的逐字层（#124）
      fetchLyric: async () => {
        const text = '星光落在远方的海面';
        const lines = [];
        let yrc = '';
        for (let i = 0; i < 120; i++) {
          const t = 500 + i * 3500;
          lines.push({ timeMs: t, text });
          yrc += `[${t},${text.length * 300}]` + [...text].map((c, j) => `(${t + j * 300},300,0)${c}`).join('') + '\n';
        }
        return { ok: true, data: { source: 'netease', lines, yrc } };
      },
      fetchComments: async () => ({ ok: false, error: 'no' }),
      loginAccount: async () => ({ ok: true, data: { loggedIn: false } }),
      loginPlaylists: async () => ({ ok: true, data: [] }),
      openLocalDirectory: async () => ({
        ok: true,
        data: {
          tracks: [
            {
              id: 'local:C:/Music/Test Song.mp3',
              title: 'Local Test',
              artist: 'Local Artist',
              album: 'Local Album',
              cover: '',
              duration: 180,
              platform: 'local',
              sourceId: 'C:/Music/Test Song.mp3',
              originalUrl: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-3.mp3',
              fallbackUrl: '',
            },
          ],
        },
      }),
    };
    const demo = window.__nebula.songsData()[0];
    const track = {
      ...demo,
      source: 'netease',
      sourceId: '123456',
      audio: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3',
    };
    window.__nebula.player.playSong(track, [track]);
  });
  await page.waitForFunction(
    () => {
      const btn = document.querySelector('.bp-tools .bp-quality');
      return !!btn && !btn.disabled;
    },
    null,
    { timeout: 8000 },
  );
  await page.locator('.bp-tools .bp-quality').click();
  await page.waitForSelector('.quality-pop .quality-item', { state: 'visible', timeout: 4000 });
  const qualityItems = await page.locator('.quality-pop .quality-item').count();
  await page.locator('.quality-pop .quality-item', { hasText: '无损' }).click();
  await page.waitForTimeout(300);
  const qualityState = await page.evaluate(() => {
    const s = window.__nebula.player.getState();
    return {
      quality: s.quality,
      switched: (s.song?.audio || '').includes('SoundHelix-Song-2'),
    };
  });
  log('音质菜单项数', qualityItems);
  log('音质切换后 quality/switched', JSON.stringify(qualityState));

  // 10g+. QQ 登录过期（#157）：播放条那句提示本身是按钮 → 打开 QQ 详情并说明过期；
  // 同时重查 QQ 账号，账号列表那一行变成警告色的点 +「登录已过期」
  await page.evaluate(() => {
    window.nebulaAPI.loginAccount = async (p) =>
      p === 'qq'
        ? { ok: true, data: { loggedIn: false, authStatus: 'expired', error: 'QQ 登录已过期，请重新登录' } }
        : { ok: true, data: { loggedIn: false } };
    window.__nebula.player.setError('QQ 登录已过期，请重新登录');
  });
  const lapseBtn = await page
    .waitForSelector('.bp-status.is-warn.is-action', { timeout: 3000 })
    .then(() => true)
    .catch(() => false);
  if (lapseBtn) await page.locator('.bp-status.is-warn.is-action').click();
  await page.waitForTimeout(1000);
  const lapse = await page.evaluate(() => {
    const d = document.querySelector('.sd-panel.sd-right .rp-detail');
    const row = [...document.querySelectorAll('.sd-panel.sd-right .rp-status')].find((s) => /登录已过期/.test(s.textContent || ''));
    return {
      title: d?.querySelector('h3')?.textContent || '',
      note: d?.querySelector('.rp-lapsed')?.textContent || '',
      row: !!row && !!row.querySelector('.rp-dot.is-warn'),
    };
  });
  const lapseOk = lapseBtn && /QQ/.test(lapse.title) && /登录已过期/.test(lapse.note) && lapse.row;
  log('QQ 登录过期提示', JSON.stringify({ btn: lapseBtn, ...lapse }));
  await page.evaluate(() => window.__nebula.player.setError(null));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(900);

  // 10g++. 听音空间大封面清晰度（#158）：后端实测原图更大 → 解码好后换上原图；
  // 听音空间开着时换到一首读不出原图尺寸的歌 → 不连换两次，直接落在它自己的小图上
  const bigCover = await page.evaluate(async (audio) => {
    const mk = (px, color) => {
      const c = document.createElement('canvas');
      c.width = c.height = px;
      const g = c.getContext('2d');
      g.fillStyle = color;
      g.fillRect(0, 0, px, px);
      return c.toDataURL('image/png');
    };
    const small = mk(64, '#c04080');
    const big = mk(900, '#40c080');
    const small2 = mk(64, '#8040c0');
    window.nebulaAPI.coverInfo = async (t) =>
      t.sourceId === 'qa-cover-big'
        ? { ok: true, data: { url: big, width: 900, height: 900, verified: true } }
        : { ok: true, data: { url: t.cover, verified: false } };
    const n = window.__nebula;
    const base = n.songsData()[0];
    const heroHas = (u) => (document.querySelector('.ls-hero')?.getAttribute('style') || '').includes(u);
    const until = async (f, ms) => {
      const t0 = performance.now();
      while (!f() && performance.now() - t0 < ms) await new Promise((r) => setTimeout(r, 80));
      return f();
    };
    const s1 = { ...base, source: 'qq', sourceId: 'qa-cover-big', cover: small, audio };
    n.player.playSong(s1, [s1]);
    await new Promise((r) => setTimeout(r, 300));
    document.querySelector('.bp-cover[data-np-cover]').click();
    const upgraded = await until(() => heroHas(big), 4000);
    const s2 = { ...base, source: 'qq', sourceId: 'qa-cover-small', cover: small2, audio };
    n.player.playSong(s2, [s2]);
    const second = await until(() => heroHas(small2), 3000);
    await new Promise((r) => setTimeout(r, 1000));
    return { upgraded, second, settled: heroHas(small2) && !heroHas(big) };
  }, lyricAudio);
  const bigCoverOk = bigCover.upgraded && bigCover.second && bigCover.settled;
  log('听音空间大封面换原图', JSON.stringify(bigCover));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(1000);

  // 10g+++. 罗马音（#161）：有罗马音的歌，听音空间默认不显示、翻译按钮左边多一个罗马音按钮；
  // 点开后罗马音在原文正下方、翻译之前；和原文一样的（英文行）不挂
  const roman = await page.evaluate(async (audio) => {
    const api = window.nebulaAPI;
    const keep = api.fetchLyric;
    const jp = ['君の名前を呼んでいる', '星の海を渡って', 'Hello world'];
    const ro = ['kimi no namae wo yonde iru', 'hoshi no umi wo watatte', 'Hello world'];
    const fmt = (t) => `[${String(Math.floor(t / 60000)).padStart(2, '0')}:${String(Math.floor((t % 60000) / 1000)).padStart(2, '0')}.${String(Math.floor((t % 1000) / 10)).padStart(2, '0')}]`;
    api.fetchLyric = async () => {
      const lines = [];
      let romalrc = '';
      for (let i = 0; i < 40; i++) {
        const t = 500 + i * 3000;
        lines.push({ timeMs: t, text: jp[i % 3], translation: i % 3 === 2 ? undefined : '叫着你的名字' });
        romalrc += `${fmt(t)}${ro[i % 3]}\n`;
      }
      return { ok: true, data: { source: 'netease', lines, romalrc } };
    };
    const n = window.__nebula;
    const s = { ...n.songsData()[0], source: 'netease', sourceId: 'qa-roman', cover: '', audio };
    n.player.playSong(s, [s]);
    await new Promise((r) => setTimeout(r, 600));
    document.querySelector('.bp-cover[data-np-cover]').click();
    const until = async (f, ms) => {
      const t0 = performance.now();
      while (!f() && performance.now() - t0 < ms) await new Promise((r) => setTimeout(r, 80));
      return f();
    };
    await until(() => !!document.querySelector('.ls-lyrics .ly-ro'), 5000);
    const root = document.querySelector('.ls-lyrics');
    const btn = document.querySelector('.ls-rob');
    const roEl = root?.querySelector('.ly-ro');
    const before = {
      btn: !!btn,
      pressed: btn?.getAttribute('aria-pressed'),
      hidden: !!roEl && getComputedStyle(roEl).display === 'none',
    };
    btn?.click();
    await new Promise((r) => setTimeout(r, 400));
    const line = roEl?.closest('.ly-line');
    const kids = line ? [...line.children].map((c) => c.className.split(' ')[0]) : [];
    const after = {
      pressed: btn?.getAttribute('aria-pressed'),
      shown: !!roEl && getComputedStyle(roEl).display !== 'none',
      text: roEl?.textContent || '',
      order: kids.join(','),
      // 英文行（Hello world）的罗马音和原文一样：不挂
      latinDup: [...(root?.querySelectorAll('.ly-ro') || [])].some((e) => e.textContent === 'Hello world'),
    };
    btn?.click();
    await new Promise((r) => setTimeout(r, 200));
    api.fetchLyric = keep;
    return { before, after };
  }, lyricAudio);
  const romanOk =
    roman.before.btn && roman.before.pressed === 'false' && roman.before.hidden &&
    roman.after.pressed === 'true' && roman.after.shown && /kimi|hoshi/.test(roman.after.text) &&
    /^ly-main,ly-ro,ly-tr/.test(roman.after.order) && !roman.after.latinDup;
  log('听音空间罗马音', JSON.stringify(roman));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(1000);

  // 10h. 本地音乐导入：顶部边缘感应 → 圆形按钮 → 星云卡片生成
  await page.mouse.move(800, 4);
  await page.waitForTimeout(600);
  await page.locator('.local-btn').click();
  await page.waitForFunction(() => window.__nebula?.total === 1, null, { timeout: 8000 });
  const localOk = await page.evaluate(() => {
    const s = window.__nebula.songsData()[0];
    return {
      title: s.title === 'Local Test',
      source: s.source === 'local',
      audio: (s.audio || '').includes('SoundHelix-Song-3'),
    };
  });
  log('本地音乐导入', JSON.stringify(localOk));

  // 10c-. 空域歌词换用听音空间的逐字层（#124）：当前句是 .u 逐字、带扫光进度；倾斜不超过 3°；
  // 漫游（没进入聆听）时退成氛围：当前句半透明；旧的扫光 / 上浮节点不再出现
  await page.evaluate((audio) => {
    const n = window.__nebula;
    const s0 = { ...n.songsData()[1], source: 'netease', sourceId: 'qa-lyric', audio };
    n.player.playSong(s0, [s0]);
  }, lyricAudio);
  await page.mouse.move(700, 250);
  await page.waitForSelector('.lyrics-layer .flow-lyric.is-current .u', { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(400);
  const z1 = await page.evaluate(() => {
    const cur = document.querySelector('.lyrics-layer .flow-lyric.is-current');
    if (!cur)
      return {
        missing: true,
        layer: !!document.querySelector('.lyrics-layer'),
        flights: document.querySelectorAll('.flow-lyric').length,
        t: window.__nebula.player.getState().currentTime,
        song: window.__nebula.player.getState().song?.sourceId ?? null,
      };
    const us = [...cur.querySelectorAll('.u')];
    const ps = us.map((u) => Number(u.style.getPropertyValue('--p') || 0));
    const m = (cur.style.transform.match(/rotate\((-?[\d.]+)deg\)/) || [])[1];
    return {
      units: us.length,
      grad: cur.classList.contains('is-grad'),
      pMax: Math.max(...ps),
      rot: m ? Math.abs(Number(m)) : null,
      op: Number(cur.style.opacity),
      listening: !!document.querySelector('.app[data-listen]'),
      old: document.querySelectorAll('.fl-word').length,
      caption: !!document.querySelector('.lyric-caption'),
    };
  });
  const z1Ok =
    !!z1 && z1.units === 9 && z1.grad && z1.pMax > 0 && z1.rot !== null && z1.rot <= 3.2 && z1.old === 0 && z1.caption &&
    (z1.listening || z1.op <= 0.66);
  log('空域歌词逐字层', JSON.stringify(z1));

  // 10c--. 字幕暗晕只压亮处（#125）：字幕根上不能有 opacity / filter（否则 backdrop-filter 看不到身后），
  // 暗晕用色调曲线滤镜
  const capHaze = await page.evaluate(() => {
    const cap = document.querySelector('.lyric-caption');
    const haze = cap?.querySelector('.lc-haze');
    if (!cap || !haze) return null;
    const cs = getComputedStyle(cap);
    return {
      rootOp: cs.opacity,
      rootFilter: cs.filter,
      backdrop: getComputedStyle(haze).backdropFilter,
      tone: !!document.getElementById('lc-cap-tone'),
    };
  });
  const capHazeOk =
    !!capHaze && capHaze.rootOp === '1' && capHaze.rootFilter === 'none' && /url\(/.test(capHaze.backdrop) && capHaze.tone;
  log('字幕暗晕只压亮处', JSON.stringify(capHaze));

  // 10c---. 设置面板开着、刚拖过滑杆（焦点留在 range 上），鼠标不动也要进入聆听（#125）
  await page.mouse.move(1596, 420);
  await page.waitForTimeout(600);
  await page.locator('.sd-rail.sd-right .sd-orb[aria-label="设置"]').click();
  await page.waitForTimeout(600);
  // 设置面板重排（#128）：「鼠标停多久」在「聆听」页；滑杆在「歌词」页
  await page.locator('.sd-panel.sd-right .seg.wide button', { hasText: '聆听' }).click();
  await page.waitForTimeout(300);
  const listenPage = await page.evaluate(() => ({
    tiles: document.querySelectorAll('.sd-panel.sd-right [data-listen-tile]').length,
    intro: !!document.querySelector('.sd-panel.sd-right .intro'),
  }));
  await page.locator('.sd-panel.sd-right button', { hasText: '3 秒' }).first().click();
  await page.locator('.sd-panel.sd-right .seg.wide button', { hasText: '歌词' }).click();
  await page.waitForTimeout(300);
  // 歌词页：一张预览 + 手动切换；同页两段控件左右对齐；「更多排版」默认收起
  const lyricPage = await page.evaluate(() => {
    const p = document.querySelector('.sd-panel.sd-right');
    const segs = [...p.querySelectorAll('.group .seg')].filter((s) => s.querySelectorAll(':scope > button').length === 2 && s.getClientRects().length && s.closest('.more-body:not(.open)') === null);
    const rs = segs.map((s) => s.getBoundingClientRect());
    return {
      head: p.querySelectorAll('.pv-head button').length,
      previews: p.querySelectorAll('.pv-box').length,
      oldListenPreview: !!p.querySelector('.set-page > .lsp-prev'),
      segs: segs.length,
      aligned: rs.every((r) => Math.abs(r.left - rs[0].left) < 1 && Math.abs(r.right - rs[0].right) < 1),
      moreOpen: !!p.querySelector('.more-body.open'),
      nativeColor: !!p.querySelector('input[type="color"]'),
    };
  });
  const setOk =
    listenPage.tiles === 3 && listenPage.intro && lyricPage.head === 2 && lyricPage.previews === 1 && !lyricPage.oldListenPreview &&
    lyricPage.segs >= 3 && lyricPage.aligned && !lyricPage.moreOpen && !lyricPage.nativeColor;
  log('设置面板重排', JSON.stringify({ listenPage, lyricPage }));
  await page.evaluate(() => document.querySelector('.sd-panel.sd-right input[type="range"]')?.focus());
  const idleStart = await page.evaluate(() => ({
    panel: !!document.querySelector('.sd-panel.sd-right'),
    focusRange: document.activeElement?.getAttribute('type') === 'range',
  }));
  await page.waitForFunction(() => !!document.querySelector('.app[data-listen]'), null, { timeout: 6000 }).catch(() => {});
  const idleInPanel = await page.evaluate(() => ({
    listening: !!document.querySelector('.app[data-listen]'),
    panelStill: !!document.querySelector('.sd-panel.sd-right'),
  }));
  const idleOk = idleStart.panel && idleInPanel.listening && idleInPanel.panelStill;
  log('设置面板里静止也进入聆听', JSON.stringify({ idleStart, idleInPanel }));

  log('控制台错误数', errors.length);
  if (errors.length) console.log(errors.join('\n'));

  await browser.close();

  const failed =
    !romanOk ||
    !lapseOk ||
    !bigCoverOk ||
    !listenOk ||
    !spaceOk ||
    !lsLayoutOk ||
    stats.total !== 1000 ||
    stats.mounted > MAX_MOUNT ||
    stats.onScreen < 15 ||
    stats.onScreen > MAX_MOUNT ||
    !stats.bounded ||
    !stats.canvas ||
    // 透镜景深：中心的卡片更大、层叠更高；新星云不用模糊滤镜
    nearest.scale - farthest.scale < 0.05 ||
    nearest.z <= farthest.z ||
    stats.blurred > 0 ||
    idleFrameMs > 150 ||
    !hoverState ||
    hoverDeg === null ||
    Math.abs(hoverDeg) > 1 ||
    hoverBlur !== 0 ||
    hoverState.z !== '10000' ||
    hoverState.scale <= hoverTarget.baseScale ||
    beforeDrag.pan.x === afterDrag.pan.x ||
    zoomFloor1 < ZOOM_FLOOR ||
    Math.abs(zoomFloor2 - zoomFloor1) > 0.002 ||
    !inPeriod(wrapA.pan) ||
    wrapA.pan.x < period / 2 ||
    !inPeriod(afterWheel.pan) ||
    wrapA.mounted === 0 ||
    afterWheel.mounted === 0 ||
    importTotal !== 16 ||
    mountedAfterImport < 10 ||
    !playState1.title ||
    !playState1.playing ||
    idAfterNext === idBefore ||
    skippedTo !== 1 ||
    failedCount < 1 ||
    !failedRecovered ||
    qualityItems < 3 ||
    !qualityState.quality ||
    !qualityState.switched ||
    !emptyOk ||
    !edgeHideOk ||
    !panelStays ||
    !shuffleOk ||
    !insertOk ||
    !restorePlay ||
    !seekOk ||
    !volOk ||
    !volUiOk ||
    !z1Ok ||
    !capHazeOk ||
    !idleOk ||
    !setOk ||
    !progSmoothOk ||
    !barLayoutOk ||
    !barNewOk ||
    !localOk.title ||
    !localOk.source ||
    !localOk.audio ||
    errors.length > 0;

  const diagnostics = {
    listenSpace: !listenOk,
    listenLayout: !lsLayoutOk,
    stageNebula: !spaceOk,
    total: stats.total !== 1000,
    mounted: stats.mounted > MAX_MOUNT,
    onScreen: stats.onScreen < 15 || stats.onScreen > MAX_MOUNT,
    stageStructure: !stats.bounded || !stats.canvas,
    lensScale: nearest.scale - farthest.scale < 0.05,
    lensZ: nearest.z <= farthest.z,
    noBlur: stats.blurred > 0,
    idleMs: idleFrameMs > 150,
    hover:
      !hoverState ||
      hoverDeg === null ||
      Math.abs(hoverDeg) > 1 ||
      hoverBlur !== 0 ||
      hoverState.z !== '10000' ||
      hoverState.scale <= hoverTarget.baseScale,
    drag: beforeDrag.pan.x === afterDrag.pan.x,
    zoomFloor: zoomFloor1 < ZOOM_FLOOR || Math.abs(zoomFloor2 - zoomFloor1) > 0.002,
    wrapTorus:
      !inPeriod(wrapA.pan) || wrapA.pan.x < period / 2 || !inPeriod(afterWheel.pan) || wrapA.mounted === 0 || afterWheel.mounted === 0,
    importOk: importTotal !== 16 || mountedAfterImport < 10,
    play: !playState1.title || !playState1.playing,
    nav: idAfterNext === idBefore,
    skip: skippedTo !== 1,
    failedCard: failedCount < 1,
    failedRecover: !failedRecovered,
    qualityMenu: qualityItems < 3 || !qualityState.quality || !qualityState.switched,
    authLapse: !lapseOk,
    bigCover: !bigCoverOk,
    roman: !romanOk,
    firstRunEmpty: !emptyOk,
    edgeHide: !edgeHideOk,
    panelStays: !panelStays,
    shuffle: !shuffleOk,
    insertNext: !insertOk,
    restorePlay: !restorePlay,
    seek: !seekOk,
    volHover: !volOk,
    volSlider: !volUiOk,
    z1Words: !z1Ok,
    captionHaze: !capHazeOk,
    idleInPanel: !idleOk,
    settingsLayout: !setOk,
    progressSmooth: !progSmoothOk,
    barLayout: !barLayoutOk,
    barSpec: !barNewOk,
    localImport: !localOk.title || !localOk.source || !localOk.audio,
    consoleErrors: errors.length > 0,
  };
  const bad = Object.entries(diagnostics).filter(([, v]) => v);
  if (bad.length) {
    console.log('[QA] 未通过项:', bad.map(([k]) => k).join(', '));
  }

  if (failed) {
    console.error('[QA] 存在未通过项');
    process.exit(1);
  }
  console.log('[QA] 全部通过 ✔');
}

main().catch((err) => {
  console.error('[QA] 失败:', err);
  process.exit(1);
});
