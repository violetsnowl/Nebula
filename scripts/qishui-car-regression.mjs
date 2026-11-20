// 汽水车机协议回归：抖音扫码授权 + 未加密取链。全部离线（假 fetch，编造的票据和数据），不碰真实账号。
// 覆盖：固定参数 / 设备 ID / 有效期换算、证书请求和票据签名（用公钥验签）、二维码各状态、授权落盘到独立条目、
// 状态与续期、取链映射（整曲 / 试听 / 加密 / 域名白名单 / 令牌过期重试）、无票据返回 null 且不发请求、失败不抛、适配器与 IPC 接线。
// 依赖 pnpm build:main 产物。
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const require = createRequire(import.meta.url), api = require('../dist-main/index.cjs');
console.log = console.warn = () => {};
const print = (s) => process.stdout.write(s + '\n');
let n = 0;
const test = async (name, fn) => { await fn(); n++; print('通过 ' + name); };
const { CookieStore, QishuiCar, createAdapters, createQishuiCarLogin, registerIpcHandlers, carParams, carQrParams, createCarDeviceId, createCarGuard, carGuardHeaders, readCarGuard, carCredentialExpiry, isCarMediaUrl, pickCarAudio } = api;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qishui-car-regression-'));
let seq = 0;
const newStore = () => new CookieStore(path.join(tmp, `c${++seq}.json`));
const NOW = 1_800_000_000_000;
const MEDIA = 'https://v3-dy-o.zjcdn.com/audio/abc.mp3?x=1';
const resp = (data, headers = {}, status = 200) => ({ ok: status < 200 || status >= 300 ? false : true, status, headers: { get: (k) => headers[k.toLowerCase()] ?? null }, json: async () => data });

/** 假车机服务：按路径路由，记录每次请求。handlers 里的函数可以覆盖默认行为。 */
function fakeServer(overrides = {}) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    const u = new URL(url);
    const call = { url, path: u.pathname, query: u.searchParams, init, body: init.body ? (init.headers['content-type'] === 'application/json' ? JSON.parse(init.body) : Object.fromEntries(new URLSearchParams(init.body))) : undefined };
    calls.push(call);
    const handler = overrides[u.pathname] ?? defaults[u.pathname];
    if (!handler) throw new Error('unexpected ' + u.pathname);
    return handler(call, calls);
  };
  return { fetch, calls, count: (p) => calls.filter((c) => c.path === p).length };
}
const guardHeader = (ticket = 'T-' + 'x'.repeat(8)) => ({ 'bd-ticket-guard-server-data': Buffer.from(JSON.stringify({ ticket, ts_sign: 'ts-sign-fake', client_cert: '-----BEGIN CERTIFICATE-----\nZmFrZQ==\n-----END CERTIFICATE-----\n' })).toString('base64') });
const defaults = {
  '/oauth/get_qrcode/': () => resp({ data: { token: 'qr-token-fake', qrcode: Buffer.from('PNGFAKE').toString('base64') } }),
  '/oauth/check_qrcode/': () => resp({ data: { status: 'new' } }),
  '/api/luna/v1/platform/access/code/get/': () => resp({ data: { access_code: 'AC1', open_id: 'OPEN1', expires_time: NOW / 1000 + 86400 } }),
  '/api/luna/v1/platform/access/code/refresh/': () => resp({ data: { access_code: 'AC2', open_id: 'OPEN1', expires_time: NOW / 1000 + 2 * 86400 } }),
  '/passport/open/get_access_ticket/': () => resp({ message: 'success' }, guardHeader()),
  '/api/luna/v1/platform/me/info/': () => resp({ data: { my_info: { id: '9001', nickname: '测试用户', medium_avatar_url: 'https://example.invalid/a.jpg', is_vip: true } } }),
  '/api/luna/v1/platform/client/token/get/': () => resp({ client_token: 'client-token-fake' }),
  '/api/luna/v1/platform/media/mget/': (call) => resp({ data: { media_list: [{ media_id: call.body.media_list[0].id, track_entity: trackEntity() }] } }),
};
function trackEntity({ full, preview, encrypted = false } = {}) {
  const model = (items) => JSON.stringify({ video_list: items });
  const item = (quality, bitrate, extra = {}) => ({ main_url: MEDIA.replace('abc', quality), video_meta: { quality, bitrate }, ...extra });
  const full0 = full ?? { video_model: model([item('medium', 128000), item('higher', 192000)]), expire_at: String(NOW / 1000 + 3600) };
  return { base_info: { id: '700' }, player_info: { full: { video_model_info: full0 }, ...(preview ? { preview: { video_model_info: preview } } : {}) } };
}

