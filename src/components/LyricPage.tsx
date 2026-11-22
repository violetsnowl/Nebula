import { useEffect, useMemo, useRef, type CSSProperties } from 'react';
import { audioPlayer } from '../lib/audio/AudioPlayer';
import { useAudioPlayer } from '../lib/audio/useAudioPlayer';
import { useInterfaceSettingsContext } from '../hooks/interfaceSettings/InterfaceSettingsContext';
import type { LyricLineUI } from '../lib/lyrics';
import { listenBus } from '../lib/listenMode';
import { detectScript, songPace, toEngineLine, type EngineLine } from '../lib/listen/model';
import { analyzeSong, type SectionKind } from '../lib/listen/sections';
import { useListenSettings } from '../lib/listen/settings';
import { TYPO, measureUnits, renderUnits, restUnit, unitFrame, waveOf, type UnitRt } from '../lib/listen/words';
import { useSpaceLab } from '../lib/space/lab';
import './listen/lyric-words.css';
import './lyric-page.css';

/**
 * 版面（样张 M，2026-11-22，fe/next）：聆听时的另一种主舞台。完全不飞，靠排版：
 *   - 一个句组（段落引擎 sections.ts 的 stanza）一页；整页一出现就以浅灰印好（能提前读到），唱到哪个字，哪个字印成实色；
 *   - 每种段落一种版式：主歌左对齐一栏（翻译作旁注排在右栏），预副歌右下斜体，副歌字最大、逐行错开，桥段留白最多，尾声居中小字；
 *   - 中文歌竖排、从右往左；
 *   - 逐字层与听音空间、漫游歌词同一套（扫光、波浪、长音、尾韵），颜色跟随「封面色 / 同色系」。
 * 只在舞台实验室选了「版面」且正在聆听时出现（透明度 = 交接进度 --lk）；漫游时仍是漫游歌词的氛围 / 字幕。
 * 版面按 1600 × 900 的逻辑画幅排，整体等比缩放到窗口（像一张海报），长句按页统一缩小字号塞进版心。
 */

interface LyricPageProps {
  lines: LyricLineUI[];
  songKey?: string;
  showTranslation: boolean;
}

const PW = 1600;
const PH = 900;
const KIND_ZH: Record<SectionKind, string> = { verse: '主歌', pre: '预副歌', chorus: '副歌', bridge: '桥段', outro: '尾声' };
const NUM_ZH = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];

const usable = (l: LyricLineUI | undefined) => !!l && (!!l.text?.trim() || !!l.words?.length);
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const smooth = (x: number) => {
  const t = clamp(x, 0, 1);
  return t * t * (3 - 2 * t);
};

interface PLine {
  e: EngineLine;
  el: HTMLElement;
  tx: HTMLElement;
  tr: HTMLElement | null;
  rts: UnitRt[] | null;
  whole: HTMLElement | null;
  state: 'future' | 'cur' | 'past';
  active: boolean;
  w: number;
  h: number;
}

interface PPage {
  el: HTMLElement;
  lines: PLine[];
  kind: SectionKind;
  s: number;
  e: number;
  tIn: number;
  tOut: number;
  on: boolean;
  measured: boolean;
}

/** 没唱到的字（浅灰的「先印好」）：封面色模式是白 16%，同色系带一点主色。 */
const GHOST = {
  cover: 'rgba(255,255,255,.16)',
  mono: 'color-mix(in srgb, color-mix(in srgb, var(--lc-a) 58%, #fff) 18%, transparent)',
} as const;

