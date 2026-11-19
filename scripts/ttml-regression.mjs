import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
// TTML 解析回归：全部离线、合成数据（句子都是自己编的，不含任何真实歌词）。依赖 pnpm build:main 产物。
const require = createRequire(import.meta.url);
const api = require('../dist-main/index.cjs');
const { parseTtml, fromTtml, parseTtmlTime, timedLines, lyricCoverage, TTML_MAX_CHARS } = api;

const say = (s) => process.stdout.write(s + '\n');
let passed = 0;
function test(name, fn) { fn(); passed++; say('通过 ' + name); }

const NS = 'xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata" xmlns:itunes="http://music.apple.com/lyric-ttml-internal"';

/* ---------- 时间格式 ---------- */
test('时间格式：hh:mm:ss.fff / mm:ss.fff / ss.fff / 带 s ms m h 后缀；非法返回 null', () => {
  assert.equal(parseTtmlTime('01:02:03.456'), 3723456);
  assert.equal(parseTtmlTime('02:03.456'), 123456);
  assert.equal(parseTtmlTime('3.5'), 3500);
  assert.equal(parseTtmlTime('3.5s'), 3500);
  assert.equal(parseTtmlTime('250ms'), 250);
  assert.equal(parseTtmlTime('2m'), 120000);
  assert.equal(parseTtmlTime('1h'), 3600000);
  assert.equal(parseTtmlTime('0:05'), 5000);
  for (const bad of ['', 'abc', '1:2:3:4', '-1', '1.2.3', null, undefined, 42, '99999999999']) assert.equal(parseTtmlTime(bad), null, String(bad));
});

/* ---------- Apple 风格 ---------- */
const appleWord = `<?xml version="1.0" encoding="UTF-8"?>
<tt ${NS} itunes:timing="Word" xml:lang="en">
  <head><metadata>
    <iTunesMetadata xmlns="http://music.apple.com/lyric-ttml-internal">
      <translations>
        <translation type="subtitle" xml:lang="fr"><text for="L1">bonjour le monde</text></translation>
        <translation type="subtitle" xml:lang="zh-Hans"><text for="L1">你好 世界</text><text for="L2">第二句译文</text></translation>
        <translation type="subtitle" xml:lang="zh-Hant"><text for="L1">繁體不該被選中</text></translation>
      </translations>
      <transliterations>
        <transliteration xml:lang="ja-Latn"><text for="L2"><span begin="0:06.000" end="0:06.500">ro</span><span begin="0:06.500" end="0:07.000">ma</span> ji</text></transliteration>
      </transliterations>
    </iTunesMetadata>
  </metadata></head>
  <body dur="0:10.000"><div begin="0:01.000" end="0:10.000">
    <p begin="0:01.000" end="0:03.000" itunes:key="L1" ttm:agent="v1"><span begin="0:01.000" end="0:01.500">Hello</span> <span begin="0:01.500" end="0:03.000">world</span></p>
    <p begin="0:06.000" end="0:08.000" itunes:key="L2" ttm:agent="v2"><span begin="0:06.000" end="0:07.000">Second</span>
      <span begin="0:07.000" end="0:08.000">line</span><span ttm:role="x-bg"><span begin="0:07.200" end="0:07.800">(echo)</span></span></p>
  </div></body>
</tt>`;

test('Apple Word：逐字、词间空格并到前一个词末尾、head 翻译优先 zh-Hans、head 罗马音、背景人声丢掉', () => {
  const r = parseTtml(appleWord);
  assert.equal(r.timing, 'Word');
  assert.equal(r.lines.length, 2);
  assert.deepEqual(r.lines[0].words.map((w) => w.text), ['Hello ', 'world']);
  assert.equal(r.lines[0].text, 'Hello world');
  assert.deepEqual(r.lines[0].words.map((w) => [w.startMs, w.duration]), [[1000, 500], [1500, 1500]]);
  assert.equal(r.lines[0].timeMs, 1000);
  assert.equal(r.lines[0].duration, 2000);
  assert.deepEqual(r.lines[1].words.map((w) => w.text), ['Second ', 'line'], '换行缩进的空白折成一个空格，背景人声不进正文');
  assert.deepEqual(r.lineRows, [{ timeMs: 1000, text: 'Hello world', key: 'L1' }, { timeMs: 6000, text: 'Second line', key: 'L2' }]);
  assert.deepEqual(r.translations, [{ timeMs: 1000, text: '你好 世界' }, { timeMs: 6000, text: '第二句译文' }]);
  assert.deepEqual(r.romans, [{ timeMs: 6000, text: 'roma ji' }]);
});