/** 走一遍完整扫码授权，返回已授权的 car 和它的假服务器。 */
async function authorized(overrides = {}, clock = { t: NOW }) {
  const store = newStore();
  const server = fakeServer(overrides);
  const car = new QishuiCar(store, { fetch: server.fetch, now: () => clock.t });
  const qr = await car.createQr();
  const poll = await car.pollQr(qr.key);
  assert.equal(poll.state, 'confirmed', JSON.stringify(poll));
  return { car, store, server, clock };
}

await test('固定参数：扫码参数、app_identity、设备 ID、通用查询参数', () => {
  const q = carQrParams();
  assert.equal(q.aid, '1128');
  assert.equal(q.client_key, 'aw4bbxfujo741d09');
  assert.equal(q.app_identity, '82a0737a3f8d93d9958c8a7938bbc365'); // md5('com.luna.music.car')
  assert.equal(q.signature, 'cf9024ea72d9c71813238b13ea107a3d');
  assert.equal(q.jump_type, 'native');
  assert.match(q.scope, /luna\.openapi\.platform\.me_tab/);
  // 设备 ID：19 位数字，范围固定；同一随机输入得到同一结果
  assert.equal(createCarDeviceId(() => Buffer.alloc(8, 0)), '1000000000000000000');
  assert.match(createCarDeviceId(), /^\d{19}$/);
  const p = carParams('1234567890123456789', NOW, 4242);
  assert.equal(p.get('device_id'), '1234567890123456789');
  assert.equal(p.get('did'), '1234567890123456789');
  assert.equal(p.get('iid'), '1234567890123456789');
  assert.equal(p.get('vehicle_id'), 'qishui-1234567890123456789');
  assert.equal(p.get('_timestamp'), String(NOW / 1000));
  assert.equal(p.get('_nonce'), '4242');
  assert.equal(p.get('aid'), '765213');
  assert.equal(p.get('app_name'), 'byte_autoservice_lite');
  assert.equal(p.get('version_name'), '1.0.10');
});

await test('授权有效期换算：毫秒 / 秒时间戳 / 剩余秒数 / 缺省 6 小时；已过期拒绝', () => {
  assert.equal(carCredentialExpiry(NOW + 5000, NOW), NOW + 5000);
  assert.equal(carCredentialExpiry(String(NOW / 1000 + 100), NOW), NOW + 100_000);
  assert.equal(carCredentialExpiry(7200, NOW), NOW + 7_200_000);
  assert.equal(carCredentialExpiry(undefined, NOW), NOW + 6 * 3_600_000);
  assert.throws(() => carCredentialExpiry(NOW / 1000 - 10, NOW), /有效期/);
});

await test('证书请求：PEM 外包一层 base64；主体 CN=bd-ticket-guard；签名能用同一把私钥的公钥验过', () => {
  const guard = createCarGuard();
  assert.match(guard.guardKey, /BEGIN PRIVATE KEY/);
  const pem = Buffer.from(guard.csr, 'base64').toString();
  assert.match(pem, /^-----BEGIN CERTIFICATE REQUEST-----\n/);
  const body = Buffer.from(pem.replace(/-----[A-Z ]+-----|\s/g, ''), 'base64');
  // 手工解 DER：SEQ { info SEQ, alg SEQ, BIT STRING }
  const readLen = (b, o) => { const x = b[o]; return x < 128 ? [x, 1] : [b.readUIntBE(o + 1, x & 127), 1 + (x & 127)]; };
  const take = (b, o) => { const [len, used] = readLen(b, o + 1); return { start: o, hdr: 1 + used, len, end: o + 1 + used + len }; };
  const outer = take(body, 0);
  assert.equal(body[0], 0x30);
  const info = take(body, outer.start + outer.hdr);
  const alg = take(body, info.end);
  const sig = take(body, alg.end);
  assert.equal(body[sig.start], 3);
  assert.equal(sig.end, body.length);
  assert.ok(body.subarray(info.start, info.end).includes(Buffer.from('bd-ticket-guard')));
  const pub = crypto.createPublicKey(guard.guardKey);
  assert.ok(crypto.verify('sha256', body.subarray(info.start, info.end), pub, body.subarray(sig.start + sig.hdr + 1, sig.end)));
  assert.notEqual(createCarGuard().guardKey, guard.guardKey); // 每次授权新密钥
});

