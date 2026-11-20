import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import type { CookieStore } from '../cookieStore';
import type { AccountInfo } from '../types';

const API_BASE = 'https://api.qishui.com';
const AID = '386088';
const APP_VERSION = '3.5.2';
const SDK_VERSION = '2.4.13';
const VERIFY_SDK_VERSION = '1.0.29';
const SECURE_SDK_VERSION = '3.3.5';
const BDMS_VERSION = '1.0.0.41';
const AUTH_PARTITION = 'persist:nebula-qishui-auth';
const OFFICIAL_BDMS_URL =
  'https://lf-headquarters-speed.yhgfb-cn-static.com/obj/rc-client-security/web/stable/1.0.0.41/bdms.js';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) SodaMusic/3.2.1 Chrome/136.0.7103.59 ' +
  'Electron/36.4.0-rs.22.release.main.1 TTElectron/36.4.0-rs.22.release.main.1 Safari/537.36';

/** 解码 cookie 字符串 */
function parseCookieString(raw: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const part of String(raw || '').split(';')) {
    const eq = part.indexOf('=');
    if (eq <= 0) continue;
    result[part.slice(0, eq).trim()] = part.slice(eq + 1).trim();
  }
  return result;
}

/** 构建 cookie 字符串 */
function buildCookieString(obj: Record<string, string>): string {
  return Object.entries(obj).map(([k, v]) => `${k}=${v}`).join('; ');
}

/** 内嵌弹窗句柄（见 electron/embeddedSheet.cjs）。 */
export interface SheetHandle {
  /** 弹窗关闭原因：done = 调用方自己收起；user / superseded / window-closed / reset / unavailable = 被动关闭。 */
  closed: Promise<string>;
  /** 页面已挂到弹窗里（或弹窗已结束）。 */
  shown: Promise<void>;
  close: (reason?: string) => void;
}

export class QishuiLogin {
  /** 签名引擎页面：一个从不主动挂载的 WebContentsView；二次验证（2046）时才经 present 交给主窗口的内嵌弹窗显示。 */
  private view: any = null;
  private authSession: any = null;
  private msToken = '';
  private browserInfo: any = null;
  private initialized = false;
  private lastPassportRequest: { url: string } | null = null;
  private capturedCookies: Record<string, string> = {};
  private assetServer: http.Server | null = null;
  private assetBase = '';
  /** 设备身份：整个登录会话内保持一致，避免服务端认为是不同设备 */
  private identity: { deviceId: string; installId: string; computerName: string; verifyPortraitId: string } | null = null;

  constructor(
    private cookies: CookieStore,
    private electronModules: {
      WebContentsView: any;
      session: any;
      /** 把验证页（签名引擎的视图）显示在主窗口的内嵌弹窗里；返回的句柄在弹窗关闭时 resolve（'done' = 我们自己收起）。 */
      present: (view: any, title: string) => SheetHandle;
    },
  ) {}

