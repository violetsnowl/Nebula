// 汽水扫码登录：二维码显示在账号面板里（kind 'qr'），二次验证（2046）期间轮询不得重入（#181，验证页一直闪的老问题），
// 验证页经内嵌弹窗显示、弹窗被关就取消验证。全部离线。
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url), api = require('../dist-main/index.cjs');
console.log = console.warn = () => {};
const print = (s) => process.stdout.write(s + '\n');
let n = 0;
const test = async (name, fn) => { await fn(); n++; print('通过 ' + name); };

/** 假弹窗宿主句柄：closed 在 close(reason) 时 resolve；shown 由测试决定何时 resolve。 */
function fakePresent({ shownImmediately = true } = {}) {
  const presented = [];
  let current = null;
  const present = (view, title) => {
    let resolveClosed, resolveShown;
    const closed = new Promise((r) => { resolveClosed = r; });
    const shown = shownImmediately ? Promise.resolve() : new Promise((r) => { resolveShown = r; });
    current = { closed, shown, close: (reason = 'done') => { resolveClosed(reason); resolveShown?.(); } };
    presented.push({ view, title });
    return current;
  };
  return { present, presented, sheet: () => current };
}

/** 不碰网络和 Electron 的 QishuiLogin：签名引擎 / 请求 / 视图都用假的。 */
function makeLogin(present) {
  const login = new api.QishuiLogin({ get: () => null, set() {} }, { WebContentsView: class {}, session: {}, present });
  login.initSignEngine = async () => {};
  login.ensureIdentity = async () => ({ deviceId: '1', installId: '2', computerName: 'pc', verifyPortraitId: 'p' });
  const scripts = [];
  const hooks = { verify: async () => ({ status: true }) };
  login.view = {
    webContents: {
      executeJavaScript: async (js) => {
        scripts.push(js);
        if (js.startsWith('window.__qishuiSecondVerify')) return hooks.verify();
        return undefined;
      },
    },
  };
  return { login, scripts, hooks };
}

await test('适配器是扫码登录（kind qr）：createQr 返回二维码令牌和扫码地址', async () => {
  const adapter = api.createQishuiLoginAdapter({
    getQrCode: async () => ({ qrcode: 'u', token: 'tok', scanUrl: 'https://example.invalid/scan?token=tok' }),
    checkQrConnect: async () => ({ status: 'new', error_code: 0 }),
    getAccount: async () => null,
  });
  assert.equal(adapter.platform, 'qishui');
  assert.equal(adapter.kind, 'qr');
  assert.deepEqual(await adapter.createQr(), { unikey: 'tok', payload: 'https://example.invalid/scan?token=tok' });
});

await test('轮询结果映射：成功 / 已扫码 / 等待扫码；出错不抛异常，只回一句话', async () => {
  const replies = [{ _loginOk: true }, { status: 'scanned' }, { status: 'new' }, new Error('网络断了')];
  const adapter = api.createQishuiLoginAdapter({
    getQrCode: async () => ({ qrcode: '', token: 't', scanUrl: '' }),
    checkQrConnect: async () => { const r = replies.shift(); if (r instanceof Error) throw r; return r; },
    getAccount: async () => null,
  });
  assert.deepEqual(await adapter.pollLogin('t'), { ok: true, message: '汽水音乐登录成功' });
  assert.deepEqual(await adapter.pollLogin('t'), { ok: false, message: '已扫码，请在手机上确认' });
  assert.equal((await adapter.pollLogin('t')).ok, false);
  const failed = await adapter.pollLogin('t');
  assert.equal(failed.ok, false);
  assert.match(failed.message, /网络断了/);
});