await test('票据签名头：req_content 固定三项，req_sign 是对 ticket/path/timestamp 的 ECDSA 签名，可验', () => {
  const { guardKey } = createCarGuard();
  const cred = { ticket: 'TICKET-FAKE', guardKey, guardCert: 'CERT-FAKE', guardTsSign: 'TS-FAKE' };
  const h = carGuardHeaders(cred, '/me/info/', NOW);
  assert.equal(h['access-token'], 'TICKET-FAKE');
  assert.equal(h['bd-ticket-guard-version'], '1');
  assert.equal(h['bd-ticket-guard-client-cert'], 'CERT-FAKE');
  const data = JSON.parse(Buffer.from(h['bd-ticket-guard-client-data'], 'base64').toString());
  assert.deepEqual([data.ts_sign, data.req_content, data.timestamp], ['TS-FAKE', 'ticket,path,timestamp', NOW / 1000]);
  const signed = Buffer.from(`ticket=TICKET-FAKE&path=/api/luna/v1/platform/me/info/&timestamp=${NOW / 1000}`);
  assert.ok(crypto.verify('sha256', signed, crypto.createPublicKey(guardKey), Buffer.from(data.req_sign, 'base64')));
  assert.throws(() => carGuardHeaders({ ...cred, ticket: '' }, '/x/'), /票据/);
  const rsa = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' });
  assert.throws(() => carGuardHeaders({ ...cred, guardKey: rsa }, '/x/'), /密钥/);
});

await test('换票据响应头：base64 JSON 解出票据；PEM 证书转 base64；缺字段 / 非法拒绝', () => {
  const g = readCarGuard(guardHeader('TK')['bd-ticket-guard-server-data']);
  assert.equal(g.ticket, 'TK');
  assert.equal(g.guardTsSign, 'ts-sign-fake');
  assert.match(Buffer.from(g.guardCert, 'base64').toString(), /BEGIN CERTIFICATE/);
  const plain = Buffer.from(JSON.stringify({ ticket: 't', ts_sign: 's', client_cert: 'ALREADYB64' })).toString('base64');
  assert.equal(readCarGuard(plain).guardCert, 'ALREADYB64');
  assert.throws(() => readCarGuard(null), /票据/);
  assert.throws(() => readCarGuard('!!!'), /票据/);
  assert.throws(() => readCarGuard(Buffer.from('{"ticket":"t"}').toString('base64')), /票据/);
});

await test('媒体域名白名单：字节系 https 域名通过；http / 带账号 / 端口 / 陌生域名 / 后缀伪装拒绝', () => {
  assert.ok(isCarMediaUrl('https://v3-dy-o.zjcdn.com/a.mp3'));
  assert.ok(isCarMediaUrl('https://x.douyinvod.com:443/a'));
  for (const bad of ['http://v3.zjcdn.com/a', 'https://u:p@v3.zjcdn.com/a', 'https://v3.zjcdn.com:8443/a', 'https://example.com/a', 'https://evilzjcdn.com/a', 'https://zjcdn.com.evil.com/a', 'not a url', ''])
    assert.equal(isCarMediaUrl(bad), false, bad);
});

await test('二维码各状态：未扫 / 已扫 / 过期 / 拒绝；未知 key 视为过期；本地超时也过期', async () => {
  const states = ['new', 'scanned', 'expired', 'refused'];
  for (const [i, st] of states.entries()) {
    const clock = { t: NOW };
    const car = new QishuiCar(newStore(), { fetch: fakeServer({ '/oauth/check_qrcode/': () => resp({ data: { status: st } }) }).fetch, now: () => clock.t });
    const { key, imageDataUrl, expiresIn } = await car.createQr();
    assert.match(imageDataUrl, /^data:image\/png;base64,/);
    assert.equal(expiresIn, 300);
    const r = await car.pollQr(key);
    assert.deepEqual([r.state, r.final], [['waiting', false], ['scanned', false], ['expired', true], ['refused', true]][i], st);
    // 过期 / 拒绝后 key 作废
    if (r.final) assert.equal((await car.pollQr(key)).state, 'expired');
  }
  const clock = { t: NOW };
  const car = new QishuiCar(newStore(), { fetch: fakeServer().fetch, now: () => clock.t });
  const { key } = await car.createQr();
  assert.equal((await car.pollQr('nope')).state, 'expired');
  clock.t += 301_000;
  assert.deepEqual(await car.pollQr(key).then((r) => [r.state, r.final]), ['expired', true]);
});

await test('二维码请求形状：取码 / 轮询带固定参数和 token，不带票据', async () => {
  const server = fakeServer();
  const car = new QishuiCar(newStore(), { fetch: server.fetch, now: () => NOW });
  const { key } = await car.createQr();
  await car.pollQr(key);
  const [get, check] = server.calls;
  assert.equal(get.init.method, 'GET');
  assert.equal(get.query.get('client_key'), 'aw4bbxfujo741d09');
  assert.equal(get.query.get('signature'), 'cf9024ea72d9c71813238b13ea107a3d');
  assert.equal(get.init.headers['user-agent'], 'LunaOpenSDK/1.0.10');
  assert.equal(get.init.redirect, 'error');
  assert.equal(check.query.get('token'), 'qr-token-fake');
  assert.equal(check.query.get('timestamp'), String(NOW));
  assert.equal(get.init.headers['access-token'], undefined);
});

