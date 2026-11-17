/** 未提供上游期限时的客户端保守策略，非平台承诺；与解析缓存 TTL 无关。 */
export const UNKNOWN_SOURCE_TTL_MS: Readonly<Record<string, number>> = {
  netease: 15 * 60_000,
  qq: 30 * 60_000,
  kugou: 15 * 60_000,
};

export interface SourceTiming { resolvedAt: number; expiresAt: number }

/** 网易云 expi / QQ expiration 均为响应中的剩余秒数；起点使用发请求时间。 */
export function expiresAfterSeconds(seconds: unknown, requestedAt: number): number | undefined {
  if (seconds == null || seconds === '') return undefined;
  const value = Number(seconds);
  return Number.isFinite(value) && value >= 0 ? requestedAt + value * 1000 : undefined;
}

export function sourceTiming(platform: string, resolvedAt: number, upstreamExpiresAt?: number): SourceTiming {
  return {
    resolvedAt,
    expiresAt: typeof upstreamExpiresAt === 'number' && Number.isFinite(upstreamExpiresAt) && upstreamExpiresAt > 0
      ? upstreamExpiresAt : resolvedAt + (UNKNOWN_SOURCE_TTL_MS[platform] ?? 10 * 60_000),
  };
}