  /** 启动本地 HTTP server 托管签名引擎 HTML（必须用 HTTP 而非 file://，否则 XHR cookie 不写入 session） */
  private async startAssetServer(): Promise<void> {
    if (this.assetServer) return;
    const enginePath = path.join(__dirname, '../src/main/login/qishui-sign-engine');
    const mimeTypes: Record<string, string> = {
      '.html': 'text/html',
      '.js': 'application/javascript',
    };
    this.assetServer = http.createServer((req, res) => {
      const urlPath = (req.url || '/').split('?')[0];
      // mcs 埋点代理：Node TLS 转发（Chromium 的 TLS 指纹被抖音风控拒绝，Node/curl 正常）
      if (urlPath === '/mcs-proxy') {
        const url = new URL(req.url || '', 'http://127.0.0.1');
        const target = String(url.searchParams.get('url') || '');
        if (!/^https:\/\/mcs\.zijieapi\.com\//.test(target)) {
          res.writeHead(400);
          res.end('bad proxy target');
          return;
        }
        let body = '';
        req.on('data', (chunk: Buffer) => {
          body += chunk.toString('utf8');
        });
        req.on('end', () => {
          const upstream = https.request(
            target,
            {
              method: 'POST',
              headers: {
                'Content-Type': req.headers['content-type'] || 'application/json',
                'User-Agent': req.headers['user-agent'] || UA,
                Accept: req.headers['accept'] || 'application/json, text/plain, */*',
              },
            },
            (upstreamRes) => {
              let data = '';
              upstreamRes.on('data', (chunk: Buffer) => {
                data += chunk.toString('utf8');
              });
              upstreamRes.on('end', () => {
                const outHeaders: Record<string, string | string[]> = {};
                for (const [k, v] of Object.entries(upstreamRes.headers)) {
                  if (k && v != null) outHeaders[k] = v;
                }
                outHeaders['Access-Control-Allow-Origin'] = '*';
                res.writeHead(upstreamRes.statusCode || 200, outHeaders);
                res.end(data);
              });
            },
          );
          upstream.on('error', () => {
            res.writeHead(502);
            res.end('{}');
          });
          if (body) upstream.write(body);
          upstream.end();
        });
        return;
      }
      const filePath = path.join(enginePath, urlPath === '/' ? 'security_seed.html' : urlPath);
      const ext = path.extname(filePath);
      const contentType = mimeTypes[ext] || 'application/octet-stream';
      try {
        const content = fs.readFileSync(filePath);
        res.writeHead(200, {
          'Content-Type': contentType,
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff',
        });
        res.end(content);
      } catch {
        res.writeHead(404);
        res.end('Not found');
      }
    });
    await new Promise<void>((resolve) => {
      this.assetServer!.listen(0, '127.0.0.1', () => {
        const addr = this.assetServer!.address() as any;
        this.assetBase = `http://127.0.0.1:${addr.port}/`;
        resolve();
      });
    });
  }

  /** 初始化签名引擎（未挂载的 WebContentsView + BDMS SDK） */
  private async initSignEngine(): Promise<void> {
    if (this.initialized) return;

    await this.startAssetServer();
    const { WebContentsView, session } = this.electronModules;
    const ses = session.fromPartition(AUTH_PARTITION);
    this.authSession = ses;

    // sdk-glue 运行时会动态加载官方 bdms.js，重定向到本地资源（离线可用 + 不被风控篡改）
    ses.webRequest.onBeforeRequest({ urls: [OFFICIAL_BDMS_URL] }, (_details: any, callback: any) => {
      callback({ redirectURL: this.assetBase + 'bdms.js' });
    });

    // 安装请求拦截（捕获 BDMS 签名后的 URL）
    ses.webRequest.onBeforeRequest({ urls: ['https://api.qishui.com/passport/*'] }, (details: any, callback: any) => {
      this.lastPassportRequest = { url: details.url };
      callback({ cancel: false });
    });

    // 跨域 XHR 的 CORS 放行 + 捕获 Set-Cookie（无 CORS 头时 XHR 的 Set-Cookie 不会写入 session）
    ses.webRequest.onHeadersReceived(
      {
        urls: [
          'https://api.qishui.com/*',
          'https://*.qishui.com/*',
          'https://*.douyin.com/*',
          'https://*.volcengine.com/*',
          'https://verify.zijieapi.com/*',
          'https://auth.zijieapi.com/*',
          'https://mssdk.bytedance.com/*',
          'https://*.bytedance.com/*',
        ],
      },
      (details: any, callback: any) => {
        const headers: Record<string, string[]> = { ...(details.responseHeaders || {}) };
        headers['Access-Control-Allow-Origin'] = ['*'];
        headers['Access-Control-Allow-Credentials'] = ['true'];
        headers['Access-Control-Expose-Headers'] = ['*'];
        const setCookies: string[] = [];
        for (const key of Object.keys(headers)) {
          if (key.toLowerCase() === 'set-cookie') {
            const val = headers[key];
            if (Array.isArray(val)) setCookies.push(...val);
            else setCookies.push(String(val));
          }
        }
        for (const sc of setCookies) {
          const eq = sc.indexOf('=');
          if (eq <= 0) continue;
          const name = sc.slice(0, eq).trim();
          const value = sc.slice(eq + 1).split(';')[0]!.trim();
          if (name && value) {
            this.capturedCookies[name] = value;
            console.log("[QishuiLogin] 捕获 Set-Cookie:");
          }
        }
        callback({ responseHeaders: headers });
      },
    );

    // 网络诊断：记录验证流程中失败的请求（SSL/连接错误等）
    ses.webRequest.onErrorOccurred({ urls: ['<all_urls>'] }, (details: any) => {
      const err = String(details.error || '');
      if (/ssl|err_|failed/i.test(err)) {
        console.log("[QishuiLogin] 请求错误:");
      }
    });

    // 创建签名引擎视图：不挂到任何窗口（页面照常加载、执行脚本），二次验证时才经 present 显示
    this.view = new WebContentsView({
      webPreferences: {
        partition: AUTH_PARTITION,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: false,
        backgroundThrottling: false,
      },
    });
    this.view.webContents.setUserAgent(UA);

    // 加载签名引擎 HTML（从本地 HTTP server，确保 XHR cookie 写入 session）
    // 1. 加载 seed 页面设置 msToken
    await this.view.webContents.loadURL(this.assetBase + 'security_seed.html');
    let storedToken = await this.view.webContents.executeJavaScript(
      `localStorage.getItem('xmsty') || localStorage.getItem('xmst') || ''`,
      true,
    );
    if (!/^[A-Za-z0-9_-]{118}==$/.test(String(storedToken || ''))) {
      storedToken = crypto.randomBytes(88).toString('base64url') + '==';
    }
    this.msToken = String(storedToken);
    await this.view.webContents.executeJavaScript(
      `localStorage.setItem('xmst', ${JSON.stringify(this.msToken)});
       localStorage.setItem('xmsty', ${JSON.stringify(this.msToken)}); true`,
      true,
    );

    // 2. 加载 host 页面（BDMS SDK）
    await this.view.webContents.loadURL(this.assetBase + 'security_host.html');
    await this.waitForBdms();

    // 3. 获取浏览器指纹
    this.browserInfo = await this.view.webContents.executeJavaScript('window.__qishuiBrowserInfo()', true);
    this.initialized = true;
  }

