// 内嵌页面宿主（electron/embeddedSheet.cjs）：不启动 Electron，用假的视图 / 主窗口 / ipcMain 验证记账逻辑。
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createSheetHost, createWidthFitter, BODY_RADIUS, FIT_MIN_ZOOM } = require('../electron/embeddedSheet.cjs');
const print = (s) => process.stdout.write(s + '\n');
let n = 0;
const test = async (name, fn) => { await fn(); n++; print('通过 ' + name); };

function makeEnv({ withWindow = true } = {}) {
  const sent = [];
  const children = new Set();
  const handlers = {};
  const views = [];
  const win = {
    destroyed: false,
    isDestroyed() { return this.destroyed; },
    listeners: {},
    on(k, fn) { this.listeners[k] = fn; },
    removeListener(k) { delete this.listeners[k]; },
    contentView: { addChildView: (v) => children.add(v), removeChildView: (v) => children.delete(v) },
    webContents: {
      isDestroyed: () => false,
      listeners: {},
      on(k, fn) { this.listeners[k] = fn; },
      removeListener(k) { delete this.listeners[k]; },
      send: (ch, payload) => sent.push([ch, payload]),
    },
  };
  class FakeView {
    constructor(opts) {
      this.opts = opts; this.bounds = null; this.radius = null; this.bg = null;
      this.webContents = {
        closed: false, loaded: [], ua: null, openHandler: null,
        close() { this.closed = true; },
        loadURL(u) { this.loaded.push(u); return Promise.resolve(); },
        setUserAgent(u) { this.ua = u; },
        setWindowOpenHandler(fn) { this.openHandler = fn; },
      };
      views.push(this);
    }
    setBorderRadius(r) { this.radius = r; }
    setBackgroundColor(c) { this.bg = c; }
    setBounds(b) { this.bounds = b; }
  }
  const ipcMain = { on: (ch, fn) => { handlers[ch] = fn; } };
  const host = createSheetHost({ WebContentsView: FakeView, ipcMain, getMainWindow: () => (withWindow ? win : null) });
  const fromRenderer = (ch, payload) => handlers[ch]({ sender: win.webContents }, payload);
  return { host, win, sent, children, views, fromRenderer, FakeView, handlers };
}

await test('打开：新建带独立分区的视图，圆角 14，加载地址，通知渲染进程；位置到达前不挂载', async () => {
  const { host, sent, children, views } = makeEnv();
  const s = host.open({ platform: 'qq', title: '登录 QQ 音乐', partition: 'persist:qq-music-login', url: 'https://y.qq.com/' });
  const v = views[0];
  assert.deepEqual(v.opts.webPreferences, { partition: 'persist:qq-music-login', contextIsolation: true, nodeIntegration: false, sandbox: true });
  assert.equal(v.radius, BODY_RADIUS);
  assert.equal(BODY_RADIUS, 14);
  assert.deepEqual(v.webContents.loaded, ['https://y.qq.com/']);
  assert.deepEqual(sent[0], ['nebula:sheet:open', { id: s.id, platform: 'qq', title: '登录 QQ 音乐', hint: undefined, placeholder: undefined }]);
  assert.equal(children.size, 0);
});

await test('位置到达后取整并挂载；之后只更新位置，不重复挂载；非法位置忽略', async () => {
  const { host, children, views, fromRenderer } = makeEnv();
  const s = host.open({ platform: 'qq', title: 't', partition: 'p', url: 'https://y.qq.com/' });
  fromRenderer('nebula:sheet:bounds', { id: s.id, x: 100.4, y: 80.6, width: 852.2, height: 590.5 });
  assert.deepEqual(views[0].bounds, { x: 100, y: 81, width: 852, height: 591 });
  assert.equal(children.size, 1);
  fromRenderer('nebula:sheet:bounds', { id: s.id, x: 110, y: 90, width: 800, height: 500 });
  assert.deepEqual(views[0].bounds, { x: 110, y: 90, width: 800, height: 500 });
  assert.equal(children.size, 1);
  fromRenderer('nebula:sheet:bounds', { id: s.id, x: 0, y: 0, width: 0, height: 500 });
  fromRenderer('nebula:sheet:bounds', { id: s.id, x: NaN, y: 0, width: 5, height: 5 });
  assert.deepEqual(views[0].bounds, { x: 110, y: 90, width: 800, height: 500 });
  fromRenderer('nebula:sheet:bounds', { id: s.id + 99, x: 1, y: 1, width: 5, height: 5 });
  assert.deepEqual(views[0].bounds, { x: 110, y: 90, width: 800, height: 500 });
});

