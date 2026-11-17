// 韩文转罗马音：国语的罗马字表记法（2000 年修订版，Revised Romanization），按发音转写。
// 已实现音变：连音、鼻音化、流音化、送气化（含 ㅎ 脱落）、腭化、双收音的代表音与连音。
// 刻意不做：紧音化（RR 本身不标）、ㄴ 添加（꽃잎 [꼰닢]，需要词典）、ㅢ 的 [e]/[i] 变读、汉字词流音化例外。

const INITIALS = ['ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'];
const FINALS = ['', 'ㄱ', 'ㄲ', 'ㄳ', 'ㄴ', 'ㄵ', 'ㄶ', 'ㄷ', 'ㄹ', 'ㄺ', 'ㄻ', 'ㄼ', 'ㄽ', 'ㄾ', 'ㄿ', 'ㅀ', 'ㅁ', 'ㅂ', 'ㅄ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'];
const VOWELS = ['a', 'ae', 'ya', 'yae', 'eo', 'e', 'yeo', 'ye', 'o', 'wa', 'wae', 'oe', 'yo', 'u', 'wo', 'we', 'wi', 'yu', 'eu', 'ui', 'i'];
const VOWEL_I = 20;

const INITIAL_ROMAN: Record<string, string> = {
  ㄱ: 'g', ㄲ: 'kk', ㄴ: 'n', ㄷ: 'd', ㄸ: 'tt', ㄹ: 'r', ㅁ: 'm', ㅂ: 'b', ㅃ: 'pp', ㅅ: 's',
  ㅆ: 'ss', ㅇ: '', ㅈ: 'j', ㅉ: 'jj', ㅊ: 'ch', ㅋ: 'k', ㅌ: 't', ㅍ: 'p', ㅎ: 'h',
};
const FINAL_ROMAN: Record<string, string> = { ㄱ: 'k', ㄴ: 'n', ㄷ: 't', ㄹ: 'l', ㅁ: 'm', ㅂ: 'p', ㅇ: 'ng' };
// 收音归并到 7 个代表音
const REPRESENTATIVE: Record<string, string> = {
  ㄱ: 'ㄱ', ㄲ: 'ㄱ', ㅋ: 'ㄱ', ㄴ: 'ㄴ', ㄷ: 'ㄷ', ㅅ: 'ㄷ', ㅆ: 'ㄷ', ㅈ: 'ㄷ', ㅊ: 'ㄷ', ㅌ: 'ㄷ', ㅎ: 'ㄷ',
  ㄹ: 'ㄹ', ㅁ: 'ㅁ', ㅂ: 'ㅂ', ㅍ: 'ㅂ', ㅇ: 'ㅇ',
};
// 双收音：[保留的前一个, 后一个]
const COMPOUND: Record<string, [string, string]> = {
  ㄳ: ['ㄱ', 'ㅅ'], ㄵ: ['ㄴ', 'ㅈ'], ㄶ: ['ㄴ', 'ㅎ'], ㄺ: ['ㄹ', 'ㄱ'], ㄻ: ['ㄹ', 'ㅁ'], ㄼ: ['ㄹ', 'ㅂ'],
  ㄽ: ['ㄹ', 'ㅅ'], ㄾ: ['ㄹ', 'ㅌ'], ㄿ: ['ㄹ', 'ㅍ'], ㅀ: ['ㄹ', 'ㅎ'], ㅄ: ['ㅂ', 'ㅅ'],
};
// 双收音在辅音前读哪一个（ㄺ 在 ㄱ 前读 ㄹ 另行处理）
const COMPOUND_BEFORE_CONSONANT: Record<string, string> = {
  ㄳ: 'ㄱ', ㄵ: 'ㄴ', ㄺ: 'ㄱ', ㄻ: 'ㅁ', ㄼ: 'ㄹ', ㄽ: 'ㄹ', ㄾ: 'ㄹ', ㄿ: 'ㅂ', ㅄ: 'ㅂ',
};
const ASPIRATE_AFTER_H: Record<string, string> = { ㄱ: 'ㅋ', ㄷ: 'ㅌ', ㅈ: 'ㅊ' };
const PALATALIZE: Record<string, string> = { ㄷ: 'ㅈ', ㅌ: 'ㅊ' };

const HANGUL_SYLLABLE = /[가-힣]/;
const HANGUL_RUN = /[가-힣]+/g;

