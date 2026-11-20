import path from 'node:path';
import { createRequire } from 'node:module';
import type { Tokenizer, IpadicFeatures } from 'kuromoji';

/*
 * 日语转罗马音（#209）：kuromoji（Apache-2.0，IPADIC 词典约 17MB）分词拿读音，再按平文式（赫本式）转写。
 * - 只在别家补完后仍缺罗马音的日语行上用（见 lyricService.withJapaneseRoman），平台给了的行不动。
 * - 助词は / へ / を 读 wa / e / o；促音 っ 双写下一个辅音（ch 前写 t）；长音 ー 重复前一个元音；拗音合成一个音节。
 * - 词之间空格；助动词、接续助词（て / で / ば…）、接尾、非自立词贴在前一个词后面（「思ってる」→ omotteru）。
 * - 有汉字却查不到读音的行整行放弃（返回 null），不出半截罗马音。
 * 词典第一次用到才加载（约 0.5 秒、占内存约 100MB），之后常驻。
 */

const BASE: Record<string, string> = {
  あ:'a',い:'i',う:'u',え:'e',お:'o',か:'ka',き:'ki',く:'ku',け:'ke',こ:'ko',さ:'sa',し:'shi',す:'su',せ:'se',そ:'so',
  た:'ta',ち:'chi',つ:'tsu',て:'te',と:'to',な:'na',に:'ni',ぬ:'nu',ね:'ne',の:'no',は:'ha',ひ:'hi',ふ:'fu',へ:'he',ほ:'ho',
  ま:'ma',み:'mi',む:'mu',め:'me',も:'mo',や:'ya',ゆ:'yu',よ:'yo',ら:'ra',り:'ri',る:'ru',れ:'re',ろ:'ro',わ:'wa',ゐ:'i',ゑ:'e',を:'o',ん:'n',
  が:'ga',ぎ:'gi',ぐ:'gu',げ:'ge',ご:'go',ざ:'za',じ:'ji',ず:'zu',ぜ:'ze',ぞ:'zo',だ:'da',ぢ:'ji',づ:'zu',で:'de',ど:'do',
  ば:'ba',び:'bi',ぶ:'bu',べ:'be',ぼ:'bo',ぱ:'pa',ぴ:'pi',ぷ:'pu',ぺ:'pe',ぽ:'po',ゔ:'vu',
  ぁ:'a',ぃ:'i',ぅ:'u',ぇ:'e',ぉ:'o',ゃ:'ya',ゅ:'yu',ょ:'yo',ゎ:'wa',
};
// 拗音与外来语组合：き+ゃ → kya、し+ゃ → sha、ふ+ぁ → fa、て+ぃ → ti …
const COMBO: Record<string, string> = {
  きゃ:'kya',きゅ:'kyu',きょ:'kyo',しゃ:'sha',しゅ:'shu',しょ:'sho',ちゃ:'cha',ちゅ:'chu',ちょ:'cho',にゃ:'nya',にゅ:'nyu',にょ:'nyo',
  ひゃ:'hya',ひゅ:'hyu',ひょ:'hyo',みゃ:'mya',みゅ:'myu',みょ:'myo',りゃ:'rya',りゅ:'ryu',りょ:'ryo',ぎゃ:'gya',ぎゅ:'gyu',ぎょ:'gyo',
  じゃ:'ja',じゅ:'ju',じょ:'jo',ぢゃ:'ja',ぢゅ:'ju',ぢょ:'jo',びゃ:'bya',びゅ:'byu',びょ:'byo',ぴゃ:'pya',ぴゅ:'pyu',ぴょ:'pyo',
  しぇ:'she',ちぇ:'che',じぇ:'je',ふぁ:'fa',ふぃ:'fi',ふぇ:'fe',ふぉ:'fo',てぃ:'ti',でぃ:'di',とぅ:'tu',どぅ:'du',
  うぃ:'wi',うぇ:'we',うぉ:'wo',ゔぁ:'va',ゔぃ:'vi',ゔぇ:'ve',ゔぉ:'vo',つぁ:'tsa',つぃ:'tsi',つぇ:'tse',つぉ:'tso',いぇ:'ye',
};
const toHiragana = (s: string): string => s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
const KANA = /[ぁ-ゖァ-ヺー]/;
const KANJI = /[\p{Script=Han}々〆ヵヶ]/u;

