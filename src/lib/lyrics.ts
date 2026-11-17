export interface LyricWordUI {
  /** Single word / char text. */
  text: string;
  /** Absolute start ms on the song timeline. */
  startMs: number;
  /** Word duration ms. */
  duration: number;
  /**
   * 原文里这个词后面是否带空格（解析时 text 会 trim 掉空格，英文就靠它还原词间空格）。
   * undefined = 来源没有这个信息（老数据 / 合成数据）。
   */
  space?: boolean;
}

export interface LyricLineUI {
  timeMs: number;
  text: string;
  translation?: string;
  /** 罗马音（#161，网易云 romalrc / QQ roma）；与原文相同（如英文歌）时不挂。 */
  roman?: string;
  /** Line duration ms (from YRC/QRC or inferred from the next line). */
  duration?: number;
  /** Word-level timings; absent → whole-line highlight fallback. */
  words?: LyricWordUI[];
}

/** 二分查找当前播放进度对应的歌词行下标。 */
export function currentLyricIndex(lines: LyricLineUI[], timeMs: number): number {
  if (!lines.length) return -1;
  let lo = 0;
  let hi = lines.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (lines[mid]!.timeMs <= timeMs) lo = mid;
    else hi = mid - 1;
  }
  return lines[lo]!.timeMs <= timeMs ? lo : -1;
}