await test('并发轮询同一个二维码共用一次查询；网络波动回 error（非终态），不抛', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const server = fakeServer({ '/oauth/check_qrcode/': async () => { await gate; return resp({ data: { status: 'new' } }); } });
  const car = new QishuiCar(newStore(), { fetch: server.fetch, now: () => NOW });
  const { key } = await car.createQr();
  const a = car.pollQr(key), b = car.pollQr(key), c = car.pollQr(key);
  release();
  assert.deepEqual((await Promise.all([a, b, c])).map((r) => r.state), ['waiting', 'waiting', 'waiting']);
  assert.equal(server.count('/oauth/check_qrcode/'), 1);
  const down = new QishuiCar(newStore(), { fetch: async (u) => { if (u.includes('check_qrcode')) throw new Error('ECONNRESET token=SECRET'); return defaults['/oauth/get_qrcode/'](); }, now: () => NOW });
  const r = await down.pollQr((await down.createQr()).key);
  assert.deepEqual([r.state, r.final], ['error', false]);
  assert.ok(!JSON.stringify(r).includes('SECRET'));
});

await test('扫码确认：换票据 + 取账号，票据存进独立的 qishui-car 条目，PC 登录条目原样不动', async () => {
  const store = newStore();
  store.set('qishui', 'sessionid=pc-cookie; uid_tt=1', undefined, 'PC 用户');
  const pcBefore = JSON.stringify(store.get('qishui'));
  const server = fakeServer({ '/oauth/check_qrcode/': () => resp({ data: { status: 'confirmed', code: 'AUTH-CODE' } }) });
  const car = new QishuiCar(store, { fetch: server.fetch, now: () => NOW });
  const login = createQishuiCarLogin(car);
  const qr = await login.createCarQr();
  assert.deepEqual([typeof qr.unikey, qr.payload, qr.expiresIn], ['string', '', 300]);
  const r = await login.pollCarQr(qr.unikey);
  assert.deepEqual([r.ok, r.state, r.final], [true, 'confirmed', true]);
  // 请求形状
  const access = server.calls.find((c) => c.path.endsWith('/access/code/get/'));
  assert.equal(access.query.get('auth_code'), 'AUTH-CODE');
  const ticket = server.calls.find((c) => c.path === '/passport/open/get_access_ticket/');
  assert.deepEqual([ticket.body.access_code, ticket.body.open_id], ['AC1', 'OPEN1']);
  assert.equal(ticket.init.headers['bd-ticket-guard-version'], '1');
  assert.ok(ticket.init.headers['bd-ticket-guard-client-csr']);
  assert.equal(ticket.init.headers['bd-ticket-guard-client-cert'], undefined);
  const me = server.calls.find((c) => c.path.endsWith('/me/info/'));
  assert.ok(me.init.headers['bd-ticket-guard-client-data'] && me.init.headers['access-token']);
  // 存储
  const rec = store.get('qishui-car');
  assert.equal(rec.nickname, '测试用户');
  const cred = JSON.parse(rec.cookies);
  assert.deepEqual([cred.v, cred.userId, cred.accessCode, cred.openId, cred.expiresAt, cred.user.isVip], [1, '9001', 'AC1', 'OPEN1', NOW + 86_400_000, true]);
  assert.match(cred.deviceId, /^\d{19}$/);
  assert.match(cred.guardKey, /BEGIN PRIVATE KEY/);
  assert.equal(JSON.stringify(store.get('qishui')), pcBefore);
  // 状态不泄漏票据
  const st = await login.carStatus();
  assert.deepEqual([st.state, st.userId, st.nickname, st.isVip, st.expiresAt], ['authorized', '9001', '测试用户', true, NOW + 86_400_000]);
  assert.ok(!JSON.stringify(st).includes('BEGIN PRIVATE'));
  // 重载后还在（落盘）
  assert.equal(new QishuiCar(new CookieStore(store.filePath), { now: () => NOW }).hasUsableCredential(), true);
  // 退出只清车机条目
  assert.equal(await login.carLogout(), true);
  assert.equal(store.has('qishui-car'), false);
  assert.equal(JSON.stringify(store.get('qishui')), pcBefore);
  assert.equal((await login.carStatus()).state, 'unauthorized');
});

await test('授权后半段出错（换票据 / 取账号失败）是终态，不留半截票据', async () => {
  for (const [name, over] of [
    ['缺授权响应头', { '/passport/open/get_access_ticket/': () => resp({ message: 'success' }) }],
    ['账号接口被拒', { '/api/luna/v1/platform/me/info/': () => resp({ err_no: 28001007 }) }],
    ['账号没有 id', { '/api/luna/v1/platform/me/info/': () => resp({ data: { my_info: {} } }) }],
    ['access_code 缺失', { '/api/luna/v1/platform/access/code/get/': () => resp({ data: {} }) }],
  ]) {
    const store = newStore();
    const car = new QishuiCar(store, { fetch: fakeServer({ '/oauth/check_qrcode/': () => resp({ data: { status: 'confirmed', code: 'C' } }), ...over }).fetch, now: () => NOW });
    const r = await car.pollQr((await car.createQr()).key);
    assert.deepEqual([r.state, r.final], ['error', true], name);
    assert.equal(store.has('qishui-car'), false, name);
  }
});

