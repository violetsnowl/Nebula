import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),api=require('../dist-main/index.cjs');
const {romanizeKorean,hasHangul}=api;
// 依据：国语的罗马字表记法（2000 年修订版）。按发音转写，不标紧音化（학교 hakgyo、좋다 jota）；
// ㄱ/ㄷ/ㅂ/ㅈ 在音节首一律写 g/d/b/j（학교 hakgyo、국물 gungmul），收音写 k/t/p。
const cases=[
 // 基础与常见寒暄
 ['사랑해','saranghae'],['안녕하세요','annyeonghaseyo'],['감사합니다','gamsahamnida'],['너무','neomu'],
 ['내 마음','nae maeum'],['보고 싶어','bogo sipeo'],['한국어','hangugeo'],['의미','uimi'],['나를','nareul'],
 // 连音
 ['먹어','meogeo'],['없어','eopseo'],['읽어','ilgeo'],['웃음','useum'],['있어','isseo'],['사랑이','sarangi'],
 ['눈물이','nunmuri'],['부엌에','bueoke'],['밖에','bakke'],['앉아','anja'],['값이','gapsi'],['그리워','geuriwo'],
 // 鼻音化 / 流音化
 ['국물','gungmul'],['백마','baengma'],['먹는','meongneun'],['합니다','hamnida'],['십리','simni'],['종로','jongno'],
 ['신라','silla'],['설날','seollal'],['달라','dalla'],['별빛','byeolbit'],['눈물','nunmul'],['학교','hakgyo'],
 // ㅎ 相关
 ['좋아','joa'],['좋다','jota'],['놓고','noko'],['놓지','nochi'],['괜찮아','gwaenchana'],['많이','mani'],
 ['싫어','sireo'],['않다','anta'],['입학','ipak'],['어떻게','eotteoke'],['전화','jeonhwa'],['영원히','yeongwonhi'],
 // 腭化
 ['같이','gachi'],['굳이','guji'],['닫히다','dachida'],['꽃이','kkochi'],
 // 收音与双收音词尾
 ['했다','haetda'],['있는','inneun'],['닭','dak'],['삶','sam'],['읊다','eupda'],['여덟','yeodeol'],['밝고','balgo'],
 // 有取舍：꽃잎 的标准发音 [꼰닙] 含合成词 ㄴ 添加，需要词典，不做；按连音得 kkochip
 ['꽃잎','kkochip'],
 // 非韩文字符原样保留
 ['Love 사랑 (Remix)','Love sarang (Remix)'],["I'm 너의 것","I'm neoui geot"],['愛してる 사랑','愛してる sarang'],
 ['2024 안녕!','2024 annyeong!'],['Hello World','Hello World'],['','']
];
for(const [input,expected] of cases)assert.equal(romanizeKorean(input),expected,input);
assert.equal(hasHangul('Love 사랑'),true);
assert.equal(hasHangul('Hello 愛してる'),false);
assert.equal(hasHangul(''),false);
const total=cases.length+3;
console.log(`韩语罗马音回归 ${total}/${total}`);

// 接入歌词流程：只补平台没给的韩文行，署名行不转写，已有罗马音保留
{
  const lrcAt = api.lrcAt;
  const lyric = { raw: '', lines: [
    { timeMs: 0, text: '曲：안지영' },
    { timeMs: 1000, text: '사랑해' },
    { timeMs: 2000, text: '보고 싶어' },
    { timeMs: 3000, text: 'Love you' },
  ], romalrc: lrcAt(1000, 'sa rang hae') };
  const r = api.withKoreanRoman(lyric);
  assert.equal(r.romanGenerated, 1);
  assert.ok(r.romalrc.includes('sa rang hae'));
  assert.ok(r.romalrc.includes('bogo sipeo'));
  assert.ok(!r.romalrc.includes('anjiyeong'));
  assert.equal(api.withKoreanRoman({ raw: '', lines: [{ timeMs: 0, text: '中文歌' }, { timeMs: 1000, text: '사랑' }] }).romanGenerated, undefined);
  console.log('韩语罗马音接入歌词流程 2/2');
}

// #209 日语本地罗马音（kuromoji 分词 + 平文式）。例句是日常短语，不是歌词。
{
  const { kanaToRomaji, romanizeTokens, romanizeJapaneseLines, withJapaneseRoman, lrcAt } = api;
  for (const [kana, want] of [['きゃく', 'kyaku'], ['しゃしん', 'shashin'], ['ちょっと', 'chotto'], ['まって', 'matte'], ['マッチ', 'matchi'], ['ラーメン', 'raamen'], ['ふぁん', 'fan'], ['ティー', 'tii'], ['きっぷ', 'kippu'], ['つづく', 'tsuzuku']])
    assert.equal(kanaToRomaji(kana), want, kana);
  const tok = (surface_form, reading, pos = '名詞', pos_detail_1 = '一般') => ({ surface_form, reading, pos, pos_detail_1 });
  assert.equal(romanizeTokens([tok('君', 'キミ'), tok('は', 'ハ', '助詞', '係助詞'), tok('どこ', 'ドコ'), tok('へ', 'ヘ', '助詞', '格助詞')]), 'kimi wa doko e', '助詞は / へ');
  assert.equal(romanizeTokens([tok('思っ', 'オモッ', '動詞', '自立'), tok('て', 'テ', '助詞', '接続助詞'), tok('る', 'ル', '動詞', '非自立')]), 'omotteru', '接续助词、非自立贴前');
  assert.equal(romanizeTokens([tok('謎', undefined)]), null, '汉字没读音整行放弃');
  assert.equal(romanizeTokens([tok('Hello', undefined), tok('、', undefined, '記号', '読点'), tok('せかい', undefined)]), 'Hello、 sekai');
  // 真词典（本地，不联网）
  const lines = await romanizeJapaneseLines(['君の名前は', 'ちょっと待って', '東京タワー']);
  assert.deepEqual(lines, ['kimi no namae wa', 'chotto matte', 'toukyou tawaa']);
  const lyric = { raw: '', lines: [
    { timeMs: 0, text: '作詞：だれか' },
    { timeMs: 1000, text: '君の名前は' },
    { timeMs: 2000, text: 'ちょっと待って' },
    { timeMs: 3000, text: 'またあした' },
  ], romalrc: lrcAt(1000, 'kimi no namae wa (platform)') };
  const r = await withJapaneseRoman(lyric);
  assert.equal(r.romanGenerated, 2);
  assert.ok(r.romalrc.includes('kimi no namae wa (platform)'), '平台给了的行不动');
  assert.ok(r.romalrc.includes('chotto matte') && r.romalrc.includes('mata ashita'));
  assert.ok(!r.romalrc.includes('dareka'), '署名行不转');
  const zh = { raw: '', lines: [{ timeMs: 0, text: '我们的歌' }, { timeMs: 1000, text: '在这里' }] };
  assert.equal(await withJapaneseRoman(zh), zh, '中文歌不动');
  console.log('日语罗马音 6/6');
}