/** 行级 LRC 时间标签 [mm:ss.xxx]。 */
const LRC_TAG = /\[(\d{1,2}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
/** YRC 风格行标签 [startMs,durMs]。 */
const MS_TAG = /^\[(\d+)(?:,(\d+))?\]/;
/** 字级词块 (startMs,durMs,flag)text。 */
const WORD_GROUP = /\((\d+),(\d+)(?:,(\d+))?\)([^()[\]]*)/g;

function lrcTagToMs(min: string, sec: string, frac?: string): number {
  let ms = frac ? Number(frac) : 0;
  if (frac?.length === 1) ms *= 100;
  else if (frac?.length === 2) ms *= 10;
  return Number(min) * 60000 + Number(sec) * 1000 + ms;
}

/**
 * 字级歌词统一解析器：兼容三种输入
 * 1) 网易云 YRC：`[12580,3470](12580,250,0)难(12830,300,0)以…`
 * 2) QQ QRC：`[00:13.54](0,0,0)我(105,160,0)想…`（相对偏移，正则不完美但可跑）
 * 3) 网易云新版 JSON-Lines：每行 `{"t":ms,"c":[{"tx":"字","t":偏移,"d":时长}]}`
 */
export function parseYrcText(raw: string): Array<{ timeMs: number; duration: number; words: LyricWordUI[] }> {
  if (!raw) return [];
  const out: Array<{ timeMs: number; duration: number; words: LyricWordUI[] }> = [];
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    if (t.startsWith('{')) {
      try {
        const obj = JSON.parse(t) as { t?: number; c?: Array<{ tx?: string; t?: number; d?: number }> };
        if (typeof obj.t !== 'number') continue;
        const chunks = obj.c ?? [];
        const words: LyricWordUI[] = [];
        let offset = 0;
        for (const c of chunks) {
          const raw = (c.tx ?? '').replace(/[♪♫♬♩𝄞𝄢♭♮]/g, '');
          const text = raw.trim();
          if (!text) continue;
          if (typeof c.t !== 'number' || typeof c.d !== 'number' || c.d <= 0) continue;
          offset = c.t;
          words.push({ text, startMs: obj.t + offset, duration: c.d ?? 0, space: /\s$/.test(raw) });
          if (typeof c.d === 'number') offset += c.d;
        }
        if (words.length) out.push({ timeMs: obj.t, duration: 0, words });
        continue;
      } catch {
        /* fall through to text parsing */
      }
    }
    let lineStart: number | null = null;
    let lineDur = 0;
    const msTag = t.match(MS_TAG);
    if (msTag) {
      lineStart = Number(msTag[1]);
      lineDur = msTag[2] ? Number(msTag[2]) : 0;
    } else {
      LRC_TAG.lastIndex = 0;
      const lrcTag = LRC_TAG.exec(t);
      if (lrcTag) lineStart = lrcTagToMs(lrcTag[1]!, lrcTag[2]!, lrcTag[3]);
    }
    WORD_GROUP.lastIndex = 0;
    const words: LyricWordUI[] = [];
    let m: RegExpExecArray | null;
    while ((m = WORD_GROUP.exec(t)) !== null) {
      const raw = (m[4] ?? '').replace(/[♪♫♬♩𝄞𝄢♭♮]/g, '');
      const text = raw.trim();
      if (!text) continue;
      const ws = Number(m[1]);
      const wd = Number(m[2]);
      // 后端已把 QRC/KRC 规范化成绝对毫秒，不做猜测式偏移
      const start = ws;
      if (!(wd > 0) || (lineStart != null && start < lineStart - 100)) continue;
      words.push({ text, startMs: start, duration: wd, space: /\s$/.test(raw) });
    }
    if (!words.length) continue;
    if (lineStart == null) lineStart = words[0]!.startMs;
    out.push({ timeMs: lineStart, duration: lineDur, words });
  }
  out.sort((a, b) => a.timeMs - b.timeMs);
  // 补齐缺失的行时长（取下一行起点差，封顶 12s）
  for (let i = 0; i < out.length; i++) {
    if (out[i]!.duration > 0) continue;
    const next = out[i + 1]?.timeMs;
    const dur = next != null ? Math.min(12000, Math.max(1200, next - out[i]!.timeMs)) : 6000;
    out[i]!.duration = dur;
  }
  return out;
}

/**
 * 把后端返回的 yrc/qrc 字级数据与 LRC 行合并。
 * 以逐字行为骨架（部分歌曲正文只在 yrc 里，lrc 只有元数据），
 * LRC 负责补充文本/翻译，未被 yrc 覆盖的行原样保留。
 */
export function mergeWordLyrics(lines: LyricLineUI[], rawYrc: string): LyricLineUI[] {
  if (!rawYrc) return lines;
  const wordLines = parseYrcText(rawYrc);
  if (!wordLines.length) return lines;
  const norm = (s: string): string =>
    s
      .toLowerCase()
      .replace(/[\s，。！？、,.!?'"·\-—–()（）]/g, '');
  const joinWords = (words: LyricWordUI[]): string => {
    // 有原文空格信息时按它拼（「stronger.」这类带标点的英文词以前会被当成非拉丁、空格全丢）
    if (words.some((w) => w.space !== undefined)) return words.map((w) => w.text + (w.space ? ' ' : '')).join('').trim();
    const latin = words.every((w) => /^[A-Za-z0-9'’\- ]+$/.test(w.text));
    return latin ? words.map((w) => w.text).join(' ') : words.map((w) => w.text).join('');
  };
  const out: LyricLineUI[] = [];
  for (const wl of wordLines) {
    const wtext=norm(joinWords(wl.words));
    const match=lines.find(l=>l.text && Math.abs(l.timeMs-wl.timeMs)<=250 && norm(l.text)===wtext);
    // 已有正文时不接纳文本不符或时间偏离的逐字；无正文才直接使用供应方的逐字正文。
    if(lines.some(l=>l.text.trim()) && !match)continue;
    out.push({
      timeMs: match?.timeMs ?? wl.timeMs,
      text: match?.text ?? joinWords(wl.words),
      duration: wl.duration || match?.duration,
      translation: match?.translation,
      words: wl.words,
    });
  }
  for (const l of lines) {
    if (!out.some((o) => Math.abs(o.timeMs - l.timeMs) <= 80)) out.push(l);
  }
  return out.sort((a, b) => a.timeMs - b.timeMs);
}

/**
 * QQ 的韩语罗马音按音节空一格、按词空两格（`neol  du go  ddeo na on`）：`joinSyllables` 时拼回成词（`neol dugo ddeonaon`）。
 * 其他（QQ 日语按音节、网易云按词）没有这种词界，只把多余空白收成一个。
 */
export function tidyRoman(s: string, joinSyllables: boolean): string {
  const t = s.trim();
  if (joinSyllables && /\S {2,}\S/.test(t)) return t.split(/\s{2,}/).map((w) => w.replace(/\s+/g, '')).join(' ');
  return t.replace(/\s+/g, ' ');
}

/**
 * 韩语罗马音按原文的词分组（#166）：QQ 原生罗马音是一个韩文音节一段（`geu ddae ggum man`），
 * 后端本地补全的是按词写的（`geuttae kkumman`），同一首里会混着来。
 * 原文每个韩文字对应罗马音的一段、每个拉丁词对应一段：段数正好对上时，按原文的词把段拼起来；
 * 对不上（日语汉字一个字读好几个音节、按词写的行）返回 null，交给 tidyRoman。
 */
export function regroupByHangul(roman: string, original: string): string | null {
  if (!/[가-힯]/.test(original)) return null;
  const tokens = roman.trim().split(/\s+/).filter(Boolean);
  const words = original.trim().split(/\s+/).filter(Boolean);
  const sizes = words.map((w) => (w.match(/[가-힯]|[A-Za-z0-9'’]+/g) ?? []).length);
  const total = sizes.reduce((a, b) => a + b, 0);
  if (!total || total !== tokens.length || total === words.length) return null;
  const out: string[] = [];
  let i = 0;
  for (const n of sizes) {
    if (!n) continue;
    out.push(tokens.slice(i, i + n).join(''));
    i += n;
  }
  return out.join(' ');
}

/**
 * 罗马音（#161）：后端的 romalrc 是普通 LRC（网易云 romalrc、QQ roma 都归一成它），
 * 按时间挂到最近的原文行上（相差 300ms 以内；相邻两句通常隔好几秒）。
 * 和原文去掉空格标点后一样的（英文歌）不挂；原文是空行的不挂。
 */
export function attachRoman(lines: LyricLineUI[], raw: string): LyricLineUI[] {
  if (!raw || !lines.length) return lines;
  const rows: { t: number; text: string }[] = [];
  const all = raw.split(/\r?\n/);
  // 整首三成以上的行都有双空格，才算「音节一格、词两格」的写法（偶尔多一个空格的不算）
  const body = all.map((l) => l.replace(/\[[^\]]*\]/g, '').trim()).filter(Boolean);
  const joinSyllables = body.filter((l) => /\S {2,}\S/.test(l)).length >= body.length * 0.3;
  for (const line of all) {
    LRC_TAG.lastIndex = 0;
    const times: number[] = [];
    let m: RegExpExecArray | null;
    while ((m = LRC_TAG.exec(line)) !== null) times.push(lrcTagToMs(m[1]!, m[2]!, m[3]));
    const text = line.replace(/\[[^\]]*\]/g, '').trim();
    if (!times.length || !text) continue;
    for (const t of times) rows.push({ t, text });
  }
  if (!rows.length) return lines;
  const norm = (s: string) => s.toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '');
  return lines.map((l) => {
    if (!l.text.trim()) return l;
    let best: { t: number; text: string } | undefined;
    let bestD = 301;
    for (const r of rows) {
      const d = Math.abs(r.t - l.timeMs);
      if (d < bestD) {
        bestD = d;
        best = r;
      }
    }
    if (!best) return l;
    // 双空格拼词只认韩语行（#169）：QQ 日语罗马音在英文词前后也空两格（`Baby  wa ta shi`），拼了会把日语音节连成一串
    const roman = regroupByHangul(best.text, l.text) ?? tidyRoman(best.text, joinSyllables && /[\uac00-\ud7af]/.test(l.text));
    if (!roman || norm(roman) === norm(l.text)) return l;
    return { ...l, roman };
  });
}

/**
 * 将逐字歌词的 word text 与 LRC 行文本对齐，确保英文空格不丢失。
 * 当 YRC/QRC 的 word text 被拼接为连续字符串时，
 * 只补原文空格，不拆分供应方词块，也不改变任何时间戳。
 * 仅在 word 拼接与 LRC text（去空格）一致但空格位置不同时生效。
 */
export function alignWordsToText(lines: LyricLineUI[]): LyricLineUI[] {
  return lines.map(line=>{
    if(!line.words?.length || line.words.map(w=>w.text.replace(/\s/g,'')).join('')!==line.text.replace(/\s/g,''))return line;
    let cursor=0;
    const words=line.words.map(word=>{
      let text='',count=0;const length=word.text.replace(/\s/g,'').length;
      while(cursor<line.text.length && count<length){const c=line.text[cursor++]!;text+=c;if(!/\s/.test(c))count++;}
      let space=false;while(cursor<line.text.length && /\s/.test(line.text[cursor]!)){cursor++;space=true;}
      return {...word,text:text.trim(),space};
    });
    return {...line,words};
  });
}

/** 中/日文歌词“配料表”行（作词/作曲/编曲/演唱/词:/曲:/歌詞/訳詞…）。 */
const CREDIT_CN =
  /^(作词|作曲|编曲|作詞|作曲|歌詞|訳詞|制作人?|制作|演唱|原唱|翻唱|混音|录音|和声|合声|监制|出品|发行|企划|文案|封面|设计|导演|词曲|词|曲|吉他|贝斯|鼓手?|键盘|弦乐|母带|后期|编辑|版权|配唱|配乐|统筹|混录|母带处理|音乐制作|录音室|发行公司|版权方|词曲版权|录音版权|词曲唱)\s*[:：]/;
/** 英文/拼音歌词“配料表”行（Lyrics by / Composed by / OP: / SP:…）。 */
const CREDIT_EN =
  /^(lyrics?|composed|composer|produced|producer|written|writer|mixed|mastered|recorded|arranged|engineered|programmed|published|performed|vocals?|backing vocals?|executive producer|additional|guitar|bass|drums?|keyboards?|strings?|piano|chorus|background vocals?)\b(\s*by|\s*[:：])/i;
const CREDIT_OP_SP = /^(op|sp)\s*[:：]/i;
/**
 * 正文开始前没有冒号的署名行（QQ 部分韩语 / 日语歌词：「词정준일」「编曲정준일/권영찬」，#166）。
 * 只认后面紧跟韩文、假名或字母的，免得把「曲终人散」这类正文第一句当成署名。
 */
const CREDIT_BARE = /^(作词|作曲|编曲|作詞|編曲|词|曲)[가-힯぀-ヿA-Za-z]/;
/** QQ 给带音译的歌加的说明行（「以下音译标注由AI工具生产」等，#161）。 */
const ROMAN_NOTE = /^以下.{0,6}(音译|罗马音|注音|翻译).{0,8}(生产|生成|提供|制作)/;
/**
 * 通用的英文制作人员行：「标签：名字」，且标签里有制作类关键词（2026-11-16，真实数据里漏掉了
 * 「Programming：Cirkut」「Recording Engineers：…」这类写法）。标签限 40 个字符内、只含字母 / 空格 / & / -，
 * 避免误伤正文里带冒号的句子。
 */
const CREDIT_LABEL = /^([A-Za-z][A-Za-z&\-\s]{1,40})\s*[:：]/;
const CREDIT_WORDS = /\b(lyric|compos|produc|writ|mix|master|record|arrang|engineer|program|publish|perform|vocal|guitar|bass|drum|keyboard|string|piano|synth|chorus|assist|studio|editor|director|coordinat|supervis|a&r)/i;
function isEnglishCreditLabel(text: string): boolean {
  const m = text.match(CREDIT_LABEL);
  return !!m && CREDIT_WORDS.test(m[1]!);
}
/** 标题行比较用：去掉空白和各种括号，小写。 */
const compactHead = (s: string): string => s.replace(/[\s()（）[\]【】]/g, '').toLowerCase();
/** 纯音乐符号行（♪♫…）。 */
const NOTE_ONLY = /^[♪♫♬♩𝄞𝄢♭♮\s]+$/;
const NOTE_CHARS = /[♪♫♬♩𝄞𝄢♭♮]/g;

/**
 * 过滤歌词“配料表”（作词/作曲/编曲/演唱、Lyrics by/Composed by/OP/SP 等）
 * 与空行、纯音符行，保证 Z1 直接从歌词正文开始。
 */
export function filterCreditLines(lines: LyricLineUI[], title?: string, artist?: string): LyricLineUI[] {
  // 歌名后面括号里的译名（「잘 알지도 못하면서 (什么也不懂)」）：标题行里通常只有原名（#166）
  const titleCore = title?.replace(/\s*[(（][^()（）]*[)）]\s*$/, '').trim();
  const out: LyricLineUI[] = [];
  let droppedHeader = 0;
  let sawText = false;
  for (const l of lines) {
    const text = (l.text ?? '').replace(NOTE_CHARS, '').trim();
    if (!text) {
      // 翻译独行（原文为空、仅有翻译）保留，供主歌词下方展示；开头的先丢弃
      if (l.translation && sawText) out.push({ ...l, text: '' });
      continue;
    }
    if (NOTE_ONLY.test(text)) continue;
    if (CREDIT_CN.test(text) || CREDIT_EN.test(text) || CREDIT_OP_SP.test(text) || isEnglishCreditLabel(text)) continue;
    if (!sawText && (ROMAN_NOTE.test(text) || (CREDIT_BARE.test(text) && text.length <= 40))) continue;
    // 开头“歌名 - 歌手”标题行：仅清正文开始前的最多 2 行。
    // QQ 也有去掉空格和括号挤在一起的写法（「SeattleAlone-脸红的思春期볼빨간사춘기」，#161）
    if (
      droppedHeader < 2 &&
      ((/ - /.test(text) &&
        ((title && (text.includes(title) || (!sawText && !!titleCore && text.startsWith(`${titleCore} - `)))) ||
          (artist && text.includes(artist)))) ||
        (!sawText && !!title && compactHead(text).startsWith(`${compactHead(title)}-`)))
    ) {
      droppedHeader++;
      continue;
    }
    sawText = true;
    out.push(text === l.text ? l : { ...l, text });
  }
  return out;
}
