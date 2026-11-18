// 汽水扫码登录：二次验证（2046）期间轮询不得重入（#181，验证页一直闪的老问题）。全部离线。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url), api = require('../dist-main/index.cjs');
console.log = console.warn = () => {};
const print = (s) => process.stdout.write(s + '\n');
let n = 0;
const test = async (name, fn) => { await fn(); n++; print('通过 ' + name); };

/** 从 electron/main.cjs 里截出 createQishuiLoginWindow，在沙箱里用假窗口和假定时器运行。 */
function loadWindowFn() {
  const source = fs.readFileSync('electron/main.cjs', 'utf8');
  const start = source.indexOf('function createQishuiLoginWindow(');
  const end = source.indexOf('\nfunction ', start + 10);
  assert.ok(start > 0 && end > start, '找不到 createQishuiLoginWindow');
  let tick = null;
  class Win {
    listeners = {}; webContents = { on() {}, executeJavaScript: async () => {} };
    setTitle() {} loadURL() {} on(k, fn) { this.listeners[k] = fn; } isDestroyed() { return false; }
    close() { this.listeners.closed?.(); }
  }
  const fn = vm.runInNewContext('(' + source.slice(start, end).trim() + ')', {
    BrowserWindow: Win, require, console: { log() {}, warn() {} }, encodeURIComponent,
    setInterval: (cb) => { tick = cb; return 1; }, clearInterval: () => {}, String,
  });
  return { fn, tick: () => tick };
}

await test('二次验证还没完成时，后面几轮轮询都跳过，不再发查询', async () => {
  const { fn, tick } = loadWindowFn();
  let calls = 0, release;
  const pending = new Promise((r) => { release = r; });
  const login = {
    getQrCode: async () => ({ token: 't', scanUrl: 'https://example.invalid/qr' }),
    checkQrConnect: async () => { calls++; await pending; return { _loginOk: true }; },
  };
  const result = fn(null, login);
  await new Promise((r) => setImmediate(r));
  const first = tick()();
  await tick()(); await tick()(); await tick()();
  assert.equal(calls, 1);
  release();
  await first;
  assert.equal((await result).ok, true);
});

await test('上一轮结束后才发下一轮', async () => {
  const { fn, tick } = loadWindowFn();
  let calls = 0;
  const login = {
    getQrCode: async () => ({ token: 't', scanUrl: 'https://example.invalid/qr' }),
    checkQrConnect: async () => { calls++; return calls < 3 ? { status: 'new' } : { _loginOk: true }; },
  };
  const result = fn(null, login);
  await new Promise((r) => setImmediate(r));
  await tick()(); await tick()(); await tick()();
  assert.equal(calls, 3);
  assert.equal((await result).ok, true);
});

await test('QishuiLogin.checkQrConnect 并发调用共用同一次查询', async () => {
  const login = new api.QishuiLogin({ get: () => null }, { BrowserWindow: class {}, session: {} });
  let runs = 0, release;
  const gate = new Promise((r) => { release = r; });
  login.checkQrConnectOnce = async () => { runs++; await gate; return { status: 'new', error_code: 0 }; };
  const a = login.checkQrConnect('t'), b = login.checkQrConnect('t'), c = login.checkQrConnect('t');
  release();
  const [ra, rb, rc] = await Promise.all([a, b, c]);
  assert.equal(runs, 1);
  assert.equal(ra, rb); assert.equal(rb, rc);
  await login.checkQrConnect('t');
  assert.equal(runs, 2);
});

print(`汽水扫码登录回归 ${n}/${n}`);
