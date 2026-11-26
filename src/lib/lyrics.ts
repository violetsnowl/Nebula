import { alignFurigana, hasKana, isKanji } from './furigana';

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
  /** 假名注音（#172）：每段汉字的平假名读音，按汉字段在句中出现的顺序；只有日语句、且能和罗马音对上时才有。 */
  ruby?: string[];
  /** 日语句（#172）：日语读音选「假名注音」时，这类句子不显示罗马音。 */
  ja?: boolean;
  /** Line duration ms (from YRC/QRC or inferred from the next line). */
  duration?: number;
  /** Word-level timings; absent → whole-line highlight fallback. */
  words?: LyricWordUI[];
  /** 对唱（#199）：这一句是谁唱；只有一位歌手的歌不标。听音空间里 v2 换第二色。 */
  agent?: 'v1' | 'v2' | 'both';
  /** 和声（背景人声，#199）：随行小字；words 的时间是绝对毫秒，没有逐字时只有 text。 */
  bg?: { text: string; words?: LyricWordUI[] };
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
  const matchOf = (wl: (typeof wordLines)[number]) => {
    const wtext = norm(joinWords(wl.words));
    return lines.find((l) => l.text && Math.abs(l.timeMs - wl.timeMs) <= 250 && norm(l.text) === wtext);
  };
  // 一句正文只认一份逐字（#285）：跨源补逐字偶尔把同一句的两份逐字（本平台 + 补充来源，开始时间只差几十毫秒）都留在 yrc 里，
  // 两份都配上同一句正文就会显示两遍。留时间离正文最近的那份。
  const best = new Map<LyricLineUI, (typeof wordLines)[number]>();
  for (const wl of wordLines) {
    const m = matchOf(wl);
    if (!m) continue;
    const cur = best.get(m);
    if (!cur || Math.abs(wl.timeMs - m.timeMs) < Math.abs(cur.timeMs - m.timeMs)) best.set(m, wl);
  }
  for (const wl of wordLines) {
    const match = matchOf(wl);
    if (match && best.get(match) !== wl) continue;
    // 已有正文时不接纳文本不符或时间偏离的逐字；无正文才直接使用供应方的逐字正文。
    if(lines.some(l=>l.text.trim()) && !match)continue;
    out.push({
      timeMs: match?.timeMs ?? wl.timeMs,
      text: match?.text ?? joinWords(wl.words),
      duration: wl.duration || match?.duration,
      translation: match?.translation,
      words: wl.words,
      // 对唱归属和和声挂在正文行上，逐字行只带词（#199）
      ...(match?.agent ? { agent: match.agent } : {}),
      ...(match?.bg ? { bg: match.bg } : {}),
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
  // 日语歌（#172）：两成以上的句子有假名。这样的歌里，没有假名的纯汉字句也按日语标注
  const japanese = lines.filter((l) => hasKana(l.text)).length >= Math.max(2, lines.length * 0.2);
  const hangul = /[\uac00-\ud7af]/;
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
    const ja = japanese && !hangul.test(l.text) && (hasKana(l.text) || [...l.text].some(isKanji));
    const ruby = ja ? alignFurigana(l.text, best.text) : null;
    // 双空格拼词只认韩语行（#169）：QQ 日语罗马音在英文词前后也空两格（`Baby  wa ta shi`），拼了会把日语音节连成一串
    const roman = regroupByHangul(best.text, l.text) ?? tidyRoman(best.text, joinSyllables && /[\uac00-\ud7af]/.test(l.text));
    const withRoman = !!roman && norm(roman) !== norm(l.text);
    if (!withRoman && !ruby) return l;
    return { ...l, ...(withRoman ? { roman } : {}), ...(ruby ? { ruby } : {}), ...(ja ? { ja } : {}) };
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
    if(!line.words?.length)return line;
    if(line.words.map(w=>w.text.replace(/\s/g,'')).join('')!==line.text.replace(/\s/g,''))return alignLoose(line);
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

const CORE = /[\p{L}\p{N}]/u;
const coreOf = (s: string) => [...s].filter((c) => CORE.test(c)).join('').toLowerCase();

/**
 * 逐字和正文只差标点时也照正文还原空格和标点（#285）：网易云部分逐字把「souls, but」的逗号连同空格一起丢了，
 * 逐字拼起来是「soulsbut」，和正文对不上就整句放弃，显示成粘在一起。比对时只看字母和数字；对上了就按正文切：
 * 每个词取到它的字数为止，紧跟的标点归这个词（下一个词自己以标点开头时除外），后面有空白记 space。
 * 只有标点的逐字（如「, 」）：正文这里正好是标点就吃掉它，否则保持原样。字母数字都对不上时不动。
 */
function alignLoose(line: LyricLineUI): LyricLineUI {
  const words = line.words!;
  if (!/[A-Za-z]/.test(line.text) || words.map((w) => coreOf(w.text)).join('') !== coreOf(line.text)) return line;
  const t = line.text;
  let cursor = 0;
  const isPunct = (c: string) => !/\s/.test(c) && !CORE.test(c);
  const out = words.map((word, i) => {
    const need = coreOf(word.text).length;
    let text = '';
    if (!need) {
      while (cursor < t.length && /\s/.test(t[cursor]!)) cursor++;
      while (cursor < t.length && isPunct(t[cursor]!)) text += t[cursor++]!;
    } else {
      let count = 0;
      while (cursor < t.length && count < need) {
        const c = t[cursor++]!;
        if (/\s/.test(c) && !text) continue;
        text += c;
        if (CORE.test(c)) count++;
      }
      const next = words[i + 1]?.text.trim() ?? '';
      if (!next || !isPunct(next[0]!)) while (cursor < t.length && isPunct(t[cursor]!)) text += t[cursor++]!;
    }
    let space = false;
    while (cursor < t.length && /\s/.test(t[cursor]!)) {
      cursor++;
      space = true;
    }
    return { ...word, text: text.trim() || word.text.trim(), space };
  });
  return { ...line, words: out };
}

/** 中/日文歌词“配料表”行（作词/作曲/编曲/演唱/词:/曲:/歌詞/訳詞…）。 */
const CREDIT_CN =
  /^(作词|作曲|编曲|作詞|作曲|歌詞|訳詞|制作人?|制作|演唱|原唱|翻唱|混音|录音|和声|合声|监制|出品|发行|企划|文案|封面|设计|导演|词曲|词|曲|吉他|贝斯|鼓手?|键盘|弦乐|母带|后期|编辑|版权|配唱|配乐|统筹|混录|母带处理|音乐制作|录音室|发行公司|版权方|词曲版权|录音版权|词曲唱)\s*[:：]/;
/** 英文/拼音歌词“配料表”行（Lyrics by / Composed by / OP: / SP:…）。 */
const CREDIT_EN =
  /^(lyrics?|composed|composer|produced|producer|written|writer|mixed|mastered|recorded|arranged|engineered|programmed|published|performed|vocals?|backing vocals?|executive producer|additional|guitar|bass|drums?|keyboards?|strings?|piano|chorus|background vocals?)\b(\s*by|\s*[:：])/i;
const CREDIT_OP_SP = /^(op|sp)(\s*[/&]\s*(op|sp))?\s*[:：]/i;
/**
 * 正文开始前没有冒号的署名行（QQ 部分韩语 / 日语歌词：「词정준일」「编曲정준일/권영찬」，#166）。
 * 只认后面紧跟韩文、假名或字母的，免得把「曲终人散」这类正文第一句当成署名。
 */
const CREDIT_BARE = /^(作词|作曲|编曲|作詞|編曲|词|曲)[가-힯぀-ヿA-Za-z]/;
/**
 * 「标签 + 空格 + 名字」型的署名行（#233）：整行很短、以制作标签开头、后面跟一个名字。
 * 来源里很常见：「编曲 n-buna」「作曲 米津玄師」「ギター n-buna」「Programming Cirkut」。
 * 这些行没有冒号，也不是「标签紧贴名字」，上面两条规则都漏掉了，会混进正文。
 *
 * 只用「整行很短（≤30 字）」+「标签在行首」+「标签后面确实有别的词」三个条件，
 * 不往「是否像人名」上猜——「我爱你 中国」「曲终人散」这类正文首句不会被误杀
 * （前者不以标签开头，后者标签后面紧跟的不是独立词）。
 */
const CREDIT_SPACED_LABEL = String.raw`(?:作词|作詞|作曲|编曲|編曲|词|曲|制作人?|監製|监制|混音|录音|錄音|和声|合声|吉他|貝斯|贝斯|鼓|键盘|鍵盤|弦乐|母带|配唱|ギター|ベース|ドラム|ピアノ|ストリングス|コーラス|編曲者|作詞者|作曲者|producer|composer|arranger|lyrics?|programming|guitars?|bass|drums?|keyboards?|strings?|piano|vocals?|mixing|mastering|recording|engineer(?:ing)?)`;
const CREDIT_SPACED = new RegExp(String.raw`^${CREDIT_SPACED_LABEL}\s*[:：·・/、]?\s+(?=\S)[^:：]{0,26}$`, 'i');
/** QQ 给带音译的歌加的说明行（「以下音译标注由AI工具生产」等，#161）。 */
const ROMAN_NOTE = /^以下.{0,6}(音译|罗马音|注音|翻译).{0,8}(生产|生成|提供|制作)/;
/**
 * 通用的英文制作人员行：「标签：名字」，且标签里有制作类关键词（2026-11-16，真实数据里漏掉了
 * 「Programming：Cirkut」「Recording Engineers：…」这类写法）。标签限 40 个字符内、只含字母 / 数字 / 空格 / & / - 等，
 * 避免误伤正文里带冒号的句子。
 * 2026-11-25 真实数据：补乐器（Trumpet / Violin / Cello…）与 tracking / coordinator / design 等词；
 * 前缀词（lyric / compos…）按词首匹配，整词词（乐器等）后面加 \b。
 */
const CREDIT_LABEL = /^([A-Za-z][A-Za-z0-9&\-\s./+']{1,40})\s*[:：]/;
const CREDIT_WORDS = new RegExp(
  String.raw`\b(?:lyric|compos|produc|writ|mix|master|record|arrang|engineer|program|publish|perform|vocal|guitar|bass|drum|keyboard|string|piano|synth|chorus|assist|studio|editor|director|coordinat|supervis|a&r|design|artwork|photograph|conduct|orchestra|choir|copyright|management|direction|musician|contractor|midi|[pc]\s*-\s*line|(?:track(?:ing)?|pgm|label|trumpet|violin|cello|viola|sax(?:ophone)?|horns?|trombone|flute|percussion|organ|harp|ukulele|banjo|accordion|clarinet|oboe|harmonica|mandolin|tuba|bgm|harpsichord|pipa|erhu|guzheng|b-?box|brass\s*band|emulator|author|fiddle|loop|solo|rhodes|conductor|original|adapt|admin|released|prod)\b)`,
  'i',
);
/** 日文乐器 / 工种标签（片假名，没有 \b 可用）。 */
const CREDIT_KANA = /^(?:ギター|ベース|ドラム|ピアノ|コーラス|ストリングス)/;
/**
 * 中文制作人员标签（2026-11-25 真实数据）：「弦乐编写」「录音/混音室」「出品公司」「钢琴」「合音」……
 * 标签里每一段连续汉字都必须**以角色词结尾**且不超过 10 字——「男」「女」「合唱」「汪」「呜米」这类
 * 声部标记、「你说」「宝贝」这类正文里的称呼都不以角色词结尾，不会被误杀。
 * 英文部分（「制作人 Producer」「吉他 All guitar」）不参与判定，只看汉字段。
 */
const CREDIT_CN_RUN = /[㐀-鿿豈-﫿]+/g;
const CREDIT_ROLE_END = new RegExp(
  '(?:' +
    [
      '作词|作詞|作曲|编曲|編曲|编写|編寫|编辑|編輯|词|詞|曲|制作人?|製作人?|监制|監製|录音室?|錄音室?|录音棚|錄音棚|影棚|混音师?|混音師|录音师|錄音師|混录|混音|母带|母帶|和声|和聲|和音|合声|合聲|合音',
      '统筹|統籌|策划|策劃|出品人?|出品方|发行|發行|企划|企劃|营销|營銷|推广|推廣|宣传|宣傳|设计|設計|摄影|攝影|助理|工程师|工程師|工程|乐队|樂隊|队长|隊長',
      '弦乐团?|弦樂團?|打击乐|打擊樂|乐手|樂手|乐器|樂器|吉他|貝斯|贝斯|贝司|鼓手?|键盘|鍵盤|琴|古筝|古箏|二胡|琵琶|笛子|唢呐|长笛|竹笛|[小圆圓大长長]号|[小圓大長]號|铜管|銅管|管乐|管樂|萨克斯|薩克斯',
      '人声|人聲|总监|總監|艺人|藝人|版权|版權|公司|项目|項目|联系|聯繫|联络|聯絡|协力|協力|演奏|鸣谢|鳴謝|感谢|感謝|顾问|顧問|指导|指導|导演|導演|监督|監督|提供|配唱|配乐|配樂|音频|音頻|后期|後期|独奏|獨奏|合成|编程|編程|采样|取样|演唱者?|伴唱|原唱|指挥|指揮|尤克里里|箫|法国号|法國號|三弦|重奏|技师|制谱|编成|改编|协办|協辦|管理方?|笛|带师|带棚|客串|监唱|贴唱|承办人?|支持|协助|行政|经纪|平台|合作|来源|作者|乐团|樂團|谱务|譜務|工程室|封面|宣推|[词曲]人|改编自|改編自|[录混]音[室棚]|工作室|演播室|带处理|后期处理|[小中大低]提|录制|混缩|缩混|剪辑|剪輯|执行|執行|监棚|编配|編配|发行人|[发行出]方|运营方|单位|團隊|团队|商务|商務|宣发|拍摄|海报|画师|画|邮箱|微博|声明|音乐人',
      '调音师|調音師|设计师|設計師|摄影师|攝影師|化妆师|化妝師|造型师|造型師|剪辑师|剪輯師',
    ].join('|') +
    ')$',
);
/** 只有标签、没有内容的行（「男：」「Hook：」「汪苏泷：」，整行占一列没用，2026-11-25 真实数据）。 */
const LABEL_ONLY = /^([^:：]{1,24})[:：]\s*$/;
/** 标签里带「说 / 问 / 想……」或虚词的，是正文里引出下一句的话（「他轻轻地说：」「I said:」），保留。 */
const LABEL_ONLY_SPEECH = /[说說道问問答喊叫想讲講念笑哭写寫，。！？；…,.!?;]|\b(?:said|say|says|asked?|tells?|told|sings?|sang|whispered|shouted|cried|i|you|he|she|we|they|it|the|my|me|is|are|was|like|that|this|to|of|in|on|for|with|what|when|and|but|so|if)\b/i;
/** 「Recorded at …」「Mixed at …」行首的录音信息（后面跟大写 / 数字开头的地名，2026-11-25 真实数据）。 */
const CREDIT_RECORDED_AT = /^(?:recorded|mixed|mastered)\s+(?:(?:and\s+)?(?:recorded|mixed|mastered)\s+)?(?:at|in)\s+[A-Z0-9]/i;
/** 全曲最后一句正文之后的「… recorded / mixed / mastered / produced by …」尾部署名；只在末尾判定，避免误杀正文里的 by。 */
const CREDIT_TAIL_BY = /\b(?:recorded|mixed|mastered|produced|engineered|arranged|programmed)\b[^.!?]{0,80}?\bby\b/i;
/** QQ 译文里的版权声明（「TME享有本翻译作品的著作权」，2026-11-25 真实数据）。 */
const isTranslationCopyright = (s: string): boolean => s.includes('翻译作品') && /著作权|版权/.test(s);
function isEnglishCreditLabel(text: string): boolean {
  const m = text.match(CREDIT_LABEL);
  return !!m && CREDIT_WORDS.test(m[1]!);
}
/** 「标签：内容」型署名（中文 / 中英双语 / 英文乐器标签；只看第一个冒号前的标签，2026-11-25 真实数据）。 */
function isLabelCredit(text: string): boolean {
  const i = text.search(/[:：]/);
  if (i <= 0) return false;
  // 去掉括号注释、汉字之间的排版空格（「编  曲」「制作人（中国）」）
  const label = text
    .slice(0, i)
    .replace(/[（(][^）)]*[）)]/g, '')
    .replace(/(?<=[㐀-鿿])\s+(?=[㐀-鿿])/g, '')
    .trim();
  if (!label || label.length > 40 || /[，。！？；…,!?;"“”]/.test(label)) return false;
  const runs = label.match(CREDIT_CN_RUN);
  if (runs) return runs.every((r) => r.length <= 10 && CREDIT_ROLE_END.test(r));
  return CREDIT_KANA.test(label) || (/^[A-Za-z0-9][A-Za-z0-9&\-\s./+']*$/.test(label) && CREDIT_WORDS.test(label));
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
  for (const raw of lines) {
    // QQ 译文里的版权声明（「TME享有本翻译作品的著作权」）：去掉译文，行本身保留
    const l = raw.translation && isTranslationCopyright(raw.translation) ? { ...raw, translation: undefined } : raw;
    const text = (l.text ?? '').replace(NOTE_CHARS, '').trim();
    if (!text) {
      // 翻译独行（原文为空、仅有翻译）保留，供主歌词下方展示；开头的先丢弃
      if (l.translation && sawText) out.push({ ...l, text: '' });
      continue;
    }
    if (NOTE_ONLY.test(text)) continue;
    if (CREDIT_CN.test(text) || CREDIT_EN.test(text) || CREDIT_OP_SP.test(text) || isEnglishCreditLabel(text)) continue;
    // 2026-11-25 真实数据：带冒号的各式标签（中文 / 中英双语 / 乐器）、Recorded at …、只有声部标记的行、QQ 翻译版权声明
    if (isLabelCredit(text) || CREDIT_RECORDED_AT.test(text) || isTranslationCopyright(text)) continue;
    const only = text.match(LABEL_ONLY);
    if (only && !LABEL_ONLY_SPEECH.test(only[1]!)) continue;
    // 「标签 + 空格 + 名字」型署名（#233）：只看行首标签 + 整行很短，正片正文首句不会被误杀
    if (CREDIT_SPACED.test(text)) continue;
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
  // 全曲最后一句正文之后的「… recorded by … at …」尾部署名：只从末尾往前剥，正文中间的 by 不受影响
  while (out.length && out[out.length - 1]!.text.length <= 140 && CREDIT_TAIL_BY.test(out[out.length - 1]!.text)) out.pop();
  return out;
}

/** 和声（后端 LyricLine.bg）防御性读入：类型不对就丢；词的时间不是有限数字的词丢掉。 */
function normalizeBg(v: unknown): LyricLineUI['bg'] {
  if (!v || typeof v !== 'object') return undefined;
  const b = v as { text?: unknown; words?: unknown };
  if (typeof b.text !== 'string' || !b.text.trim()) return undefined;
  const words = Array.isArray(b.words)
    ? b.words.flatMap((w): LyricWordUI[] => {
        const x = w as { text?: unknown; startMs?: unknown; duration?: unknown } | null;
        return x && typeof x.text === 'string' && typeof x.startMs === 'number' && Number.isFinite(x.startMs) && typeof x.duration === 'number' && Number.isFinite(x.duration)
          ? [{ text: x.text, startMs: x.startMs, duration: x.duration }]
          : [];
      })
    : [];
  return words.length ? { text: b.text, words } : { text: b.text };
}

/** 后端歌词结果（unknown）防御性归一化（从 useLyrics 挪来，好单测；#199）。 */
export function normalizeLyricLines(data: unknown, title?: string, artist?: string): LyricLineUI[] {
  if (!data || typeof data !== 'object') return [];
  const lines = (data as { lines?: unknown }).lines;
  if (!Array.isArray(lines)) return [];
  const out: LyricLineUI[] = [];
  for (const raw of lines) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as { timeMs?: unknown; text?: unknown; translation?: unknown; agent?: unknown; bg?: unknown };
    if (typeof r.timeMs !== 'number' || typeof r.text !== 'string') continue;
    const agent = r.agent === 'v1' || r.agent === 'v2' || r.agent === 'both' ? r.agent : undefined;
    const bg = normalizeBg(r.bg);
    out.push({
      timeMs: r.timeMs,
      text: r.text,
      translation: typeof r.translation === 'string' && r.translation ? r.translation : undefined,
      ...(agent ? { agent } : {}),
      ...(bg ? { bg } : {}),
    });
  }
  // 逐字歌词：yrc 优先，QQ 的 qrc 直接映射进 yrc 统一解析
  const src = data as { yrc?: unknown; qrc?: unknown; romalrc?: unknown; romanRaw?: unknown };
  const yrc = typeof src.yrc === 'string' ? src.yrc : '';
  const qrc = typeof src.qrc === 'string' ? src.qrc : '';
  // 罗马音（#161）：逐字合并之后再按时间挂，行时间已经定下来
  const roman = typeof src.romalrc === 'string' && src.romalrc ? src.romalrc : typeof src.romanRaw === 'string' ? src.romanRaw : '';
  return filterCreditLines(attachRoman(alignWordsToText(mergeWordLyrics(out, yrc || qrc)), roman), title, artist);
}