await test('状态：未授权 / 已授权 / 已过期；坏数据当没有', async () => {
  const store = newStore();
  const clock = { t: NOW };
  const server = fakeServer({ '/oauth/check_qrcode/': () => resp({ data: { status: 'confirmed', code: 'C' } }), '/api/luna/v1/platform/access/code/refresh/': () => resp({ err_no: 28001007 }) });
  const car = new QishuiCar(store, { fetch: server.fetch, now: () => clock.t });
  assert.deepEqual(await car.status(), { state: 'unauthorized' });
  await car.pollQr((await car.createQr()).key);
  assert.equal((await car.status()).state, 'authorized');
  // 到期前一小时内续期；平台明确拒绝 → 失效，状态 expired，保留昵称给界面提示
  clock.t = NOW + 86_400_000 - 1000;
  const expired = await car.status();
  assert.equal(expired.state, 'expired');
  assert.equal(expired.nickname, '测试用户');
  assert.equal(server.count('/api/luna/v1/platform/access/code/refresh/'), 1);
  assert.equal(JSON.parse(store.get('qishui-car').cookies).expiresAt, 0);
  assert.equal((await car.status()).state, 'expired');
  assert.equal(server.count('/api/luna/v1/platform/access/code/refresh/'), 1); // 已被拒的不再打扰平台
  store.set('qishui-car', '{"v":1,"deviceId":"bad"}');
  assert.equal((await car.status()).state, 'unauthorized');
  store.set('qishui-car', 'not json');
  assert.equal((await car.status()).state, 'unauthorized');
});

await test('续期成功：access_code 刷新 + 用已有证书换票据，票据 / 有效期更新，账号不变', async () => {
  const clock = { t: NOW };
  const { car, store, server } = await authorized({ '/oauth/check_qrcode/': () => resp({ data: { status: 'confirmed', code: 'C' } }) }, clock);
  const before = JSON.parse(store.get('qishui-car').cookies);
  clock.t = NOW + 86_400_000 - 600_000;
  const st = await car.status();
  assert.equal(st.state, 'authorized');
  assert.equal(st.expiresAt, NOW + 2 * 86_400_000);
  const refresh = server.calls.find((c) => c.path.endsWith('/access/code/refresh/'));
  assert.equal(refresh.query.get('access_code'), 'AC1');
  const tickets = server.calls.filter((c) => c.path === '/passport/open/get_access_ticket/');
  const renewCall = tickets[tickets.length - 1];
  assert.equal(renewCall.body.access_code, 'AC2');
  assert.ok(renewCall.init.headers['bd-ticket-guard-client-cert']);
  assert.equal(renewCall.init.headers['bd-ticket-guard-client-csr'], undefined);
  const after = JSON.parse(store.get('qishui-car').cookies);
  assert.equal(after.accessCode, 'AC2');
  assert.equal(after.guardKey, before.guardKey);
  assert.equal(after.deviceId, before.deviceId);
});

await test('续期遇网络故障：授权保留（仍在有效期内就仍是已授权），1 分钟内不重复请求', async () => {
  const clock = { t: NOW };
  const { car, store, server } = await authorized({
    '/oauth/check_qrcode/': () => resp({ data: { status: 'confirmed', code: 'C' } }),
    '/api/luna/v1/platform/access/code/refresh/': () => { throw new Error('offline'); },
  }, clock);
  clock.t = NOW + 86_400_000 - 600_000;
  assert.equal((await car.status()).state, 'authorized');
  assert.equal((await car.status()).state, 'authorized');
  assert.equal(server.count('/api/luna/v1/platform/access/code/refresh/'), 1);
  assert.notEqual(JSON.parse(store.get('qishui-car').cookies).expiresAt, 0);
  clock.t += 61_000;
  await car.status();
  assert.equal(server.count('/api/luna/v1/platform/access/code/refresh/'), 2);
});

const confirmedOver = { '/oauth/check_qrcode/': () => resp({ data: { status: 'confirmed', code: 'C' } }) };

