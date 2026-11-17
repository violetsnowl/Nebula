/** 搜索高亮属于显示标记，必须在拆分歌手、判断录音身份之前移除。 */
export function cleanMetadataText(value: unknown): string {
  const entities: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  return String(value ?? '').replace(/&(amp|lt|gt|quot|apos|nbsp);/gi, (_, name: string) => entities[name.toLowerCase()]!)
    .replace(/&#(\d+);/g, (whole, digits: string) => {
      const n = Number(digits); return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : whole;
    }).replace(/<[^>]*>/g, '').trim();
}