await test('二次验证还没完成时，一连串轮询都共用同一次查询，不再重复发起、不再重复弹验证页', async () => {
  const { present, presented } = fakePresent();
  const { login, hooks } = makeLogin(present);
  let requests = 0, release;
  const gate = new Promise((r) => { release = r; });
  login.request = async () => {
    requests++;
    return requests === 1 ? { data: { error_code: 2046, std_verify_flow_id: 'f' } } : { data: { error_code: 0, status: 'new' } };
  };
  hooks.verify = async () => { await gate; return { status: true }; };
  const adapter = api.createQishuiLoginAdapter(login);
  const polls = [adapter.pollLogin('t')];
  await new Promise((r) => setImmediate(r));
  for (let i = 0; i < 4; i++) polls.push(adapter.pollLogin('t'));
  release();
  const results = await Promise.all(polls);
  assert.equal(requests, 2, '一次检查 + 验证后一次重发，仅此而已');
  assert.equal(presented.length, 1, '验证页只弹一次');
  assert.ok(results.every((r) => r.ok === false));
});

await test('上一轮结束后才发下一轮', async () => {
  const { present } = fakePresent();
  const { login } = makeLogin(present);
  let calls = 0;
  login.checkQrConnectOnce = async () => { calls++; return calls < 3 ? { status: 'new', error_code: 0 } : { status: '3', error_code: 0, _loginOk: true }; };
  const adapter = api.createQishuiLoginAdapter(login);
  assert.equal((await adapter.pollLogin('t')).ok, false);
  assert.equal((await adapter.pollLogin('t')).ok, false);
  assert.equal((await adapter.pollLogin('t')).ok, true);
  assert.equal(calls, 3);
});