test('Apple head 翻译语言选择：没有 zh-Hans 选任意 zh，再没有选第一个', () => {
  const mk = (langs) => `<tt ${NS}><head><metadata><translations>${langs.map(([l, t]) => `<translation xml:lang="${l}"><text for="L1">${t}</text></translation>`).join('')}</translations></metadata></head><body><div><p begin="1s" end="2s" itunes:key="L1">原文</p></div></body></tt>`;
  assert.equal(parseTtml(mk([['fr', '法'], ['zh-Hant', '繁'], ['zh-Hans', '简']])).translations[0].text, '简');
  assert.equal(parseTtml(mk([['fr', '法'], ['zh-Hant', '繁']])).translations[0].text, '繁');
  assert.equal(parseTtml(mk([['fr', '法'], ['de', '德']])).translations[0].text, '法');
});

test('Apple Line：只有行时间，没有 yrc；lineRows / 翻译照常', () => {
  const xml = `<tt ${NS} itunes:timing="Line"><head><metadata><translations><translation xml:lang="zh-Hans"><text for="L2">译二</text></translation></translations></metadata></head>
    <body><div><p begin="0:05.500" end="0:08" itunes:key="L1">第一行编的</p><p begin="0:08" end="0:10" itunes:key="L2">第二行编的</p></div></body></tt>`;
  const r = parseTtml(xml);
  assert.equal(r.timing, 'Line');
  assert.deepEqual(r.lines, []);
  assert.deepEqual(r.lineRows.map((l) => [l.timeMs, l.text, l.key]), [[5500, '第一行编的', 'L1'], [8000, '第二行编的', 'L2']]);
  assert.deepEqual(r.translations, [{ timeMs: 8000, text: '译二' }]);
  const lyric = fromTtml(xml, 'applemusic');
  assert.equal(lyric.yrc, undefined);
  assert.equal(lyric.source, 'applemusic');
  assert.equal(lyric.lines[1].translation, '译二');
});

/* ---------- AMLL 风格 ---------- */
const amll = `<tt ${NS}><head><metadata><ttm:agent type="person" xml:id="v1"/></metadata></head><body><div>
  <p begin="00:01.000" end="00:03.000" ttm:agent="v1" itunes:key="L1"><span begin="00:01.000" end="00:02.000">春</span><span begin="00:02.000" end="00:03.000">风</span><span ttm:role="x-translation" xml:lang="en-US">Spring wind</span><span ttm:role="x-roman" xml:lang="zh-Latn">chun feng</span></p>
  <p begin="00:04.000" end="00:07.000" ttm:agent="v1" itunes:key="L2"><span begin="00:04.000" end="00:07.000"><span begin="00:04.000" end="00:05.000">夏</span><span begin="00:05.000" end="00:07.000">雨</span></span><span ttm:role="x-bg"><span begin="00:05.000" end="00:06.000">哦</span></span></p>
  <p begin="00:08.000" end="00:08.000" ttm:agent="v1" itunes:key="L3"><span begin="00:08.000" end="00:08.000">末</span></p>
</div></body></tt>`;