/** 按段落种类排一页。f = 整页字号缩放（长句塞不下时 < 1）。 */
function layoutPage(pg: PPage, vert: boolean, f: number): void {
  const n = pg.lines.length;
  const hasTr = pg.lines.some((l) => l.tr);
  pg.lines.forEach((l, i) => {
    const st = l.el.style;
    const tx = l.tx.style;
    st.left = st.right = st.top = st.width = st.textAlign = '';
    tx.fontStyle = '';
    if (vert) {
      let fs = 50;
      let gap = 104;
      let right = 1290;
      let top = 200;
      if (pg.kind === 'chorus') {
        fs = 72;
        gap = 136;
        right = PW / 2 + ((n - 1) * gap * f) / 2 + 36;
        top = 130;
      } else if (pg.kind === 'pre') {
        fs = 44;
        gap = 90;
        right = 700;
        top = 300;
      } else if (pg.kind === 'bridge') {
        fs = 52;
        gap = 190;
        right = 1120;
        top = 170 + i * 70;
      } else if (pg.kind === 'outro') {
        fs = 42;
        gap = 96;
        right = PW / 2 + ((n - 1) * gap * f) / 2 + 20;
        top = 330;
      }
      tx.fontSize = `${fs * f}px`;
      st.left = `${right - i * gap * f - fs * f}px`;
      st.top = `${top}px`;
      return;
    }
    if (pg.kind === 'chorus') {
      const step = 108 * f;
      tx.fontSize = `${64 * f}px`;
      st.left = `${190 + i * 56}px`;
      st.top = `${PH / 2 - ((n - 1) * step) / 2 - 44 * f + i * step}px`;
      if (l.tr) l.tr.className = 'lp-tr is-under';
    } else if (pg.kind === 'pre') {
      const step = 96 * f;
      tx.fontSize = `${44 * f}px`;
      tx.fontStyle = 'italic';
      st.right = '190px';
      st.textAlign = 'right';
      st.top = `${Math.min(470, PH - 130 - n * step) + i * step}px`;
      if (l.tr) l.tr.className = 'lp-tr is-under';
    } else if (pg.kind === 'bridge') {
      tx.fontSize = `${54 * f}px`;
      tx.fontStyle = 'italic';
      const x = 200 + (i % 3) * 340;
      // 留白最多：一句一个位置，往右下错开；放不下时往左收
      st.left = `${Math.max(150, Math.min(x, PW - 150 - l.w * f))}px`;
      st.top = `${230 + i * Math.min(180, 440 / Math.max(1, n - 1))}px`;
      if (l.tr) l.tr.className = 'lp-tr is-under';
    } else if (pg.kind === 'outro') {
      tx.fontSize = `${38 * f}px`;
      st.left = '0';
      st.width = `${PW}px`;
      st.textAlign = 'center';
      st.top = `${PH / 2 - 20 - (n - 1) * 55 + i * 110}px`;
      if (l.tr) l.tr.className = 'lp-tr is-under';
    } else {
      const step = 80 * f;
      tx.fontSize = `${42 * f}px`;
      st.left = '190px';
      st.top = `${PH / 2 - ((n - 1) * step) / 2 - 30 * f + i * step}px`;
      // 主歌：翻译作旁注排在右栏，和原文同一行
      if (l.tr) l.tr.className = hasTr ? 'lp-tr is-side' : 'lp-tr is-under';
    }
  });
}

/** 这一页每句最多能占多宽（横排）/ 多高（竖排），用来算整页缩放。 */
function roomOf(pg: PPage, vert: boolean, i: number): number {
  if (vert) {
    const top = pg.kind === 'chorus' ? 130 : pg.kind === 'pre' ? 300 : pg.kind === 'bridge' ? 170 + i * 70 : pg.kind === 'outro' ? 330 : 200;
    return PH - top - 70;
  }
  const hasTr = pg.lines.some((l) => l.tr);
  if (pg.kind === 'chorus') return PW - 150 - (190 + i * 56);
  if (pg.kind === 'bridge') return PW - 300;
  if (pg.kind === 'verse') return (hasTr ? 1140 : PW - 150) - 190;
  return PW - 340;
}

/**
 * 版面：聆听时的主舞台之一（舞台实验室「聆听时的舞台 › 版面」）。
 */