await test('同一时间只有一个：再开一个把前一个以 superseded 收掉（销毁、摘下，不回发 closed）', async () => {
  const { host, children, views, sent, fromRenderer } = makeEnv();
  const a = host.open({ platform: 'qq', title: 'a', partition: 'p1', url: 'https://a/' });
  fromRenderer('nebula:sheet:bounds', { id: a.id, x: 1, y: 1, width: 10, height: 10 });
  const b = host.open({ platform: 'kuwo', title: 'b', partition: 'p2', url: 'https://b/' });
  assert.equal(await a.closed, 'superseded');
  assert.equal(views[0].webContents.closed, true);
  assert.equal(children.has(views[0]), false);
  assert.equal(host.getCurrent(), b);
  assert.equal(sent.filter(([ch]) => ch === 'nebula:sheet:closed').length, 0);
  assert.equal(sent.filter(([ch]) => ch === 'nebula:sheet:open').length, 2);
  fromRenderer('nebula:sheet:bounds', { id: a.id, x: 5, y: 5, width: 9, height: 9 });
  assert.equal(children.size, 0, '旧页面的位置报告不再生效');
});

await test('用户关闭：渲染进程发 close → 销毁并摘下，closed = user，不回发 closed 通知', async () => {
  const { host, children, views, sent, fromRenderer } = makeEnv();
  const s = host.open({ platform: 'qq', title: 't', partition: 'p', url: 'https://y.qq.com/' });
  fromRenderer('nebula:sheet:bounds', { id: s.id, x: 1, y: 1, width: 10, height: 10 });
  fromRenderer('nebula:sheet:close', { id: s.id });
  assert.equal(await s.closed, 'user');
  assert.equal(views[0].webContents.closed, true);
  assert.equal(children.size, 0);
  assert.equal(host.getCurrent(), null);
  assert.equal(sent.filter(([ch]) => ch === 'nebula:sheet:closed').length, 0);
});

await test('程序关闭（登录成功 done）：销毁并摘下，通知渲染进程收起；重复关闭无副作用', async () => {
  const { host, children, views, sent, fromRenderer } = makeEnv();
  const s = host.open({ platform: 'kuwo', title: 't', partition: 'p', url: 'https://www.kuwo.cn/' });
  fromRenderer('nebula:sheet:bounds', { id: s.id, x: 1, y: 1, width: 10, height: 10 });
  s.close('done');
  s.close('user');
  assert.equal(await s.closed, 'done');
  assert.equal(views[0].webContents.closed, true);
  assert.equal(children.size, 0);
  assert.deepEqual(sent.filter(([ch]) => ch === 'nebula:sheet:closed'), [['nebula:sheet:closed', { id: s.id }]]);
  // 已结束的弹窗再收到渲染进程的消息不生效
  fromRenderer('nebula:sheet:close', { id: s.id });
});

await test('接管已有视图（汽水验证页）：关闭只摘下，不销毁页面；可再次显示', async () => {
  const { host, children, fromRenderer, sent, FakeView } = makeEnv();
  const engine = new FakeView({});
  const s1 = host.open({ platform: 'qishui', title: '汽水音乐安全验证', view: engine, hint: 'h', placeholder: 'p' });
  assert.equal(s1.adopted, true);
  assert.deepEqual(engine.webContents.loaded, [], '接管的页面不重新加载');
  assert.equal(engine.webContents.openHandler, null, '接管的页面不改弹窗处理');
  assert.equal(engine.bg, null);
  fromRenderer('nebula:sheet:bounds', { id: s1.id, x: 1, y: 1, width: 10, height: 10 });
  await s1.shown;
  assert.equal(children.has(engine), true);
  s1.close('done');
  assert.equal(await s1.closed, 'done');
  assert.equal(engine.webContents.closed, false);
  assert.equal(children.has(engine), false);
  const s2 = host.open({ platform: 'qishui', title: '汽水音乐安全验证', view: engine });
  fromRenderer('nebula:sheet:bounds', { id: s2.id, x: 2, y: 2, width: 11, height: 11 });
  assert.equal(children.has(engine), true);
  fromRenderer('nebula:sheet:close', { id: s2.id });
  assert.equal(await s2.closed, 'user');
  assert.equal(engine.webContents.closed, false, '用户关闭也只是摘下');
  assert.equal(children.has(engine), false);
  assert.equal(sent.filter(([ch]) => ch === 'nebula:sheet:open').at(-1)[1].platform, 'qishui');
});