await test('QishuiLogin.checkQrConnect 并发调用共用同一次查询', async () => {
  const login = new api.QishuiLogin({ get: () => null }, { WebContentsView: class {}, session: {}, present: () => null });
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

await test('2046：验证页经内嵌弹窗显示，验证通过后收起弹窗（原因 done），页面本身不销毁', async () => {
  const { present, presented, sheet } = fakePresent();
  const { login, scripts } = makeLogin(present);
  let requests = 0;
  login.request = async () => (++requests === 1 ? { data: { error_code: 2046, std_verify_flow_id: 'f' } } : { data: { error_code: 0, status: 'new' } });
  const view = login.view;
  const data = await login.checkQrConnect('t');
  assert.equal(data.status, 'new');
  assert.equal(presented.length, 1);
  assert.equal(presented[0].view, view);
  assert.equal(presented[0].title, '汽水音乐安全验证');
  assert.equal(await sheet().closed, 'done');
  assert.ok(scripts.some((s) => s.startsWith('window.__qishuiSecondVerify')));
  assert.ok(!scripts.some((s) => s.includes('__qishuiCancelSecondVerify')));
  assert.equal(login.view, view);
});

await test('2046：验证页弹出前用户就关了弹窗 → 取消验证、不开始验证、本轮失败', async () => {
  const { present, sheet } = fakePresent({ shownImmediately: false });
  const { login, scripts } = makeLogin(present);
  login.request = async () => ({ data: { error_code: 2046, std_verify_flow_id: 'f' } });
  const pending = login.checkQrConnect('t');
  await new Promise((r) => setImmediate(r));
  sheet().close('user');
  await assert.rejects(pending, /二次验证未完成/);
  assert.ok(scripts.some((s) => s.includes('__qishuiCancelSecondVerify')));
  assert.ok(!scripts.some((s) => s.startsWith('window.__qishuiSecondVerify')));
});

await test('2046：验证进行中用户关掉弹窗 → 跑取消脚本，验证页收尾，本轮失败', async () => {
  const { present, sheet } = fakePresent();
  const { login, scripts, hooks } = makeLogin(present);
  login.request = async () => ({ data: { error_code: 2046, std_verify_flow_id: 'f' } });
  let cancelVerify;
  hooks.verify = () => new Promise((r) => { cancelVerify = () => r({ status: false, message: '已取消' }); });
  const pending = login.checkQrConnect('t');
  await new Promise((r) => setTimeout(r, 20));
  sheet().close('user');
  await new Promise((r) => setImmediate(r));
  assert.ok(scripts.some((s) => s.includes('__qishuiCancelSecondVerify')));
  cancelVerify();
  await assert.rejects(pending, /已取消/);
});

await test('getAccount 会员：my_info.is_vip / vip_stage 映射到 isVip / isSvip / vipType（假数据）', async () => {
  const realFetch = globalThis.fetch;
  const accountFor = async (myInfo) => {
    globalThis.fetch = async () => ({ json: async () => ({ my_info: { id: '9', nickname: '假昵称', ...myInfo } }) });
    const store = { get: () => ({ cookies: 'sessionid=fixture' }), set() {} };
    const login = new api.QishuiLogin(store, { WebContentsView: class {}, session: {}, present: () => null });
    return login.getAccount();
  };
  try {
    const free = await accountFor({ is_vip: false, vip_stage: 'free' });
    assert.deepEqual([free.isVip, free.isSvip, free.vipType, free.nickname], [false, false, 0, '假昵称']);
    const vip = await accountFor({ is_vip: true, vip_stage: 'vip' });
    assert.deepEqual([vip.isVip, vip.isSvip, vip.vipType], [true, false, 1]);
    const byStage = await accountFor({ is_vip: false, vip_stage: 'paid' });
    assert.deepEqual([byStage.isVip, byStage.isSvip, byStage.vipType], [true, false, 1]);
    const svip = await accountFor({ is_vip: true, vip_stage: 'svip' });
    assert.deepEqual([svip.isVip, svip.isSvip, svip.vipType], [true, true, 2]);
    const none = await accountFor({});
    assert.deepEqual([none.isVip, none.isSvip, none.vipType], [false, false, 0]);
    globalThis.fetch = async () => { throw new Error('断网'); };
    const store = { get: () => ({ cookies: 'sessionid=fixture' }), set() {} };
    const offline = await new api.QishuiLogin(store, { WebContentsView: class {}, session: {}, present: () => null }).getAccount();
    assert.deepEqual([offline.loggedIn, offline.isVip, offline.vipType], [true, false, 0]);
  } finally {
    globalThis.fetch = realFetch;
  }
});

await test('getAccount 登录态核验（#230）：票据失效 → expired；断网 → 仍算登录（unknown）；正常 → valid', async () => {
  const realFetch = globalThis.fetch;
  const accountFor = async (reply) => {
    globalThis.fetch = reply;
    const store = { get: () => ({ cookies: 'sessionid=fixture; uid_v2=42' }), set() {} };
    return new api.QishuiLogin(store, { WebContentsView: class {}, session: {}, present: () => null }).getAccount();
  };
  try {
    // 实测形状：HTTP 200 + status_code 1000016 + 没有 my_info
    const expired = await accountFor(async () => ({
      json: async () => ({ status_code: 1000016, status_info: { status_msg: '登录状态已失效，请重新登录' } }),
    }));
    assert.deepEqual([expired.loggedIn, expired.authStatus, expired.error], [false, 'expired', '汽水登录已过期，请重新登录']);

    const valid = await accountFor(async () => ({
      json: async () => ({ status_code: 0, my_info: { id: '9', nickname: '真用户' } }),
    }));
    assert.deepEqual([valid.loggedIn, valid.authStatus, valid.nickname], [true, 'valid', '真用户']);

    // 有 my_info 时不因为别的 status_code 误判过期
    const withInfo = await accountFor(async () => ({
      json: async () => ({ status_code: 1000016, my_info: { id: '9', nickname: '仍在' } }),
    }));
    assert.equal(withInfo.loggedIn, true);
    assert.equal(withInfo.authStatus, 'valid');

    // 断网 / 超时：不能因为网络问题把用户登出
    const offline = await accountFor(async () => { throw new Error('断网'); });
    assert.deepEqual([offline.loggedIn, offline.authStatus], [true, 'unknown']);

    // 返回 null（解析不出东西）时也算未知，不判过期
    const empty = await accountFor(async () => ({ json: async () => null }));
    assert.equal(empty.loggedIn, true);
    assert.equal(empty.authStatus, 'unknown');
  } finally {
    globalThis.fetch = realFetch;
  }
});

print(`汽水扫码登录回归 ${n}/${n}`);