test('AMLL：行内 x-translation / x-roman 提成翻译 / 罗马音，不进正文；嵌套 span 展开；x-bg 丢掉；agent 不影响输出', () => {
  const r = parseTtml(amll);
  assert.equal(r.timing, 'Word');
  assert.deepEqual(r.lineRows.map((l) => l.text), ['春风', '夏雨', '末']);
  assert.deepEqual(r.translations, [{ timeMs: 1000, text: 'Spring wind' }]);
  assert.deepEqual(r.romans, [{ timeMs: 1000, text: 'chun feng' }]);
  assert.deepEqual(r.lines[1].words.map((w) => [w.text, w.startMs, w.duration]), [['夏', 4000, 1000], ['雨', 5000, 2000]]);
  assert.ok(!JSON.stringify(r).includes('v1'), 'agent 不进输出');
});

test('零时长的末字不丢（给 1ms），否则 timedLines 会因为 span<=0 把它丢掉', () => {
  const r = parseTtml(amll);
  assert.equal(r.lines[2].words[0].duration, 1);
  assert.equal(r.lines[2].duration, 1);
});

test('其他时间写法：p 缺 end 用 dur；span 缺 end 用 dur 或下一个词的开始；带 s 后缀', () => {
  const xml = `<tt ${NS}><body><div><p begin="1s" dur="3s"><span begin="1s" dur="500ms">甲</span><span begin="1.5s">乙</span><span begin="2.5s" end="4s">丙</span></p></div></body></tt>`;
  const r = parseTtml(xml);
  assert.deepEqual(r.lines[0].words.map((w) => [w.text, w.startMs, w.duration]), [['甲', 1000, 500], ['乙', 1500, 1000], ['丙', 2500, 1500]]);
  assert.equal(r.lines[0].timeMs, 1000);
  assert.equal(r.lines[0].duration, 3000);
});

test('英文词间空格：既有 span 之间的空白，也有 span 内部的尾随空格；行首尾去空白，连续空白折成一个', () => {
  const xml = `<tt ${NS}><body><div><p begin="0:01" end="0:04">
    <span begin="0:01" end="0:02"> Fake </span>
    <span begin="0:02" end="0:03">words</span>   <span begin="0:03" end="0:04">here </span></p></div></body></tt>`;
  const r = parseTtml(xml);
  assert.equal(r.lines[0].text, 'Fake words here');
  assert.deepEqual(r.lines[0].words.map((w) => w.text), ['Fake ', 'words ', 'here']);
});

test('实体：命名 / 十进制 / 十六进制 / 不二次展开 / 未知实体原样 / 非法码点丢掉', () => {
  const xml = `<tt ${NS}><body><div><p begin="1s" end="2s"><span begin="1s" end="2s">A&amp;B &lt;x&gt; &quot;q&quot; it&#39;s &#x4E2D;&#25991; &amp;lt; &nbsp;&#0;&#x110000;</span></p></div></body></tt>`;
  const r = parseTtml(xml);
  assert.equal(r.lineRows[0].text, 'A&B <x> "q" it\'s 中文 &lt; &nbsp;');
});

test('CDATA 与注释、XML 声明都能处理', () => {
  const xml = `<?xml version="1.0"?><!-- 注释 --><tt ${NS}><body><div><p begin="1s" end="2s"><![CDATA[a < b & c]]></p></div></body></tt>`;
  assert.equal(parseTtml(xml).lineRows[0].text, 'a < b & c');
});

/* ---------- 防护 ---------- */
test('畸形输入不抛错、返回空结果', () => {
  const bad = ['', 'not xml', '<tt>', '<tt><body></tt>', '<tt><p begin="1s"', '<tt><p begin=1s></p></tt>', '<a></a><b></b>', '</tt>', '<tt><p begin="1s">x</tt>',
    '<tt><!-- 未闭合', '<tt><![CDATA[x</tt>', '<tt a="1" a2></tt>', '<1bad/>', null, undefined, 42, {}];
  for (const x of bad) {
    const r = parseTtml(x);
    assert.deepEqual(r, { timing: 'None', lines: [], lineRows: [], translations: [], romans: [] }, JSON.stringify(x));
    assert.equal(fromTtml(x, 'amll'), null);
  }
});