await test('接管 webContents（构造选项）同样不销毁', async () => {
  const { host, views, fromRenderer, FakeView } = makeEnv();
  const wcOwner = new FakeView({});
  const s = host.open({ platform: 'qishui', title: 't', webContents: wcOwner.webContents });
  assert.deepEqual(views.at(-1).opts, { webContents: wcOwner.webContents });
  fromRenderer('nebula:sheet:close', { id: s.id });
  await s.closed;
  assert.equal(wcOwner.webContents.closed, false);
});

await test('登录页里的新窗口请求：http(s) 在同一视图里打开，其余拒绝，一律不另开窗口', async () => {
  const { host, views } = makeEnv();
  host.open({ platform: 'qq', title: 't', partition: 'p', url: 'https://y.qq.com/', userAgent: 'UA/1' });
  const v = views[0];
  assert.equal(v.webContents.ua, 'UA/1');
  assert.deepEqual(v.webContents.openHandler({ url: 'https://graph.qq.com/oauth' }), { action: 'deny' });
  assert.deepEqual(v.webContents.openHandler({ url: 'javascript:alert(1)' }), { action: 'deny' });
  assert.deepEqual(v.webContents.openHandler({ url: 'file:///c:/x' }), { action: 'deny' });
  assert.deepEqual(v.webContents.loaded, ['https://y.qq.com/', 'https://graph.qq.com/oauth']);
});

await test('主窗口被销毁：清理弹窗（closed = window-closed），不再给渲染进程发消息', async () => {
  const { host, win, children, views, sent, fromRenderer } = makeEnv();
  const s = host.open({ platform: 'qq', title: 't', partition: 'p', url: 'https://y.qq.com/' });
  fromRenderer('nebula:sheet:bounds', { id: s.id, x: 1, y: 1, width: 10, height: 10 });
  win.destroyed = true;
  win.listeners.closed();
  assert.equal(await s.closed, 'window-closed');
  assert.equal(views[0].webContents.closed, true);
  void children; // 窗口销毁时子视图随窗口一起没了，不需要也不应该再去摘
  assert.equal(sent.filter(([ch]) => ch === 'nebula:sheet:closed').length, 0);
});

await test('渲染进程刷新 / 跳转：外壳没了，页面一并收掉（closed = reset）', async () => {
  const { host, win, children, fromRenderer } = makeEnv();
  const s = host.open({ platform: 'qq', title: 't', partition: 'p', url: 'https://y.qq.com/' });
  fromRenderer('nebula:sheet:bounds', { id: s.id, x: 1, y: 1, width: 10, height: 10 });
  win.webContents.listeners['did-navigate']();
  assert.equal(await s.closed, 'reset');
  assert.equal(children.size, 0);
});

await test('没有主窗口：不打开，closed 立即 = unavailable', async () => {
  const { host, views } = makeEnv({ withWindow: false });
  const s = host.open({ platform: 'qq', title: 't', partition: 'p', url: 'https://y.qq.com/' });
  assert.equal(await s.closed, 'unavailable');
  await s.shown;
  assert.equal(views.length, 0);
  s.close('done');
});