await test('取链：整曲未加密 → 映射为 SongUrl（quality / level / expiresAt），请求带客户端令牌和 user_id', async () => {
  const { car, server } = await authorized(confirmedOver);
  const song = await car.fetchCarSongUrl('700', 'standard');
  assert.deepEqual(song, { url: 'https://v3-dy-o.zjcdn.com/audio/medium.mp3?x=1', quality: 'standard', level: 'standard', playable: true, expiresAt: (NOW / 1000 + 3600) * 1000 });
  assert.equal(car.lastFailure, null);
  const tokenCall = server.calls.find((c) => c.path.endsWith('/client/token/get/'));
  assert.equal(tokenCall.query.get('trigger_type'), 'cold_start');
  const mget = server.calls.find((c) => c.path.endsWith('/media/mget/'));
  assert.equal(mget.init.method, 'POST');
  assert.equal(mget.init.headers['access-token'], 'client-token-fake');
  assert.deepEqual(mget.body, { media_list: [{ id: '700', type: 'track' }], card_context: {}, common_params: { user_id: '9001' } });
  // 第二次取链复用令牌
  await car.fetchCarSongUrl('700');
  assert.equal(server.count('/api/luna/v1/platform/client/token/get/'), 1);
});

await test('取链音质选择：不超过请求档位的最高档；请求最高档时取现有最高；加密条目跳过', async () => {
  const full = { video_model: JSON.stringify({ video_list: [
    { main_url: 'https://a.zjcdn.com/std', video_meta: { quality: 'medium', bitrate: 128000 } },
    { main_url: 'https://a.zjcdn.com/hi', video_meta: { quality: 'higher', bitrate: 320000 } },
    { main_url: 'https://a.zjcdn.com/lossless', video_meta: { quality: 'lossless', bitrate: 900000 }, encrypt_info: { encrypt: true } },
    { main_url: 'https://a.zjcdn.com/spade', video_meta: { quality: 'hi_res' }, Encrypt: 1 },
  ] }) };
  const track = trackEntity({ full });
  const none = async () => { throw new Error('no network'); };
  assert.equal((await pickCarAudio(track, 'standard', none)).url, 'https://a.zjcdn.com/std');
  const best = await pickCarAudio(track, 'hires', none);
  assert.deepEqual([best.url, best.quality, best.preview], ['https://a.zjcdn.com/hi', 'high', false]);
  assert.equal(best.expiresAt, undefined);
});

await test('取链：只有试听 → trial；整曲全是加密 → 退到试听；两版都只有加密 → null', async () => {
  const enc = { video_model: JSON.stringify({ video_list: [{ main_url: MEDIA, video_meta: { quality: 'medium' }, encrypt_info: { spade_a: 'x' } }] }) };
  const prev = { video_model: JSON.stringify({ video_list: [{ main_url: 'https://p.zjcdn.com/preview.mp3', video_meta: { quality: 'medium' } }] }) };
  const over = (track) => ({ ...confirmedOver, '/api/luna/v1/platform/media/mget/': () => resp({ data: { media_list: [{ media_id: '700', track_entity: track }] } }) });
  let { car } = await authorized(over(trackEntity({ full: enc, preview: prev })));
  const trial = await car.fetchCarSongUrl('700');
  assert.deepEqual([trial.url, trial.trial, trial.playable], ['https://p.zjcdn.com/preview.mp3', true, true]);
  ({ car } = await authorized(over(trackEntity({ full: enc }))));
  assert.equal(await car.fetchCarSongUrl('700'), null);
  assert.equal(car.lastFailure.code, 'unsupported');
});

await test('取链：video_model 没有时走 url_player_info；域名不在白名单的地址一律不返回', async () => {
  const info = { url_player_info: 'https://vod.douyinvod.com/playinfo?x=1' };
  const server = { ...confirmedOver, '/playinfo': () => resp({ Result: { Data: { PlayInfoList: [
    { MainPlayUrl: 'https://c.douyinvod.com/a.mp3', Quality: 'medium', Bitrate: 128000 },
    { MainPlayUrl: 'https://c.douyinvod.com/enc.mp3', Quality: 'higher', Encrypt: 1 },
  ] } } }), '/api/luna/v1/platform/media/mget/': () => resp({ data: { media_list: [{ media_id: '700', track_entity: trackEntity({ full: info }) }] } }) };
  const a = await authorized(server);
  assert.equal((await a.car.fetchCarSongUrl('700')).url, 'https://c.douyinvod.com/a.mp3');
  const evil = { video_model: JSON.stringify({ video_list: [{ main_url: 'https://evil.example.com/a.mp3', video_meta: { quality: 'medium' } }] }) };
  const b = await authorized({ ...confirmedOver, '/api/luna/v1/platform/media/mget/': () => resp({ data: { media_list: [{ media_id: '700', track_entity: trackEntity({ full: evil, preview: { video_model: evil.video_model } }) }] } }) });
  assert.equal(await b.car.fetchCarSongUrl('700'), null);
  assert.equal(b.car.lastFailure.code, 'invalid-response');
});