export function LyricPage({ lines, songKey, showTranslation }: LyricPageProps) {
  const lab = useSpaceLab();
  const active = lab.stageMode === 'page';
  const listen = useListenSettings();
  const { lyricSettings: settings } = useInterfaceSettingsContext();
  const playState = useAudioPlayer();
  const playingRef = useRef(playState.playing);
  playingRef.current = playState.playing;
  const rootRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const schemeRef = useRef(listen.scheme);
  schemeRef.current = listen.scheme;

  const model = useMemo(() => {
    const src = lines.filter(usable);
    const pace = songPace(src);
    const els = src.map((l, i) => toEngineLine(l, src[i + 1] ? src[i + 1]!.timeMs / 1000 : undefined, pace)).sort((a, b) => a.s - b.s);
    const shape = analyzeSong(els.map((e) => ({ s: e.s, e: e.e, text: e.text })));
    return { els, shape, script: detectScript(lines) };
  }, [lines]);
  const vert = model.script === 'zh';
  const typo = TYPO[listen.font][model.script];

  // 根元素标记：星云在版面模式下沉成纸面（styles.css）
  useEffect(() => {
    if (!active) return;
    const d = document.documentElement.dataset;
    d.stageMode = 'page';
    return () => {
      delete d.stageMode;
    };
  }, [active]);

  useEffect(() => {
    const root = rootRef.current;
    const frame = frameRef.current;
    if (!active || !root || !frame) return;
    frame.textContent = '';
    const { els, shape } = model;
    const total = shape.stanzas.length;
    // —— 建页 ——
    const pages: PPage[] = shape.stanzas.map((stz, j) => {
      const sec = shape.sections[stz.section]!;
      const el = document.createElement('div');
      el.className = 'lp-page';
      const folio = document.createElement('div');
      folio.className = 'lp-folio';
      const b = document.createElement('b');
      b.textContent = KIND_ZH[sec.kind];
      folio.appendChild(b);
      const occ = sec.of > 1 ? ` · 第${NUM_ZH[sec.occ] ?? sec.occ + 1}次` : '';
      folio.appendChild(document.createTextNode(occ + (stz.from === sec.from ? '' : ' · 续')));
      const no = document.createElement('div');
      no.className = 'lp-no';
      no.textContent = `${String(j + 1).padStart(2, '0')} / ${String(total).padStart(2, '0')}`;
      el.append(folio, no);
      const pl: PLine[] = [];
      for (let k = stz.from; k <= stz.to; k++) {
        const e = els[k]!;
        const line = document.createElement('div');
        line.className = 'lp-line';
        const tx = document.createElement('div');
        tx.className = 'lp-tx';
        let rts: UnitRt[] | null = null;
        let whole: HTMLElement | null = null;
        if (e.units) rts = renderUnits(tx, e.units);
        else {
          whole = document.createElement('span');
          whole.className = 'lp-whole';
          whole.textContent = e.text;
          tx.appendChild(whole);
        }
        line.appendChild(tx);
        let tr: HTMLElement | null = null;
        if (showTranslation && !vert && e.tr) {
          tr = document.createElement('div');
          tr.className = 'lp-tr';
          tr.textContent = e.tr;
          line.appendChild(tr);
        }
        el.appendChild(line);
        pl.push({ e, el: line, tx, tr, rts, whole, state: 'future', active: false, w: 0, h: 0 });
      }
      frame.appendChild(el);
      return { el, lines: pl, kind: sec.kind, s: stz.s, e: stz.e, tIn: 0, tOut: Infinity, on: false, measured: false };
    });
    // —— 换页时刻：长空档（间奏）里上一页唱完 1.4s 后淡出、下一页提前 2.2s 出现；否则唱完就换（最多提前 0.9s） ——
    pages.forEach((p, j) => {
      const prev = pages[j - 1];
      if (!prev) {
        p.tIn = -1;
        return;
      }
      const long = p.s - prev.e >= 4;
      p.tIn = long ? p.s - 2.2 : Math.max(prev.e + 0.1, p.s - 0.9);
      prev.tOut = long ? prev.e + 1.4 : p.tIn;
    });
    // —— 排版：先按原字号排、量尺寸，再按最挤的那句整页缩小 ——
    const layoutAll = () => {
      for (const pg of pages) {
        pg.el.style.display = 'block';
        layoutPage(pg, vert, 1);
        let f = 1;
        pg.lines.forEach((l, i) => {
          l.w = l.tx.offsetWidth;
          l.h = l.tx.offsetHeight;
          const need = vert ? l.h : l.w;
          if (need > 0) f = Math.min(f, roomOf(pg, vert, i) / need);
        });
        f = clamp(f, 0.5, 1);
        layoutPage(pg, vert, f);
        for (const l of pg.lines) if (l.rts) measureUnits(l.rts);
        pg.measured = true;
        pg.el.style.display = pg.on ? 'block' : 'none';
      }
    };
    layoutAll();
    let cancelled = false;
    document.fonts?.ready.then(() => {
      if (!cancelled) layoutAll();
    });
    // —— 等比缩放到窗口 ——
    const fit = () => {
      const s = Math.min(root.clientWidth / PW, root.clientHeight / PH);
      frame.style.transform = `translate(-50%, -50%) scale(${s.toFixed(4)})`;
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(root);

    // —— 逐帧 ——
    let raf = 0;
    let last = performance.now();
    let lastPos = -1;
    let extrap = 0;
    let rootOp = '';
    const tick = (now: number) => {
      const dt = clamp((now - last) / 1000, 0.001, 0.05);
      last = now;
      const playing = playingRef.current;
      const pos = audioPlayer.position();
      if (playing && pos === lastPos) extrap = Math.min(0.25, extrap + dt);
      else extrap = 0;
      lastPos = pos;
      const t = playing ? pos + extrap : pos;
      const k = listenBus.enabled ? listenBus.k : 0;
      const op = k.toFixed(3);
      if (op !== rootOp) {
        root.style.opacity = op;
        rootOp = op;
      }
      if (k > 0.001) {
        const scheme = schemeRef.current;
        const ghost = GHOST[scheme === 'mono' ? 'mono' : 'cover'];
        for (const pg of pages) {
          const inK = pg.tIn < 0 ? 1 : smooth((t - pg.tIn) / 0.9);
          const outK = smooth((t - pg.tOut) / 0.7);
          const vis = inK * (1 - outK);
          if (vis <= 0.001) {
            if (pg.on) {
              pg.el.style.display = 'none';
              pg.on = false;
            }
            continue;
          }
          if (!pg.on) {
            pg.el.style.display = 'block';
            pg.on = true;
          }
          pg.el.style.opacity = vis.toFixed(3);
          pg.el.style.transform = `translate3d(0, ${((1 - inK) * 22 - outK * 16).toFixed(1)}px, 0)`;
          for (const l of pg.lines) {
            const e = l.e;
            const state: PLine['state'] = t > e.e + 0.9 ? 'past' : t >= e.s - 0.05 ? 'cur' : 'future';
            if (state !== l.state) {
              l.state = state;
              l.el.classList.toggle('is-grad', state === 'cur');
              l.el.classList.toggle('is-past', state === 'past');
              l.el.classList.toggle('is-cur', state === 'cur');
              if (state !== 'cur' && l.rts && l.active) {
                l.rts.forEach(restUnit);
                l.active = false;
              }
            }
            if (l.whole) l.whole.classList.toggle('is-on', t >= e.s);
            if (state !== 'cur' || !l.rts?.length) continue;
            // 正在唱（和唱完后 0.9s 的尾韵）：扫光、波浪、长音；没唱到的部分是浅灰的「先印好」
            const singing = t <= e.e + 0.3;
            const wave = singing ? waveOf(l.rts, e.dens, t) : null;
            for (const rt of l.rts) {
              unitFrame(rt, t, scheme, singing, wave, e.dens);
              rt.v.set('--un', ghost);
              rt.chs?.forEach((c) => c.set('--un', ghost));
            }
            if (!singing && l.active) l.rts.forEach(restUnit);
            l.active = singing;
          }
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      frame.textContent = '';
      root.style.opacity = '0';
    };
  }, [active, model, vert, showTranslation, listen.font, songKey]);

  if (!active) return null;
  const lcA = settings.lyricColorSource === 'custom' ? settings.customColor : 'var(--ly-a, rgb(238 240 244))';
  const vars = {
    '--lc-a': lcA,
    '--lc-font': typo.f,
    '--lc-ls': typo.ls,
    '--lyric-weight': settings.bold ? 700 : typo.w,
  } as CSSProperties;
  return (
    <div ref={rootRef} className={`lyric-page lw${vert ? ' is-vert' : ''}`} data-scheme={listen.scheme} style={vars} aria-hidden="true">
      <div ref={frameRef} className="lp-frame" />
    </div>
  );
}
