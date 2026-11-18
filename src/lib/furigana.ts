/**
 * 日语假名注音（#172，NEBULA_UI_SYSTEM §7.2）：用歌词自带的罗马音反推每段汉字的读音。
 *
 * 1. 罗马音逐段转回平假名（QQ 一个音节一段 `ha na shi`、`'t` 是促音；网易云按词 `yonde`、双写辅音是促音）。
 *    转不了的段（英文词 `Baby`、`ok`）当作拉丁词。
 * 2. 原文拆成：假名（逐字）、汉字段（连续的汉字）、拉丁词；标点和空格跳过。
 * 3. 假名和拉丁词当定位点逐个对上，夹在中间的汉字段分到剩下的假名——这就是它的读音。
 *    整句要能从头对到尾才算数，对不上的句子不标（宁可不标，不标错）。
 *
 * 不需要读音词典；读音来自平台的罗马音，歌词里的特殊读法（本気＝まじ）也是对的。
 */

// 要标读音的字：汉字，以及和汉字一样要读出来的数字（「1人」＝ひとり）
const KANJI = /[㐀-䶿一-鿿豈-﫿々〆ヶ0-9０-９]/;
const KANA = /[ぁ-ゖァ-ヺー]/;
// 拉丁词：字母，词中的撇号 / 连字符 / 点（`la-la-la-`、`O.A.`）算同一个词
const LATIN = /[A-Za-z'’\-.]/;

export const isKanji = (c: string): boolean => KANJI.test(c);
export const hasKana = (s: string): boolean => KANA.test(s);

/** 片假名 → 平假名（ー 保留）。 */
function hira(c: string): string {
  const code = c.charCodeAt(0);
  return code >= 0x30a1 && code <= 0x30f6 ? String.fromCharCode(code - 0x60) : c;
}

const ROWS: Record<string, string> = {
  '': 'あいうえお',
  k: 'かきくけこ',
  g: 'がぎぐげご',
  s: 'さしすせそ',
  z: 'ざじずぜぞ',
  t: 'たちつてと',
  d: 'だぢづでど',
  n: 'なにぬねの',
  h: 'はひふへほ',
  b: 'ばびぶべぼ',
  p: 'ぱぴぷぺぽ',
  m: 'まみむめも',
  r: 'らりるれろ',
};
const TABLE: Record<string, string> = (() => {
  const t: Record<string, string> = {};
  const v = 'aiueo';
  for (const [c, kana] of Object.entries(ROWS)) for (let i = 0; i < 5; i++) t[c + v[i]] = kana[i]!;
  Object.assign(t, {
    shi: 'し', chi: 'ち', tsu: 'つ', fu: 'ふ', ji: 'じ',
    ya: 'や', yu: 'ゆ', yo: 'よ', wa: 'わ', wo: 'を', wi: 'うぃ', we: 'うぇ',
    fa: 'ふぁ', fi: 'ふぃ', fe: 'ふぇ', fo: 'ふぉ', vu: 'ゔ',
    sha: 'しゃ', shu: 'しゅ', she: 'しぇ', sho: 'しょ',
    cha: 'ちゃ', chu: 'ちゅ', che: 'ちぇ', cho: 'ちょ',
    ja: 'じゃ', ju: 'じゅ', je: 'じぇ', jo: 'じょ',
    jya: 'じゃ', jyu: 'じゅ', jyo: 'じょ',
  });
  // 拗音：子音 + y + a/u/o
  for (const c of ['k', 'g', 'n', 'h', 'b', 'p', 'm', 'r', 's', 'z', 't', 'd']) {
    const i = ROWS[c]![1]!;
    t[`${c}ya`] = `${i}ゃ`;
    t[`${c}yu`] = `${i}ゅ`;
    t[`${c}yo`] = `${i}ょ`;
  }
  return t;
})();
const VOWEL = /[aiueo]/;

/** 一段罗马音 → 平假名；转不了（英文词等）返回 null。 */
export function romajiToKana(token: string): string | null {
  const s = token.toLowerCase().replace(/[’`]/g, "'").replace(/[^a-z']/g, '');
  if (!s) return null;
  if (/^'+$/.test(s)) return 'っ';
  let out = '';
  let i = 0;
  while (i < s.length) {
    const c = s[i]!;
    if (c === "'") {
      // QQ：「'」加后面的辅音是促音（`'t`、`'k`、`'hharida`）
      if (i + 1 < s.length && !VOWEL.test(s[i + 1]!)) {
        out += 'っ';
        i += 1;
        if (/^[a-z]$/.test(s.slice(i)) || (s[i + 1] && s[i + 1] === s[i])) i += 1;
        continue;
      }
      i += 1;
      continue;
    }
    if (c === 'n' && (i + 1 === s.length || (!VOWEL.test(s[i + 1]!) && s[i + 1] !== 'y'))) {
      out += 'ん';
      i += 1;
      continue;
    }
    if (!VOWEL.test(c) && c !== 'n' && s[i + 1] === c) {
      out += 'っ';
      i += 1;
      continue;
    }
    if (c === 't' && s.startsWith('ch', i + 1)) {
      out += 'っ';
      i += 1;
      continue;
    }
    let hit = '';
    for (const len of [3, 2, 1]) {
      const k = TABLE[s.slice(i, i + len)];
      if (k) {
        hit = k;
        i += len;
        break;
      }
    }
    if (!hit) return null;
    out += hit;
  }
  return out;
}

type Seg = { k: 'kana'; c: string } | { k: 'kanji'; n: number } | { k: 'latin'; w: string };
type Ent = { c: string; start: boolean; raw: string } | { latin: string };

const SMALL: Record<string, string> = { ぁ: 'あ', ぃ: 'い', ぅ: 'う', ぇ: 'え', ぉ: 'お', ゃ: 'や', ゅ: 'ゆ', ょ: 'よ', ゎ: 'わ', ぢ: 'じ', づ: 'ず', を: 'お' };
const norm = (c: string) => SMALL[c] ?? c;
const PARTICLE: Record<string, string> = { は: 'わ', へ: 'え', を: 'お' };
const VOWEL_KANA = new Set(['あ', 'い', 'う', 'え', 'お']);
/** 外来语的「假名 + 小元音」在罗马音里常写成一个音（ウェ＝e、ディ＝di）。 */
const PAIR: Record<string, string[]> = {
  うぇ: ['え'], うぃ: ['い'], うぉ: ['お'], でぃ: ['ぢ', 'じ', 'で'], てぃ: ['ち', 'て'], どぅ: ['づ', 'ず', 'ど'], とぅ: ['つ', 'と'],
  しぇ: ['せ'], じぇ: ['ぜ'], ちぇ: ['て'],
};
const SMALL_VOWEL = new Set(['ぁ', 'ぃ', 'ぅ', 'ぇ', 'ぉ']);
const latinKey = (w: string) => w.toLowerCase().replace(/[^a-z0-9]/g, '');

function segments(text: string): Seg[] {
  const out: Seg[] = [];
  let word = '';
  const flush = () => {
    if (word) out.push({ k: 'latin', w: word });
    word = '';
  };
  for (const ch of text) {
    if (isKanji(ch)) {
      flush();
      const last = out[out.length - 1];
      if (last && last.k === 'kanji') last.n += 1;
      else out.push({ k: 'kanji', n: 1 });
    } else if (KANA.test(ch)) {
      flush();
      out.push({ k: 'kana', c: hira(ch) });
    } else if (LATIN.test(ch)) {
      word += ch;
    } else flush();
  }
  flush();
  return out;
}

function stream(roman: string): Ent[] {
  const out: Ent[] = [];
  for (const tok of roman.trim().split(/\s+/)) {
    if (!tok) continue;
    const k = romajiToKana(tok);
    if (k === null) {
      if (latinKey(tok)) out.push({ latin: latinKey(tok) });
      continue;
    }
    [...k].forEach((c, i) => out.push({ c, start: i === 0, raw: latinKey(tok) }));
  }
  return out;
}

/**
 * 原文 + 这一句的罗马音 → 每段汉字的读音（按汉字段在句中出现的顺序）。
 * 句子里没有汉字、或对不上，返回 null。
 */
export function alignFurigana(text: string, roman: string): string[] | null {
  const segs = segments(text);
  if (!segs.some((s) => s.k === 'kanji')) return null;
  const ents = stream(roman);
  // 先严格对齐；对不上再允许原文的促音 / 长音符在罗马音里没有对应（否则「意地っ張り」会被对成 意地＝い）
  for (const loose of [false, true]) {
    const out = alignWith(segs, ents, loose);
    if (out && out.length) return out;
  }
  return null;
}

function alignWith(segs: Seg[], ents: Ent[], loose: boolean): string[] | null {
  const memo = new Map<number, string[] | null>();
  const solve = (i: number, p: number): string[] | null => {
    const key = i * 4096 + p;
    if (memo.has(key)) return memo.get(key)!;
    let res: string[] | null = null;
    if (i === segs.length) {
      // 剩下的只能是多出来的促音
      res = ents.slice(p).every((e) => 'c' in e && e.c === 'っ') ? [] : null;
    } else {
      const s = segs[i]!;
      const e = ents[p];
      if (s.k === 'kana') {
        if (e && 'c' in e) {
          const ok =
            norm(e.c) === norm(s.c) ||
            PARTICLE[s.c] === e.c ||
            (s.c === 'ー' && VOWEL_KANA.has(norm(e.c)));
          if (ok) res = solve(i + 1, p + 1);
          // 「假名 + 小元音」对一个音
          const nx = segs[i + 1];
          if (!res && nx && nx.k === 'kana' && SMALL_VOWEL.has(nx.c) && PAIR[s.c + nx.c]?.includes(e.c)) res = solve(i + 2, p + 1);
        }
        // 平台偶尔省掉促音 / 长音符
        // 拖长音的小元音（ねぇ）也一样
        if (!res && loose && (s.c === 'っ' || s.c === 'ー' || SMALL_VOWEL.has(s.c))) res = solve(i + 1, p);
      } else if (s.k === 'latin') {
        if (e && 'latin' in e && e.latin === latinKey(s.w)) res = solve(i + 1, p + 1);
        else if (e && 'c' in e && e.start && e.raw === latinKey(s.w)) {
          // 英文词恰好也能读成假名（you → よう）：整段吃掉
          let q = p + 1;
          while (q < ents.length && 'c' in ents[q]! && !(ents[q] as { start: boolean }).start) q++;
          res = solve(i + 1, q);
        }
      } else {
        let kana = '';
        for (let n = 1; n <= s.n * 4 + 2 && p + n <= ents.length; n++) {
          const en = ents[p + n - 1]!;
          if (!('c' in en)) break;
          kana += en.c;
          const rest = solve(i + 1, p + n);
          if (rest) {
            res = [kana, ...rest];
            break;
          }
        }
      }
    }
    memo.set(key, res);
    return res;
  };
  return solve(0, 0);
}