/** 假名串 → 罗马音（不分词）。认不出的字符原样保留。 */
export function kanaToRomaji(kana: string): string {
  const s = toHiragana(kana.normalize('NFKC'));
  let out = '', geminate = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!, two = s.slice(i, i + 2);
    if (ch === 'っ') { geminate = true; continue; }
    if (ch === 'ー') { const v = out.match(/[aeiou]$/)?.[0]; out += v ?? ''; continue; }
    let syl = COMBO[two];
    if (syl) i++;
    else syl = BASE[ch];
    if (!syl) { if (geminate) geminate = false; out += ch; continue; }
    if (geminate) { out += syl.startsWith('ch') ? 't' : /^[aeiou]/.test(syl) ? '' : syl[0]; geminate = false; }
    out += syl;
  }
  return out;
}

type Tok = Pick<IpadicFeatures, 'surface_form' | 'pos' | 'pos_detail_1' | 'reading'>;
/** 一个词贴在前一个词后面（不加空格）吗。 */
function attaches(t: Tok): boolean {
  if (t.pos === '助動詞') return true;
  if (t.pos === '助詞' && t.pos_detail_1 === '接続助詞') return true;
  if (t.pos_detail_1 === '接尾' || t.pos_detail_1 === '非自立') return true;
  return false;
}
/** 分好词的一行 → 罗马音；有汉字却没有读音时返回 null。导出给回归用（不依赖词典）。 */
export function romanizeTokens(tokens: Tok[]): string | null {
  const words: string[] = [];
  // 词尾的促音（「思っ / て」）带到下一个词：双写它的第一个辅音
  let carry = false;
  const geminate = (roman: string): string => {
    if (!carry) return roman;
    carry = false;
    return roman.startsWith('ch') ? 't' + roman : /^[bcdfghjkmnprstvwz]/.test(roman) ? roman[0] + roman : roman;
  };
  const kana = (k: string): string => {
    const h = toHiragana(k);
    if (/っ$/.test(h)) { carry = true; return kanaToRomaji(h.slice(0, -1)); }
    return kanaToRomaji(h);
  };
  for (const t of tokens) {
    const surface = t.surface_form;
    if (!surface.trim()) continue;
    let roman: string;
    const pending = carry;
    carry = false;
    if (t.pos === '助詞' && (surface === 'は' || surface === 'へ' || surface === 'を')) roman = surface === 'は' ? 'wa' : surface === 'へ' ? 'e' : 'o';
    else if (t.reading && t.reading !== '*') roman = kana(t.reading);
    else if (KANJI.test(surface)) return null;
    else if (KANA.test(surface)) roman = kana(surface);
    else roman = surface; // 英文、数字、符号原样
    if (pending) { const next = carry; carry = true; roman = geminate(roman); carry = next; }
    if (/^[\p{P}\p{S}]+$/u.test(roman)) { if (words.length) words[words.length - 1] += roman; else words.push(roman); continue; }
    if (words.length && attaches(t)) words[words.length - 1] += roman;
    else words.push(roman);
  }
  const s = words.join(' ').replace(/\s+/g, ' ').trim();
  return s || null;
}

let tokenizer: Promise<Tokenizer<IpadicFeatures> | null> | null = null;
function loadTokenizer(): Promise<Tokenizer<IpadicFeatures> | null> {
  tokenizer ??= new Promise((resolve) => {
    try {
      const req = createRequire(__filename);
      const kuromoji = req('kuromoji') as typeof import('kuromoji');
      const dicPath = path.join(path.dirname(req.resolve('kuromoji/package.json')), 'dict');
      kuromoji.builder({ dicPath }).build((err, t) => resolve(err ? null : t));
    } catch {
      resolve(null);
    }
  });
  return tokenizer;
}

/** 几行日语 → 罗马音（顺序对应）；词典加载失败或某行转不了返回 null。 */
export async function romanizeJapaneseLines(texts: string[]): Promise<Array<string | null>> {
  const t = await loadTokenizer();
  if (!t) return texts.map(() => null);
  return texts.map((text) => {
    try { return romanizeTokens(t.tokenize(text.normalize('NFKC'))); } catch { return null; }
  });
}
