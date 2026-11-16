/**
 * 听音空间的大封面（1600×900 下 380px，高分屏需要 760px 以上）：按平台封面地址的规则换成大图。
 * 这是前端的小补丁；「封面清晰度」整体排在后端排期里（取各平台最大尺寸、记录实际分辨率）。
 *   - 网易云（*.music.126.net）：去掉已有的 param，换成 ?param=1000y1000
 *   - QQ 音乐（y.gtimg.cn … R300x300 …）：换成 R800x800
 *   - 酷狗（地址里带 {size} 占位）：换成 480
 * 认不出的地址原样返回。
 */
export function hiResCover(url: string): string {
  if (!url) return url;
  try {
    if (/\.music\.126\.net\//.test(url)) {
      const base = url.split('?')[0];
      return `${base}?param=1000y1000`;
    }
    if (/y\.gtimg\.cn\//.test(url) && /R\d+x\d+/.test(url)) return url.replace(/R\d+x\d+/, 'R800x800');
    if (url.includes('{size}')) return url.replace('{size}', '480');
  } catch {
    /* 原样返回 */
  }
  return url;
}