await test('只认主窗口渲染进程发来的消息（陌生 sender 的位置 / 关闭请求忽略）', async () => {
  const { host, children, handlers } = makeEnv();
  const s = host.open({ platform: 'qq', title: 't', partition: 'p', url: 'https://y.qq.com/' });
  handlers['nebula:sheet:bounds']({ sender: {} }, { id: s.id, x: 1, y: 1, width: 10, height: 10 });
  assert.equal(children.size, 0);
  handlers['nebula:sheet:close']({ sender: {} }, { id: s.id });
  assert.equal(host.getCurrent(), s);
});

// 按宽度适配（#184）：假 webContents，scrollWidth 是页面排版宽度（CSS 像素，不随缩放变），clientWidth = 视口宽 / 缩放
function fakeWc({ designWidth, viewWidth, scrollbar = 0 }) {
  const wc = {
    zoom: 1, viewWidth, designWidth, listeners: {}, destroyed: false,
    isDestroyed() { return this.destroyed; },
    on(k, fn) { this.listeners[k] = fn; }, removeListener(k) { delete this.listeners[k]; },
    getZoomFactor() { return this.zoom; }, setZoomFactor(z) { this.zoom = z; },
    async executeJavaScript() {
      const cw = Math.floor(this.viewWidth / this.zoom) - scrollbar;
      return { sw: Math.max(this.designWidth, cw), cw };
    },
  };
  return wc;
}
const settle = () => new Promise((r) => setTimeout(r, 1950));

await test('按宽度适配：页面比正文区宽就整页缩小到刚好放下；变宽放大回去，最多 100%；关闭恢复原缩放', async () => {
  const wc = fakeWc({ designWidth: 1200, viewWidth: 900 });
  const f = createWidthFitter(wc);
  f.schedule(); await settle();
  assert.ok(Math.abs(wc.zoom - 0.75) < 0.011, '缩到 900/1200');
  const m = await wc.executeJavaScript(); assert.ok(m.sw <= m.cw + 1, '不再有横向溢出');
  wc.viewWidth = 1056; f.refit(); await settle();
  assert.ok(Math.abs(wc.zoom - 0.88) < 0.011, '窗口变宽跟着放大');
  wc.viewWidth = 1600; f.refit(); await settle();
  assert.equal(wc.zoom, 1, '放得下就不超过 100%');
  wc.viewWidth = 300; f.refit(); await settle();
  assert.equal(wc.zoom, FIT_MIN_ZOOM, '太窄时停在下限');
  // 换页面：清零重量，自适应排版的页面不缩放
  wc.listeners['did-start-navigation']({}, 'https://x', false, true);
  assert.equal(wc.zoom, 1);
  wc.designWidth = 0; wc.viewWidth = 900; wc.listeners['did-finish-load'](); await settle();
  assert.equal(wc.zoom, 1, '本来就放得下的页面不动');
  wc.zoom = 0.6; f.dispose();
  assert.equal(wc.zoom, 1, '关闭时恢复接管前的缩放');
  assert.equal(wc.listeners['did-finish-load'], undefined);
});

await test('按宽度适配：竖向滚动条占的宽度也算进去；没有 executeJavaScript 的视图不出错', async () => {
  const wc = fakeWc({ designWidth: 1200, viewWidth: 900, scrollbar: 17 });
  const f = createWidthFitter(wc);
  f.schedule(); await settle(); f.schedule(); await settle();
  const m = await wc.executeJavaScript(); assert.ok(m.sw <= m.cw + 1, '留出滚动条后不再横向溢出');
  f.dispose();
  const bare = createWidthFitter({ on() {}, removeListener() {} });
  bare.schedule(); bare.dispose();
});

await test('按宽度适配：宽度跟着视口走的页面，缩放中一瞬间的溢出不会让它放不大回去', async () => {
  const wc = fakeWc({ designWidth: 1000, viewWidth: 883 });
  const f = createWidthFitter(wc);
  f.schedule(); await settle();
  assert.ok(wc.zoom < 0.9);
  // 模拟一次假溢出：页面在缩放过程中量到 1211
  wc.designWidth = 1211; f.schedule(); await settle();
  wc.designWidth = 1000; wc.viewWidth = 1056; f.refit(); await settle();
  assert.equal(wc.zoom, 1, '弹窗变宽后回到 100%');
  f.dispose();
});

print(`内嵌页面宿主回归 ${n}/${n}`);