await test('取链：客户端令牌过期（28001008）时换新令牌重试一次；仍失败返回 null', async () => {
  let tokens = 0, mgets = 0;
  const over = { ...confirmedOver,
    '/api/luna/v1/platform/client/token/get/': () => resp({ client_token: 'tok-' + (++tokens) }),
    '/api/luna/v1/platform/media/mget/': (call) => { mgets++; return call.init.headers['access-token'] === 'tok-1' ? resp({ err_no: 28001008 }) : resp({ data: { media_list: [{ media_id: '700', track_entity: trackEntity() }] } }); } };
  const { car } = await authorized(over);
  assert.ok((await car.fetchCarSongUrl('700')).url);
  assert.deepEqual([tokens, mgets], [2, 2]);
  const always = await authorized({ ...confirmedOver, '/api/luna/v1/platform/media/mget/': () => resp({ err_no: 28001008 }) });
  assert.equal(await always.car.fetchCarSongUrl('700'), null);
  assert.deepEqual([always.car.lastFailure.code, always.car.lastFailure.upstreamCode], ['auth-required', '28001008']);
});

await test('无票据 / 已过期 / 歌曲 ID 非法：返回 null，不发任何请求；失败不抛', async () => {
  const server = fakeServer();
  const car = new QishuiCar(newStore(), { fetch: server.fetch, now: () => NOW });
  assert.equal(await car.fetchCarSongUrl('700'), null);
  assert.equal(car.lastFailure.code, 'auth-required');
  assert.equal(server.calls.length, 0);
  // 已过期（被拒后 expiresAt=0）
  const a = await authorized(confirmedOver);
  a.store.set('qishui-car', JSON.stringify({ ...JSON.parse(a.store.get('qishui-car').cookies), expiresAt: 0 }));
  const before = a.server.calls.length;
  assert.equal(await a.car.fetchCarSongUrl('700'), null);
  assert.equal(a.server.calls.length, before);
  // 非法 ID
  const b = await authorized(confirmedOver);
  assert.equal(await b.car.fetchCarSongUrl('../x'), null);
  assert.equal(b.car.lastFailure.stage, 'input');
});

await test('取链失败各种形态都不抛：断网 / 非 JSON / HTTP 403 / 429 / 没有这首歌 / 没有播放信息', async () => {
  const cases = [
    ['断网', () => { throw new Error('offline'); }, 'network'],
    ['非 JSON', () => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => { throw new Error('bad'); } }), 'invalid-response'],
    ['403', () => resp({}, {}, 403), 'auth-required'],
    ['429', () => resp({}, {}, 429), 'unavailable'],
    ['500', () => resp({}, {}, 500), 'network'],
    ['没有这首歌', () => resp({ data: { media_list: [] } }), 'not-playable'],
    ['没有播放信息', (call) => resp({ data: { media_list: [{ media_id: call.body.media_list[0].id, track_entity: { base_info: { id: '700' } } }] } }), 'not-playable'],
    ['缺 data', () => resp({}), 'invalid-response'],
  ];
  for (const [name, handler, code] of cases) {
    const { car } = await authorized({ ...confirmedOver, '/api/luna/v1/platform/media/mget/': handler });
    assert.equal(await car.fetchCarSongUrl('700'), null, name);
    assert.equal(car.lastFailure.code, code, name);
    assert.ok(!JSON.stringify(car.lastFailure).includes('http'), name);
  }
});

await test('适配器接线：有车机票据 → fetchSongUrl 返回车机地址；车机取不到 → 直接返回 null 交给兜底，不再试 PC 接口（#212）', async () => {
  const store = newStore();
  const calls = [];
  const http = { requestJson: async (url) => { calls.push(url); return { data: { track: { audio_info: { play_info_list: [{ play_url: 'https://pc.example.invalid/a.mp3', quality: 'standard' }] } } } }; } };
  const adapter = createAdapters(http, store).qishui;
  assert.ok(adapter.car instanceof QishuiCar);
  // 没有车机授权：返回 null，不发任何请求
  assert.equal(await adapter.fetchSongUrl('700'), null);
  assert.equal(calls.length, 0);
  // 有车机票据（直接给车机一个假 fetch）
  adapter.car = (await authorized(confirmedOver)).car;
  const song = await adapter.fetchSongUrl('700', undefined, 'standard');
  assert.equal(song.url, 'https://v3-dy-o.zjcdn.com/audio/medium.mp3?x=1');
  assert.equal(calls.length, 0);
  // 车机取不到、即使有 PC cookie 也不走 PC 接口（按出口 IP 风控，从来没接进播放）
  store.set('qishui', 'sessionid=pc; uid_tt=1');
  adapter.car = { fetchCarSongUrl: async () => null };
  assert.equal(await adapter.fetchSongUrl('700'), null);
  assert.equal(calls.length, 0);
});

