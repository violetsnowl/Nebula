import { useEffect, useRef, useState } from 'react';
import type { Track } from '../catalog';
import { hasDesktopAPI, toBackendTrack, type DesktopCoverInfo, type PlaybackMetadata } from '../playlist/ipcClient';
import { hiResCover } from './coverUrl';

/**
 * 听音空间的大封面用哪张图（#158，NEBULA_UI_SYSTEM §9.9「封面清晰度」）。
 *
 * 1. 小封面（卡片、播放条都在用，通常已在缓存里）地址里写明的边长已经够用 → 直接用小图。
 * 2. 否则问后端原图的实际像素：歌曲自带的 coverInfo 已实测（verified）就用它，没实测就让主进程读图片文件头（coverInfo IPC）。
 *    原图实测比小图大 → 用原图；原图比需要的大 1.5 倍以上时先用平台服务端缩好的尺寸（见 verifiedCandidates）。
 * 3. 读不出实际像素 → 退回按平台规则猜的大图（hiResCover）。
 * 4. 任何一张都要先在后台解码成功才用；都不行就一直是小图，不会出现空白或裂图。
 *
 * 结果按歌曲记在内存里（最多 200 首，连同当时按多大的尺寸取的），切回同一首立刻是大图；窗口放大后不够用会重新取。
 * 只给听音空间用：星云卡片、小封面星层、取色、播放条、详情弹窗都继续用小图（显示得小，小图更快、更省内存）。
 */

const CACHE_MAX = 200;
/** 每首歌取到的图，连同当时按多大的尺寸取的（窗口放大后要重新取）。 */
const cache = new Map<string, { url: string; need: number }>();

/** 听音空间开着时换歌：最多等这么久大图，等不到先换小图（不让封面和歌名长时间对不上）。 */
const HOLD_MS = 1200;
/** 问后端原图实际像素最多等多久。 */
const PROBE_MS = 1500;
/** 听音空间没开时，换歌后停留这么久才预取（快速连切不白下载）。 */
const PREFETCH_DELAY_MS = 1500;

function keyOf(s: Track): string {
  return `${s.source}:${s.sourceId ?? s.id}:${s.cover ?? ''}`;
}

/** 小封面地址里写明的边长（网易云 `param=500y500`、QQ `R300x300`）；认不出返回 0。 */
export function statedPx(url: string): number {
  const m = url.match(/[?&]param=(\d+)y(\d+)/) ?? url.match(/R(\d+)x(\d+)/);
  return m ? Math.min(Number(m[1]), Number(m[2])) : 0;
}

/** 大封面需要的边长（物理像素）= 封面 CSS 边长（`--ls-cv`，1600×900 下 380px）× 设备像素比。 */
export function neededPx(): number {
  const root = document.documentElement;
  const css =
    parseFloat(getComputedStyle(root).getPropertyValue('--ls-cv')) ||
    Math.min(window.innerHeight * 0.42, window.innerWidth * 0.3);
  return Math.ceil(css * (window.devicePixelRatio || 1));
}

/**
 * 实测过的原图 → 按顺序尝试加载的地址。
 * 原图比需要的大 1.5 倍以上时（QQ、酷狗常见 1500–3000 像素、几兆一张），先用平台服务端缩好的尺寸，省流量和解码内存；
 * 缩好的打不开再用原图。
 */
export function verifiedCandidates(info: DesktopCoverInfo, small: string, source: string, need: number): string[] {
  const side = Math.min(info.width ?? 0, info.height ?? 0);
  const out: string[] = [];
  if (side > need * 1.5) {
    if (source === 'netease' && /\.music\.126\.net\//.test(info.url)) {
      const n = Math.min(side, Math.ceil(need / 100) * 100);
      out.push(`${info.url.split('?')[0]}?param=${n}y${n}`);
    } else if (source === 'qq' && /R\d+x\d+/.test(small) && need <= 864) {
      // QQ 只有固定几档；800 比需要的最多小 8%，看不出来
      out.push(small.replace(/R\d+x\d+/, 'R800x800'));
    } else if (small.includes('{size}') && need <= 1000) {
      out.push(small.replace('{size}', '1000'));
    }
  }
  out.push(info.url);
  return [...new Set(out)];
}

function decodes(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    img.decode().then(
      () => resolve(img.naturalWidth > 0),
      () => resolve(false),
    );
  });
}

