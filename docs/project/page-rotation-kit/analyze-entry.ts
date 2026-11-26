// 原样复用版面的处理链：normalizeLyricLines → usable → songPace / toEngineLine → analyzeSong / songHook（LyricPage.tsx 第 229–293 行）。
import { normalizeLyricLines, type LyricLineUI } from 'E:/CUFE/vibecoding/nebula/src/lib/lyrics';
import { detectScript, songPace, toEngineLine } from 'E:/CUFE/vibecoding/nebula/src/lib/listen/model';
import { analyzeSong } from 'E:/CUFE/vibecoding/nebula/src/lib/listen/sections';
import { songHook } from 'E:/CUFE/vibecoding/nebula/src/components/lyric-page/pools';

const usable = (l: LyricLineUI | undefined) => !!l && (!!l.text?.trim() || !!l.words?.length);

export function analyze(data: unknown, title?: string, artist?: string, duration?: number) {
  const lines = normalizeLyricLines(data, title, artist);
  const src = lines.filter(usable);
  const pace = songPace(src);
  const els = src.map((l, i) => toEngineLine(l, src[i + 1] ? src[i + 1]!.timeMs / 1000 : undefined, pace)).sort((a, b) => a.s - b.s);
  const shape = analyzeSong(els.map((e) => ({ s: e.s, e: e.e, text: e.text })));
  const script = detectScript(lines);
  const cjk = script !== 'en';
  const chorusUnits = els
    .filter((_, k) => shape.sections[shape.lineSection[k] ?? -1]?.kind === 'chorus')
    .map((e) => (cjk ? [e.units ? e.units.map((u) => u.t + (u.sp ? ' ' : '')).join('') : e.text] : (e.units ?? []).map((u) => u.t)));
  const hook = songHook(chorusUnits, cjk, title);
  const hookOld = (songHook as any)(chorusUnits, cjk);
  let lastChorusSec = -1;
  shape.sections.forEach((s, i) => {
    if (s.kind === 'chorus') lastChorusSec = i;
  });
  const lastChorusStz = shape.stanzas.findIndex((z) => z.section === lastChorusSec);
  const tr = els.filter((e) => e.tr).length;
  const words = els.filter((e) => e.units).length;
  return {
    script,
    n: els.length,
    words,
    tr,
    hook,
    hookOld,
    confident: shape.confident,
    duration,
    lastEnd: els.length ? els[els.length - 1]!.e : 0,
    sections: shape.sections.map((s) => ({ kind: s.kind, from: s.from, to: s.to, s: +s.s.toFixed(2), e: +s.e.toFixed(2), occ: s.occ, of: s.of })),
    stanzas: shape.stanzas.map((z) => ({ from: z.from, to: z.to, s: +z.s.toFixed(2), e: +z.e.toFixed(2), section: z.section, kind: shape.sections[z.section]!.kind })),
    gaps: shape.gaps.map((g) => ({ s: +g.s.toFixed(1), e: +g.e.toFixed(1), kind: g.kind })),
    lastChorusStz,
    lines: els.map((e) => ({ t: e.text, s: +e.s.toFixed(2), e: +e.e.toFixed(2) })),
  };
}