interface Syllable { l: string; v: number; t: string }

export function hasHangul(text: string): boolean {
  return HANGUL_SYLLABLE.test(text);
}

function applyBoundary(a: Syllable, b: Syllable | undefined): void {
  if (!a.t) return;
  if (!b) { a.t = REPRESENTATIVE[COMPOUND_BEFORE_CONSONANT[a.t] ?? COMPOUND[a.t]?.[0] ?? a.t]; return; }
  const original = a.t;
  // 连音：收音后接 ㅇ 开头的音节，收音（或双收音的后一个）移到下一音节
  if (b.l === 'ㅇ') {
    if (original === 'ㅇ') return;
    const pair = COMPOUND[original] ?? ['', original];
    const [keep, move] = pair[1] === 'ㅎ' && original !== 'ㅎ' ? ['', pair[0]] : pair; // ㄶ/ㅀ：ㅎ 脱落，前一个收音连读
    a.t = keep;
    if (move !== 'ㅎ') b.l = b.v === VOWEL_I ? PALATALIZE[move] ?? move : move; // 腭化：ㄷ/ㅌ + 이
    return;
  }
  let keep = original;
  if (COMPOUND[original]) {
    const [first, second] = COMPOUND[original];
    if (second === 'ㅎ') {
      keep = first;
      if (ASPIRATE_AFTER_H[b.l]) b.l = ASPIRATE_AFTER_H[b.l]; // 않고 → anko、싫다 → silta
    } else keep = original === 'ㄺ' && b.l === 'ㄱ' ? 'ㄹ' : COMPOUND_BEFORE_CONSONANT[original];
  } else if (original === 'ㅎ') {
    // ㅎ 收音：与 ㄱ/ㄷ/ㅈ 合成送气音，遇 ㅅ/ㅎ 脱落，其余按代表音 ㄷ
    if (ASPIRATE_AFTER_H[b.l]) { b.l = ASPIRATE_AFTER_H[b.l]; keep = ''; }
    else if (b.l === 'ㅅ' || b.l === 'ㅎ') keep = '';
  } else if (b.l === 'ㅎ') {
    // ㄱ/ㄷ/ㅂ 系收音 + ㅎ → 送气音；ㄷ/ㅌ + 히 → 치
    const rep = REPRESENTATIVE[original];
    if (rep === 'ㄱ') { b.l = 'ㅋ'; keep = ''; }
    else if (rep === 'ㅂ') { b.l = 'ㅍ'; keep = ''; }
    else if (rep === 'ㄷ') { b.l = b.v === VOWEL_I && (original === 'ㄷ' || original === 'ㅌ') ? 'ㅊ' : 'ㅌ'; keep = ''; }
  }
  let rep = keep ? REPRESENTATIVE[keep] : '';
  if (rep) {
    // 流音化与鼻音化
    if (b.l === 'ㄹ') {
      if ('ㅁㅇㄱㅂㄷ'.includes(rep)) b.l = 'ㄴ'; // 심리 simni、국립 gungnip
      else if (rep === 'ㄴ') rep = 'ㄹ'; // 신라 silla
    } else if (b.l === 'ㄴ' && rep === 'ㄹ') b.l = 'ㄹ'; // 설날 seollal
    if (b.l === 'ㄴ' || b.l === 'ㅁ') rep = ({ ㄱ: 'ㅇ', ㄷ: 'ㄴ', ㅂ: 'ㅁ' } as Record<string, string>)[rep] ?? rep;
  }
  a.t = rep;
}

function romanizeRun(run: string): string {
  const syllables: Syllable[] = [...run].map(ch => {
    const code = ch.charCodeAt(0) - 0xac00;
    return { l: INITIALS[Math.floor(code / 588)], v: Math.floor((code % 588) / 28), t: FINALS[code % 28] };
  });
  syllables.forEach((s, i) => applyBoundary(s, syllables[i + 1]));
  let out = '';
  let prevFinal = '';
  for (const s of syllables) {
    out += (s.l === 'ㄹ' && prevFinal === 'ㄹ' ? 'l' : INITIAL_ROMAN[s.l]) + VOWELS[s.v] + (FINAL_ROMAN[s.t] ?? '');
    prevFinal = s.t;
  }
  return out;
}

export function romanizeKorean(text: string): string {
  return text.replace(HANGUL_RUN, romanizeRun);
}
