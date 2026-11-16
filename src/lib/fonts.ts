/**
 * 随软件打包的字体（NEBULA_UI_SYSTEM §7.2）：Newsreader（拉丁衬线）、Inter（拉丁无衬线）、思源宋体 KR（韩文衬线）。
 * 字体文件和 @font-face 清单在 public/fonts/（构建时原样复制到输出目录根下的 fonts/，不会被内联进页面）。
 * 这里在启动时插入一个指向 fonts/fonts.css 的样式表链接：
 *   - 地址按页面地址解析，桌面版（file://…/dist/index.html）和网页版都能找到；
 *   - CSS 里的字体地址按 fonts.css 自己的位置解析；
 *   - 带 unicode-range 的字体只在页面真的用到那些字时才下载 / 读取。
 * 中文、日文的思源宋体 / 黑体沿用系统安装的字体（P3 定稿），不打包。
 */
export function loadBundledFonts(): void {
  if (typeof document === 'undefined') return;
  if (document.querySelector('link[data-nebula-fonts]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = new URL('fonts/fonts.css', document.baseURI).href;
  link.dataset.nebulaFonts = '';
  document.head.appendChild(link);
}