await test('IPC：四个通道已注册，返回 { ok, data }；没有车机授权对象时状态为未授权、取码报错', async () => {
  const handlers = new Map();
  const ipcMain = { handle: (ch, fn) => handlers.set(ch, fn) };
  const call = async (ch, payload) => handlers.get(ch)({}, payload);
  const { car } = await authorized(confirmedOver);
  const deps = { adapters: {}, resolver: {}, lyricService: {}, cookies: newStore(), login: {}, loginAdapters: {}, audioProxy: {}, qishuiCar: createQishuiCarLogin(car) };
  registerIpcHandlers(ipcMain, deps);
  for (const ch of ['qr', 'poll', 'status', 'logout']) assert.ok(handlers.has('nebula:login:qishui-car:' + ch), ch);
  const status = await call('nebula:login:qishui-car:status');
  assert.deepEqual([status.ok, status.data.state, status.data.nickname], [true, 'authorized', '测试用户']);
  const qr = await call('nebula:login:qishui-car:qr');
  assert.deepEqual([qr.ok, typeof qr.data.unikey, qr.data.imageDataUrl.startsWith('data:image/png')], [true, 'string', true]);
  const poll = await call('nebula:login:qishui-car:poll', { unikey: qr.data.unikey });
  assert.deepEqual([poll.ok, poll.data.ok, poll.data.state], [true, true, 'confirmed']);
  assert.equal((await call('nebula:login:qishui-car:logout')).data, true);
  assert.equal((await call('nebula:login:qishui-car:status')).data.state, 'unauthorized');
  // 没挂对象
  const bare = new Map();
  registerIpcHandlers({ handle: (ch, fn) => bare.set(ch, fn) }, { ...deps, qishuiCar: undefined });
  assert.equal((await bare.get('nebula:login:qishui-car:status')({}, {})).data.state, 'unauthorized');
  assert.equal((await bare.get('nebula:login:qishui-car:qr')({}, {})).ok, false);
});

await test('歌词（#216）：曲目信息里的 KRC 原文 + 中文翻译，不需要授权（匿名设备 id）；适配器转成逐字歌词；没有歌词 / 出错返回 null', async () => {
  const krc = ['[1000,2000]<0,500,0>编的<500,500,0>第一<1000,1000,0>句', '[4000,2000]<0,1000,0>编的<1000,1000,0>第二句'].join(String.fromCharCode(10));
  const lyricTrack = (info) => ({ base_info: { id: '700' }, display_info: { lyric_info: info }, player_info: {} });
  const server = fakeServer({ '/api/luna/v1/platform/media/mget/': (call) => resp({ data: { media_list: [{ media_id: call.body.media_list[0].id, track_entity: lyricTrack({ lyric_entity: { type: 'krc', content: krc, lang: 'ZH' }, lang_translations: { 'ZH-HANS-CN': { type: 'lrc', content: ['[00:01.00]译一', '[00:04.00]译二'].join(String.fromCharCode(10)) } } }) }] } }) });
  const car = new QishuiCar(newStore(), { fetch: server.fetch, now: () => NOW });
  const got = await car.fetchCarLyric('700');
  assert.equal(got.type, 'krc');
  assert.ok(got.translation.includes('译一'));
  const mget = server.calls.find((c) => c.path.endsWith('/media/mget/'));
  assert.deepEqual(mget.body.common_params, {}, '没有授权：不带 user_id');
  const adapter = createAdapters({ requestJson: async () => { throw new Error('不该走 SEO'); } }, newStore()).qishui;
  adapter.car = car;
  const lyric = await adapter.fetchLyric('700');
  assert.deepEqual(lyric.lines.map((l) => [l.timeMs, l.text, l.translation]), [[1000, '编的第一句', '译一'], [4000, '编的第二句', '译二']]);
  assert.ok(lyric.yrc, '带逐字');
  assert.equal(lyric.source, 'qishui');
  // 没有歌词、接口出错：null
  const empty = new QishuiCar(newStore(), { fetch: fakeServer({ '/api/luna/v1/platform/media/mget/': (call) => resp({ data: { media_list: [{ media_id: '700', track_entity: lyricTrack(undefined) }] } }) }).fetch, now: () => NOW });
  assert.equal(await empty.fetchCarLyric('700'), null);
  const broken = new QishuiCar(newStore(), { fetch: async () => { throw new Error('boom'); }, now: () => NOW });
  assert.equal(await broken.fetchCarLyric('700'), null);
  assert.equal(await car.fetchCarLyric('abc'), null, '非数字 id 不请求');
  // 有授权时用授权账号
  const { car: authed, server: s2 } = await authorized(confirmedOver);
  await authed.fetchCarLyric('700');
  assert.deepEqual(s2.calls.filter((c) => c.path.endsWith('/media/mget/')).pop().body.common_params, { user_id: '9001' });
});
print(`\n汽水车机协议回归：${n} 项全部通过`);