  /** 等待 BDMS SDK 就绪 */
  private async waitForBdms(timeoutMs = 20000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const status = await this.view!.webContents.executeJavaScript(`({
        glue: window._sdkGlueVersionMap && window._sdkGlueVersionMap.sdkGlueVersion,
        bdms: window._sdkGlueVersionMap && window._sdkGlueVersionMap.bdmsVersion,
        loaded: Boolean(window.bdms),
      })`);
      if (status && status.loaded && status.bdms) return;
      await new Promise(r => setTimeout(r, 100));
    }
    throw new Error('汽水安全组件初始化超时：bdms 未就绪');
  }

  /** 通用 passport 请求（通过签名引擎） */
  private async request(method: string, pathname: string, params: Record<string, any> = {}, data?: Record<string, any>): Promise<any> {
    await this.initSignEngine();
    const identity = await this.ensureIdentity();
    const query: Record<string, any> = { ...this.commonParams(identity), ...params };
    const url = new URL(pathname, API_BASE);
    for (const [name, value] of Object.entries(query)) {
      if (value != null) url.searchParams.set(name, String(value));
    }
    const headers = this.requestHeaders(identity, query.biz_trace_id);
    let body: string | null = null;
    if (data != null) {
      const bodyParams = new URLSearchParams();
      for (const [name, value] of Object.entries(data)) {
        if (value != null) bodyParams.set(name, typeof value === 'object' ? JSON.stringify(value) : String(value));
      }
      body = bodyParams.toString();
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
      headers['x-ss-stub'] = crypto.createHash('md5').update(body).digest('hex').toUpperCase();
    }
    const payload = {
      method: method.toUpperCase(),
      url: url.toString(),
      headers,
      body,
      timeout: 30000,
    };
    const response = await this.view!.webContents.executeJavaScript(
      `window.__qishuiRequest(${JSON.stringify(payload)})`,
      true,
    );
    if (!response || response.status < 200 || response.status >= 400) {
      throw new Error(`汽水登录接口 HTTP ${response?.status || 0}: ${String(response?.body || '').slice(0, 300)}`);
    }
    let envelope: any;
    try {
      envelope = JSON.parse(response.body || '{}');
    } catch {
      throw new Error('汽水登录接口返回了无效 JSON');
    }
    // 验证签名
    const signedUrl = String(this.lastPassportRequest?.url || '');
    let signedQuery: URLSearchParams;
    try {
      signedQuery = new URL(signedUrl).searchParams;
    } catch {
      signedQuery = new URLSearchParams();
    }
    const aBogus = signedQuery.get('a_bogus') || '';
    if (aBogus.length !== 44) {
      throw new Error('汽水安全参数注入失败：a_bogus 缺失');
    }
    const signedMsToken = signedQuery.get('msToken') || '';
    if (signedMsToken && signedMsToken !== this.msToken) {
      // SDK 篡改/替换了 msToken 时尽早暴露（与 Mineradio 行为一致）
      console.warn("[QishuiLogin] 签名后 msToken 与本地不一致（SDK 替换），使用签名 URL 的 msToken");
    }
    // 补充捕获：XHR 响应头的 Set-Cookie 直接并入（onHeadersReceived 可能因 URL 模式漏匹配）
    const setCookies = this.parseSetCookieHeader(String(response.headers || ''));
    if (setCookies.length) {
      console.log("[QishuiLogin] request 响应头 Set-Cookie:");
      for (const c of setCookies) {
        if (c.name && c.value) this.capturedCookies[c.name] = c.value;
      }
    }
    return envelope;
  }

  /** 解析 getAllResponseHeaders 文本中的 Set-Cookie（可能多行，每行独立 cookie）。 */
  private parseSetCookieHeader(raw: string): Array<{ name: string; value: string }> {
    const out: Array<{ name: string; value: string }> = [];
    for (const line of String(raw || '').split(/\r?\n/)) {
      const m = /^set-cookie:\s*(.+)$/i.exec(line.trim());
      if (!m) continue;
      const sc = m[1]!;
      const eq = sc.indexOf('=');
      if (eq <= 0) continue;
      const name = sc.slice(0, eq).trim();
      const value = sc.slice(eq + 1).split(';')[0]!.trim();
      if (name && value) out.push({ name, value });
    }
    return out;
  }

  /** 生成二维码 */
  async getQrCode(): Promise<{ qrcode: string; token: string; scanUrl: string }> {
    await this.initSignEngine();
    const identity = await this.ensureIdentity();
    const envelope = await this.request('GET', '/passport/web/get_qrcode/', {
      next: API_BASE,
      need_logo: 'false',
      need_short_url: 'false',
    });
    const data = envelope.data || {};
    if (envelope.message !== 'success' || Number(data.error_code) !== 0) {
      throw new Error(`二维码生成失败：code=${data.error_code} ${data.description || envelope.message || ''}`);
    }
    const qrcodeIndexUrl = String(data.qrcode_index_url || '');
    const token = new URL(qrcodeIndexUrl).searchParams.get('token') || '';
    // 官方扫码 URL：必须带 os + computer_name，手机确认才能回绑到本 PC 会话
    const scanTarget = new URL('https://bff-pc.qishui.com/light/invoke/scan_login');
    scanTarget.searchParams.set('token', token);
    scanTarget.searchParams.set('os', 'Windows');
    scanTarget.searchParams.set('computer_name', identity.computerName || 'Windows-PC');
    const scanUrl = scanTarget.toString().replace(/\+/g, '%20');
    return { qrcode: scanUrl, token, scanUrl };
  }

  private checking: Promise<{ status: string; error_code: number; session_cookie?: string; _loginOk?: boolean }> | null = null;

  /**
   * 轮询扫码状态。同一时间只有一次在进行，并发的调用共用同一个结果：
   * 二次验证（2046）要等用户在验证页操作，期间再发查询会重新触发验证、把正在用的验证页关掉再弹出（#181）。
   */
  checkQrConnect(
    token: string,
  ): Promise<{ status: string; error_code: number; session_cookie?: string; _loginOk?: boolean }> {
    if (!this.checking) this.checking = this.checkQrConnectOnce(token).finally(() => { this.checking = null; });
    return this.checking;
  }

  private async checkQrConnectOnce(
    token: string,
  ): Promise<{ status: string; error_code: number; session_cookie?: string; _loginOk?: boolean }> {
    await this.initSignEngine();
    const identity = await this.ensureIdentity();
    const body: Record<string, any> = {
      need_logo: 'false',
      need_short_url: 'false',
      is_frontier: 'true',
      token,
      is_new_login: '1',
      next: API_BASE,
    };
    let envelope = await this.request('POST', '/passport/web/check_qrconnect/', {}, body);
    let data = envelope.data || {};

    // 二次验证处理
    if (Number(data.error_code) === 2046) {
      console.log("[QishuiLogin] 2046 二次验证触发，envelope keys:");
      console.log("[QishuiLogin] 2046 envelope(截断):");
      const decision = { ...envelope, ...data };
      // 关键：服务端 flow 已绑定固定 verify_portrait_id（std_verify_flow_id），
      // 必须沿用同一个 portrait_id 继续流程，否则组件报 mulit_verify_exist（已存在验证）
      const serverFlowId =
        String(decision.std_verify_flow_id || decision.biz_params?.std_verify_flow_id || decision.common_params?.std_verify_flow_id || '');
      if (decision.verify_portrait_id) {
        // 保留服务端下发的 portrait_id
      } else if (serverFlowId) {
        decision.verify_portrait_id = serverFlowId;
        // 同步 identity，让后续请求（pack_verify_ways_data 等）使用同一 portrait
        this.identity = { ...identity, verifyPortraitId: serverFlowId };
        await this.view
          ?.webContents.executeJavaScript(
            `localStorage.setItem('nebula_qishui_identity', ${JSON.stringify(JSON.stringify(this.identity))}); true`,
            true,
          )
          .catch(() => {});
      } else {
        decision.verify_portrait_id = identity.verifyPortraitId;
      }
      console.log("[QishuiLogin] 2046 decision 关键字段:");
      
      // 在主窗口的内嵌弹窗里显示验证页：弹窗被关掉（用户关、被别的页面顶替、主窗口没了）就取消这次验证
      const sheet = this.electronModules.present(this.view, '汽水音乐安全验证');
      let dismissed = false;
      void sheet.closed.then((reason) => {
        if (reason === 'done') return;
        dismissed = true;
        this.view?.webContents
          ?.executeJavaScript('window.__qishuiCancelSecondVerify && window.__qishuiCancelSecondVerify()')
          .catch(() => {});
      });
      // 等页面真正挂到弹窗里再开始验证（和原来「先显示窗口再验证」的顺序一致）；渲染进程没响应时 5 秒后照常开始
      let waitTimer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([sheet.shown, new Promise<void>((r) => { waitTimer = setTimeout(r, 5000); })]);
      clearTimeout(waitTimer);

      try {
        if (dismissed) throw new Error('二次验证未完成');
        const verified = await this.view?.webContents.executeJavaScript(
          `window.__qishuiSecondVerify(${JSON.stringify(decision)}, ${JSON.stringify({ generalParams: {
            device_id: identity.deviceId,
            install_id: identity.installId,
            did: identity.deviceId,
            iid: identity.installId,
            device_platform: 'PC',
            version_code: APP_VERSION,
          } })})`,
          true,
        );
        console.log("[QishuiLogin] 二次验证结果:");
        if (!verified || verified.status !== true) {
          throw new Error(verified?.message || '二次验证未完成');
        }
      } catch (err) {
        console.log("[QishuiLogin] 二次验证异常:");
        console.log("[QishuiLogin] security trace(截断):");
        throw err;
      } finally {
        // 摘下验证页（页面本身留着，下次 2046 还要用）
        sheet.close('done');
      }
      // 重新发送请求
      envelope = await this.request('POST', '/passport/web/check_qrconnect/', { isResend: 'true' }, body);
      data = envelope.data || {};
      if (Number(data.error_code) === 2046) {
        throw new Error('二次验证已通过，但服务端仍返回 2046；请重新刷新二维码');
      }
    }

    // 登录成功判定（单一真源）：
    // - error_code 0 且 status 3/confirmed（标准成功）
    // - error_code 2156（token 已消费）必须同时拿到会话凭证才算成功，避免中间态误报
    const hasCredential =
      !!data.session_cookie || Object.keys(this.capturedCookies).some((k) => this.isSessionCookieName(k));
    const isSuccess =
      (Number(data.error_code) === 0 && (String(data.status) === '3' || String(data.status) === 'confirmed')) ||
      (Number(data.error_code) === 2156 && hasCredential);
    console.log("[QishuiLogin] checkQrConnect 判断:");
    if (isSuccess) {
      console.log("[QishuiLogin] 登录成功，收集 cookie");
      // 直接从 session 收集 cookie（不导航，避免 session 重置）
      await this.persistSessionCookies(data.session_cookie || '', envelope);
      data._loginOk = true;
    } else {
      console.log("[QishuiLogin] checkQrConnect 未判定成功，完整 envelope:");
    }
    console.log("[QishuiLogin] checkQrConnect 返回:");
    return data;
  }

  /** 判断是否会话凭证类 cookie（排除 csrf/匿名/区域类）。 */
  private isSessionCookieName(name: string): boolean {
    return (
      !/csrf|anonymous|reg-store|anonymous_token/i.test(name) &&
      /^(uid|session|sid|passport_|tt_|s_v_web_id|store-id|odin_tt|sid_guard|uid_tt|uid_v2|sessionid)/i.test(name)
    );
  }

  /** 持久化会话 cookie */
  private async persistSessionCookies(sessionCookie: string, extra?: any): Promise<void> {
    console.log("[QishuiLogin] persistSessionCookies 收到 session_cookie 长度:");
    const current = parseCookieString(this.cookies.get('qishui')?.cookies || '');
    // 合并 API 返回的 session_cookie
    const newCookies = parseCookieString(sessionCookie);
    console.log("[QishuiLogin] session_cookie 包含字段:");
    Object.assign(current, newCookies);

    // 兜底：扫描 envelope 深层字段中的 "name=value; ..." 形状字符串（凭证可能在 data 的其它字段）
    if (extra != null) {
      const scan = new Set<string>();
      const walk = (node: unknown): void => {
        if (!node || typeof node !== 'object') return;
        for (const v of Object.values(node as Record<string, unknown>)) {
          if (typeof v === 'string') {
            if (/^[\w.-]+=[^;]+(?:;\s*[\w.-]+=[^;]+)*$/.test(v.trim())) {
              const parsed = parseCookieString(v);
              for (const [k, val] of Object.entries(parsed)) {
                if (val && this.isSessionCookieName(k)) {
                  scan.add(`${k}=${val}`);
                }
              }
            }
          } else if (v && typeof v === 'object') {
            walk(v);
          }
        }
      };
      walk(extra);
      if (scan.size) {
        console.log("[QishuiLogin] envelope 深层扫描到凭证字段:");
        for (const kv of scan) {
          const eq = kv.indexOf('=');
          current[kv.slice(0, eq)] = kv.slice(eq + 1);
        }
      }
    }

    // 方案A核心：合并通过 onHeadersReceived 手动拦截到的 Set-Cookie 凭证（最关键）
    const capturedEntries = Object.entries(this.capturedCookies);
    if (capturedEntries.length) {
      console.log("[QishuiLogin] 合并 capturedCookies:");
      for (const [k, v] of capturedEntries) {
        if (v) current[k] = v;
      }
    } else {
      console.log("[QishuiLogin] capturedCookies 为空，未拦截到 Set-Cookie");
    }

    // 从 authSession 补充收集（capturedCookies 优先，session 起补充作用）
    if (this.authSession) {
      const sessionCookies = await this.authSession.cookies.get({});
      console.log("[QishuiLogin] authSession cookies 总数:");
      console.log("[QishuiLogin] authSession cookie 字段:");
      for (const cookie of sessionCookies) {
        if (this.isSessionCookieName(cookie.name)) {
          if (!current[cookie.name]) {
            current[cookie.name] = cookie.value;
            console.log("[QishuiLogin] 收集 authSession cookie:");
          }
        } else {
          console.log("[QishuiLogin] 跳过非凭证 cookie:");
        }
      }
    }

    const cookieStr = buildCookieString(current);
    console.log("[QishuiLogin] 最终 cookie 长度:");
    this.cookies.set('qishui', cookieStr, this.msToken, '汽水音乐');
    // 清空拦截缓存，避免下次登录混入旧凭证
    this.capturedCookies = {};
  }

  /** 获取账号信息 */
  async getAccount(): Promise<AccountInfo | null> {
    const rec = this.cookies.get('qishui');
    if (!rec?.cookies) {
      console.log("[QishuiLogin] getAccount: 无 cookie 记录");
      return null;
    }
    const cookie = rec.cookies;
    console.log("[QishuiLogin] getAccount: cookie 长度:");

    // 提取用户信息（汽水/抖音系凭证常见 uid_v2 / sessionid / sid_guard / uid_tt）
    const sidGuard = this.extractCookieValue(cookie, 'sid_guard');
    const userId =
      this.extractCookieValue(cookie, 'uid_v2') ||
      this.extractCookieValue(cookie, 'sessionid') ||
      this.extractCookieValue(cookie, 'uid') ||
      (sidGuard.split('|')[0] || '') ||
      this.extractCookieValue(cookie, 'uid_tt') ||
      '';
    console.log("[QishuiLogin] getAccount: uid_v2=");
    if (!userId) {
      console.log("[QishuiLogin] getAccount: 未找到登录态字段（uid_v2/sessionid/uid/sid_guard/uid_tt），返回 null");
      return null;
    }

    // 尝试从 API 获取昵称
    let nickname = '';
    let avatar = '';
    let apiUserId = '';
    let isVip = false;
    let isSvip = false;
    try {
      const me = await this.fetchMeInfo(cookie);
      console.log("[QishuiLogin] getAccount: fetchMeInfo 返回:");
      if (me) {
        nickname = me.nickname || '';
        avatar = me.avatar || '';
        apiUserId = me.id || '';
        isVip = !!me.isVip;
        isSvip = !!me.isSvip;
      }
    } catch (err) {
      console.log("[QishuiLogin] getAccount: fetchMeInfo 异常:");
    }

    return {
      loggedIn: true,
      userId: apiUserId || userId,
      nickname: nickname || '汽水用户',
      avatarUrl: avatar,
      vipType: isSvip ? 2 : isVip ? 1 : 0,
      isVip,
      isSvip,
    };
  }

  /** 调用 /luna/pc/me 获取账号信息 */
  private async fetchMeInfo(cookie: string): Promise<{ nickname?: string; avatar?: string; id?: string; isVip?: boolean; isSvip?: boolean } | null> {
    try {
      const params = this.pcAppParams();
      const qs = Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
      const url = `https://api.qishui.com/luna/pc/me?${qs}`;
      const res = await fetch(url, {
        headers: {
          'Accept': 'application/json,text/plain,*/*',
          'User-Agent': 'LunaPC/3.3.0(359450208)',
          'x-luna-background-type': 'foreground',
          'x-luna-is-background-req': '0',
          'x-luna-is-local-user': '1',
          Cookie: cookie,
        },
      });
      const json = await res.json() as any;
      // 实测结构：{ status_info, my_info: { id, nickname, is_vip, vip_stage('free' 为非会员), larger_avatar_url: { urls: [...] } } }
      const data = json?.my_info || json?.data?.my_info || json || {};
      const avatarObj = data.larger_avatar_url || data.avatar_url || data.avatar || {};
      const avatarUrls = avatarObj.urls || avatarObj.url_list || [];
      let avatar = Array.isArray(avatarUrls) ? String(avatarUrls[0] || '') : '';
      const avatarUri = String(avatarObj.uri || '');
      if (avatar && avatarUri && !avatar.includes(avatarUri)) avatar += avatarUri;
      if (!avatar && /^https?:\/\//i.test(avatarUri)) avatar = avatarUri;
      // 会员：my_info.is_vip；vip_stage 非 'free' 也算（实测非会员为 is_vip=false + vip_stage='free'，会员的取值没见过，只能这样宽松判）。
      const stage = String(data.vip_stage || '').trim().toLowerCase();
      const isSvip = /svip|super/.test(stage);
      const isVip = data.is_vip === true || isSvip || (!!stage && stage !== 'free');
      return {
        id: String(data.id || ''),
        nickname: data.nickname || data.nick_name || data.public_name || '',
        avatar,
        isVip,
        isSvip,
      };
    } catch {
      return null;
    }
  }

  /** PC 公共参数 */
  private pcAppParams(extra: Record<string, any> = {}): Record<string, any> {
    const now = Date.now();
    return {
      aid: AID,
      app_name: 'luna_pc',
      region: 'cn',
      geo_region: 'cn',
      os_region: 'cn',
      device_id: String(now),
      cdid: '',
      iid: String(now + 1),
      version_name: APP_VERSION,
      version_code: '30030000',
      channel: 'official',
      build_mode: 'master',
      network_carrier: '',
      ac: 'wifi',
      tz_name: 'Asia/Shanghai',
      resolution: '',
      device_platform: 'windows',
      device_type: 'Windows',
      os_version: 'Windows 11',
      fp: String(now),
      ...extra,
    };
  }

  /** 清理会话 */
  async clear(): Promise<void> {
    if (this.authSession) {
      await this.authSession.clearStorageData({
        storages: ['cookies', 'localstorage', 'indexdb', 'cachestorage', 'serviceworkers'],
      });
    }
    if (this.view && !this.view.webContents.isDestroyed()) {
      this.view.webContents.close();
    }
    this.view = null;
    this.browserInfo = null;
    this.msToken = '';
    this.initialized = false;
    this.identity = null; // 重置设备身份，下次登录生成新的
    if (this.assetServer) {
      this.assetServer.close();
      this.assetServer = null;
      this.assetBase = '';
    }
  }

  private async ensureIdentity(): Promise<{
    deviceId: string;
    installId: string;
    computerName: string;
    verifyPortraitId: string;
  }> {
    if (this.identity) return this.identity;
    // 跨重启持久化（persist partition 的 localStorage）：身份必须稳定，否则服务端视为新设备并触发风控
    try {
      if (this.view && !this.view.webContents.isDestroyed()) {
        const stored = await this.view.webContents.executeJavaScript(
          `localStorage.getItem('nebula_qishui_identity') || ''`,
          true,
        );
        const parsed = JSON.parse(String(stored || '{}'));
        if (parsed && parsed.deviceId && parsed.installId && parsed.verifyPortraitId) {
          const restored = parsed as {
            deviceId: string;
            installId: string;
            computerName: string;
            verifyPortraitId: string;
          };
          this.identity = restored;
          return restored;
        }
      }
    } catch {
      /* 恢复失败则新建 */
    }
    // 逐位生成数字串，避免 crypto.randomInt 的 max-min 超过 2^48-1 上限
    const randomDigits = (length: number): string => {
      let value = String(crypto.randomInt(1, 10));
      while (value.length < length) value += String(crypto.randomInt(0, 10));
      return value;
    };
    this.identity = {
      deviceId: randomDigits(16),
      installId: randomDigits(15),
      computerName: os.hostname() || 'Windows-PC',
      verifyPortraitId: crypto.randomUUID() + '.login',
    };
    try {
      if (this.view && !this.view.webContents.isDestroyed()) {
        await this.view.webContents.executeJavaScript(
          `localStorage.setItem('nebula_qishui_identity', ${JSON.stringify(JSON.stringify(this.identity))}); true`,
          true,
        );
      }
    } catch {
      /* 持久化失败不阻塞登录 */
    }
    return this.identity;
  }

  private commonParams(identity: any): Record<string, any> {
    return {
      passport_jssdk_version: SDK_VERSION,
      passport_jssdk_type: 'normal',
      is_from_ttaccountsdk: '1',
      aid: AID,
      language: 'zh',
      account_sdk_source: 'web',
      p_js_v: SDK_VERSION,
      p_js_t: 'pro',
      p_zt: SECURE_SDK_VERSION,
      p_ver: VERIFY_SDK_VERSION,
      request_host: 'app%3A%2F%2Fresources',
      p_bd: BDMS_VERSION,
      biz_trace_id: crypto.randomBytes(4).toString('hex'),
      is_new_login: '1',
      is_from_iesaccountsaas: '1',
      device_id: identity.deviceId,
      install_id: identity.installId,
      did: identity.deviceId,
      iid: identity.installId,
      device_platform: 'PC',
      version_code: APP_VERSION,
      account_sdk_source_info: String(this.browserInfo?.encrypted || ''),
      msToken: this.msToken,
    };
  }

  private requestHeaders(identity: any, bizTraceId: string): Record<string, string> {
    const traceId = crypto.randomBytes(16).toString('hex');
    return {
      Accept: 'application/json, text/javascript',
      'User-Agent': UA,
      'x-tt-passport-verify-portrait': identity.verifyPortraitId,
      'x-tt-passport-trace-id': bizTraceId,
      'x-tt-trace-id': `00-${traceId}-${traceId.slice(0, 16)}-01`,
    };
  }

  private extractCookieValue(cookie: string, name: string): string {
    for (const seg of cookie.split(';')) {
      const eq = seg.indexOf('=');
      if (eq <= 0) continue;
      const k = seg.slice(0, eq).trim();
      const v = seg.slice(eq + 1).trim();
      if (k === name) return v;
    }
    return '';
  }
}