test('超大输入（超过 2MB）与过深嵌套、节点过多都返回空结果', () => {
  assert.equal(TTML_MAX_CHARS, 2 * 1024 * 1024);
  const big = `<tt ${NS}><body><div><p begin="1s" end="2s">${'x'.repeat(TTML_MAX_CHARS)}</p></div></body></tt>`;
  assert.equal(parseTtml(big).timing, 'None');
  const deep = '<tt>' + '<div>'.repeat(5000) + '<p begin="1s" end="2s">x</p>' + '</div>'.repeat(5000) + '</tt>';
  assert.equal(parseTtml(deep).timing, 'None');
  const many = `<tt><body><div>${'<a/>'.repeat(450000)}</div></body></tt>`;
  assert.ok(many.length < TTML_MAX_CHARS);
  assert.equal(parseTtml(many).timing, 'None');
});

test('带 DTD / 外部实体的输入：整个文档拒绝，不抛错、不展开任何实体', () => {
  const xxe = `<?xml version="1.0"?><!DOCTYPE tt [<!ENTITY xxe SYSTEM "file:///C:/Windows/win.ini"><!ENTITY a "aaaa"><!ENTITY b "&a;&a;&a;&a;">]><tt ${NS}><body><div><p begin="1s" end="2s">&xxe;&b;</p></div></body></tt>`;
  assert.equal(parseTtml(xxe).timing, 'None');
  assert.equal(fromTtml(xxe, 'amll'), null);
  // 文档本身没有 DTD 时，写成实体引用的东西只是普通文字，不会被展开
  const plain = `<tt ${NS}><body><div><p begin="1s" end="2s">&xxe;</p></div></body></tt>`;
  assert.equal(parseTtml(plain).lineRows[0].text, '&xxe;');
});

/* ---------- fromTtml ---------- */
test('fromTtml(Word)：yrc 能被现有 timedLines 读回，lyricCoverage 逐字 / 翻译覆盖正确', () => {
  const l = fromTtml(appleWord, 'applemusic');
  assert.equal(l.source, 'applemusic');
  assert.equal(l.lines.length, 2);
  assert.equal(l.lines[0].translation, '你好 世界');
  const back = timedLines(l.yrc);
  assert.equal(back.length, 2);
  assert.deepEqual(back[0].words.map((w) => w.text), ['Hello ', 'world']);
  assert.deepEqual(lyricCoverage(l), { textLines: 2, wordLines: 2, translatedLines: 2, romanLines: 1 });
  assert.match(l.lrc, /^\[00:01\.000\]Hello world\n\[00:06\.000\]Second line$/);
  assert.match(l.romalrc, /^\[00:06\.000\]roma ji$/);
  assert.equal(l.romanRaw, l.romalrc);
  assert.equal(l.translationRaw, l.tlyric);
});

test('fromTtml(AMLL)：含零时长末字的歌词，逐字覆盖仍是满的', () => {
  const l = fromTtml(amll, 'amll');
  assert.equal(l.source, 'amll');
  assert.deepEqual(lyricCoverage(l), { textLines: 3, wordLines: 3, translatedLines: 1, romanLines: 1 });
});

test('fromTtml：没有正文返回 null；Line 不给 yrc', () => {
  assert.equal(fromTtml(`<tt ${NS}><body><div></div></body></tt>`, 'amll'), null);
  assert.equal(fromTtml(`<tt ${NS}><body><div><p>没有时间的行</p></div></body></tt>`, 'amll'), null);
  const l = fromTtml(`<tt ${NS}><body><div><p begin="1s" end="2s">只有行时间</p></div></body></tt>`, 'amll');
  assert.equal(l.yrc, undefined);
  assert.equal(l.lines.length, 1);
});

test('p 的 begin 晚于首字时，行时间取更早者，yrc 仍能读回', () => {
  const l = fromTtml(`<tt ${NS}><body><div><p begin="2s" end="5s"><span begin="1.9s" end="3s">早</span><span begin="3s" end="5s">字</span></p></div></body></tt>`, 'amll');
  assert.equal(l.lines[0].timeMs, 1900);
  assert.equal(timedLines(l.yrc)[0].words.length, 2);
});

say(`TTML 解析回归 ${passed}/${passed}`);
