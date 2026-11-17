import { AsyncLocalStorage } from 'node:async_hooks';

export interface RequestScope { signal: AbortSignal; deadline: number; forceRefresh?: boolean }
const storage = new AsyncLocalStorage<RequestScope>();
export const requestScope = (): RequestScope | undefined => storage.getStore();
export class RequestCancelled extends Error {
  constructor(readonly code: 'TIMEOUT' | 'CANCELLED') { super(code); this.name = 'RequestCancelled'; }
}
export function throwIfCancelled(): void {
  const s = requestScope();
  if (s?.signal.aborted) throw s.signal.reason ?? new RequestCancelled('CANCELLED');
}

/** 每个阶段继承父截止时间与取消信号；完成时回收仍在运行的子请求。 */
export function withRequestScope<T>(ms: number, work: () => Promise<T>, options?: { signal?: AbortSignal; forceRefresh?: boolean; detached?: boolean }): Promise<T> {
  const parent = options?.detached ? undefined : requestScope();
  const controller = new AbortController();
  const signals = [...new Set([parent?.signal, options?.signal].filter((s): s is AbortSignal => !!s))];
  const deadline = Math.min(Date.now() + ms, parent?.deadline ?? Infinity);
  const abort = (s: AbortSignal) => controller.abort(s.reason ?? new RequestCancelled('CANCELLED'));
  const listeners = signals.map(s => { const fn = () => abort(s); if (s.aborted) abort(s); else s.addEventListener('abort', fn, { once: true }); return { s, fn }; });
  const timer = setTimeout(() => controller.abort(new RequestCancelled('TIMEOUT')), Math.max(1, deadline - Date.now()));
  return storage.run({ signal: controller.signal, deadline, forceRefresh: options?.forceRefresh ?? parent?.forceRefresh }, async () => {
    let onAbort: () => void = () => {};
    try {
      throwIfCancelled();
      return await Promise.race([
        Promise.resolve().then(work),
        new Promise<never>((_, reject) => { onAbort = () => reject(controller.signal.reason); controller.signal.addEventListener('abort', onAbort, { once: true }); }),
      ]);
    } finally {
      clearTimeout(timer);
      controller.signal.removeEventListener('abort', onAbort);
      listeners.forEach(({s,fn}) => s.removeEventListener('abort', fn));
      controller.abort(new RequestCancelled('CANCELLED'));
    }
  });
}