async function resolveBig(song: Track, need: number): Promise<string> {
  const small = song.cover ?? '';
  const stated = statedPx(small);
  if (stated >= need) return small;
  let info: DesktopCoverInfo | undefined = (song as Track & PlaybackMetadata).coverInfo;
  if (!info?.verified && hasDesktopAPI() && window.nebulaAPI!.coverInfo) {
    try {
      // 主进程读文件头一般 0.1–0.7 秒；网络卡住时最多等 1.5 秒，之后按平台规则猜（QQ 猜的就是 800 档）
      const r = await Promise.race([
        window.nebulaAPI!.coverInfo(toBackendTrack(song)),
        new Promise<null>((res) => window.setTimeout(() => res(null), PROBE_MS)),
      ]);
      if (r?.ok && r.data) info = r.data;
    } catch {
      /* 读不出就按猜的来 */
    }
  }
  if (info?.verified && info.url) {
    const side = Math.min(info.width ?? 0, info.height ?? 0);
    // 原图并不比小图大：小图就是最清楚的
    if (stated && side <= stated) return small;
    for (const url of verifiedCandidates(info, small, song.source, need)) {
      if (url === small || (await decodes(url))) return url;
    }
  }
  const guess = hiResCover(small);
  if (guess !== small && (await decodes(guess))) return guess;
  return small;
}

function remember(key: string, url: string, need: number): void {
  if (cache.size >= CACHE_MAX && !cache.has(key)) cache.delete(cache.keys().next().value!);
  cache.set(key, { url, need });
}

/** 缓存里够这个尺寸用的图（启动时按小窗口取的，放大到 2K 后不算数）。 */
function cached(key: string, need: number): string | undefined {
  const e = cache.get(key);
  return e && e.need >= need * 0.95 ? e.url : undefined;
}

/**
 * 当前这首歌的大封面地址。
 * - `open`（听音空间开着）：换歌时先保留上一张，等大图准备好（最多 1.2 秒）一次换上，不会小图、大图连换两次。
 * - 没开：换歌后停 1.5 秒预取，打开听音空间时通常已经是大图。
 * 没有封面的歌返回空字符串。
 */
export function useBigCover(song: Track | null, open: boolean): string {
  const small = song?.cover ?? '';
  const key = song && small ? keyOf(song) : '';
  const [shown, setShown] = useState<{ key: string; url: string }>(() => ({ key, url: (key && cache.get(key)?.url) || small }));
  const shownRef = useRef(shown);
  shownRef.current = shown;
  const openRef = useRef(open);
  openRef.current = open;
  const songRef = useRef(song);
  songRef.current = song;
  const keyRef = useRef(key);
  keyRef.current = key;

  useEffect(() => {
    if (!song || !key) {
      setShown({ key: '', url: '' });
      return;
    }
    const hit = cached(key, neededPx());
    if (hit) {
      setShown({ key, url: hit });
      return;
    }
    let cancelled = false;
    let hold = 0;
    let delay = 0;
    // 之前按小一点的尺寸取过：先用它，比小图好
    const known = cache.get(key)?.url || small;
    const holding = openRef.current && !!shownRef.current.url && shownRef.current.key !== key;
    if (holding) hold = window.setTimeout(() => !cancelled && setShown({ key, url: known }), HOLD_MS);
    else setShown({ key, url: known });
    const run = () => {
      const need = neededPx();
      const done = cached(key, need);
      if (done) {
        window.clearTimeout(hold);
        setShown({ key, url: done });
        return;
      }
      void resolveBig(song, need).then((url) => {
        remember(key, url, need);
        window.clearTimeout(hold);
        if (!cancelled) setShown({ key, url });
      });
    };
    if (openRef.current) run();
    else delay = window.setTimeout(run, PREFETCH_DELAY_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(hold);
      window.clearTimeout(delay);
    };
    // song 只在 key 变时才算换了一首（同一首的状态更新不重来）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // 听音空间打开时、开着时窗口变大：现有的图不够这个尺寸就立刻重新取
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    let timer = 0;
    const refresh = () => {
      const s = songRef.current;
      const k = keyRef.current;
      if (!s || !k) return;
      const need = neededPx();
      if (cached(k, need)) return;
      void resolveBig(s, need).then((url) => {
        remember(k, url, need);
        if (!cancelled && shownRef.current.key === k) setShown({ key: k, url });
      });
    };
    refresh();
    const onResize = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(refresh, 400);
    };
    window.addEventListener('resize', onResize);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      window.removeEventListener('resize', onResize);
    };
  }, [open]);

  return shown.url;
}
