import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { AsyncLocalStorage } from 'node:async_hooks';
import { requestScope, throwIfCancelled, withRequestScope } from '../requestScope';

/**
 * 网易云成熟库接入层（@neteasecloudmusicapienhanced/api）。
 *
 * 该库每个 API 模块都是 `async (query, request) => { status, body, cookie }`，
 * 我们直接按函数调用，不启动它的 Express 服务；加密/匿名 token/风控全部由库处理。
 * 启动时只需：1) 确保 os.tmpdir()/anonymous_token 存在；2) 调一次 generateConfig 刷匿名 token。
 */

const PKG = '@neteasecloudmusicapienhanced/api';
const require_ = createRequire(__filename);

interface NcmModuleResult {
  status: number;
  body: Record<string, any>;
  cookie: string[];
}

type NcmModule = (query: Record<string, unknown>, request: unknown) => Promise<NcmModuleResult>;

let bootPromise: Promise<void> | null = null;
const privateLogs = new AsyncLocalStorage<boolean>();
let installed = false;
function installTransport(): void {
  if (installed) return;
  const libraryRequire = createRequire(require_.resolve(`${PKG}/util/request.js`));
  const axios = libraryRequire('axios');
  axios.interceptors.request.use((config: any) => {
    const scope = requestScope();
    if (scope) {
      config.signal = scope.signal;
      config.timeout = Math.max(1, Math.min(config.timeout || Infinity, scope.deadline - Date.now()));
    }
    return config;
  });
  // 上游库会输出带 Cookie 的完整错误对象。只抑制库调用上下文，保留本应用脱敏诊断。
  for (const key of ['log', 'info', 'warn', 'error', 'debug'] as const) {
    const original = console[key].bind(console);
    console[key] = (...args: unknown[]) => { if (!privateLogs.getStore()) original(...args); };
  }
  installed = true;
}

async function bootstrap(): Promise<void> {
  const tokenPath = path.join(os.tmpdir(), 'anonymous_token');
  try {
    if (!fs.existsSync(tokenPath)) fs.writeFileSync(tokenPath, '', 'utf-8');
  } catch {
    /* tmp 不可写时继续，库内部会降级 */
  }
  const generateConfig = require_(`${PKG}/generateConfig.js`) as unknown;
  if (typeof generateConfig === 'function') {
    await (generateConfig as () => Promise<void>)();
  }
}

function ensureBoot(): Promise<void> {
  if (!bootPromise) {
    bootPromise = withRequestScope(5000, bootstrap, { detached: true }).catch(() => {
      bootPromise = null;
    });
  }
  return bootPromise;
}

function loadModule(name: string): NcmModule {
  return require_(`${PKG}/module/${name}.js`) as NcmModule;
}

/** 调用库模块；模块/request 均按需加载（require 自身带缓存）。 */
export async function callNcmModule(
  name: string,
  query: Record<string, unknown>,
): Promise<NcmModuleResult> {
  installTransport();
  return privateLogs.run(true, () => withRequestScope(12000, async () => {
    await ensureBoot();
    throwIfCancelled();
    const fn = loadModule(name);
    const request = require_(`${PKG}/util/request.js`) as unknown;
    return fn(query, request);
  }));
}

/** 便捷：包装成带 [Netease][Action] 日志的调用，抛错统一转为 null 友好信息。 */
export async function callNcmSafe(
  name: string,
  query: Record<string, unknown>,
): Promise<NcmModuleResult | null> {
  try {
    const res = await callNcmModule(name, query);
    if (res.status !== 200) {
      console.warn(`[Netease][${name}] HTTP ${res.status}`);
      return null;
    }
    return res;
  } catch {
    throwIfCancelled();
    console.warn(`[Netease][${name}] 调用失败`);
    return null;
  }
}
