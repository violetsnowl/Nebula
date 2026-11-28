import type { Track } from '../types';
import { cleanMetadataText } from '../parsers/metadataText';

// 小范围、可审计的别名；未知译名不自动音译。仅做明确的等价归一化。
const ALIASES = [['椎名林檎','しいなりんご','シイナリンゴ','Shiina Ringo','Ringo Shiina'], ['宇多田ヒカル','Hikaru Utada','Utada Hikaru'], ['周杰伦','周杰倫','Jay Chou'],['BTS','防弹少年团','防彈少年團']];
const TRAD='愛樂風雲夢時後來說聽見過還這個為與無聲會開關讓淚從滿飛遠離憶戶戸橋優葉幾澤櫻遙廣邊應當華國萬詩畫書語點線雙單戀誰實現發變轉動靜響龍氣電鐵銀鐘門問間獨傷歲絲終結連網絕綠紅藍黃';
const SIMP='爱乐风云梦时后来说听见过还这个为与无声会开关让泪从满飞远离忆户户桥优叶几泽樱遥广边应当华国万诗画书语点线双单恋谁实现发变转动静响龙气电铁银钟门问间独伤岁丝终结连网绝绿红蓝黄';
export function identityText(text: string): string {
  // 去掉拉丁字母的重音符号（Sofía / Sofia、Cécile / Cecile；#206）。只删 U+0300–036F，日文浊点 U+3099 不动
  return cleanMetadataText(text).normalize('NFKC').normalize('NFD').replace(/[̀-ͯ]/g,'').normalize('NFC').toLowerCase()
    .replace(/[ァ-ヶ]/g,c=>String.fromCharCode(c.charCodeAt(0)-0x60))
    .replace(/[\p{L}\p{N}]/gu,c=>{const i=TRAD.indexOf(c);return i<0?c:SIMP[i]!})
    .replace(/[^\p{L}\p{N}]/gu,'');
}
const aliasMap = new Map(ALIASES.flatMap(group => group.map(n => [identityText(n),identityText(group[0]!)] as const)));
function withoutArtistAlias(value:string):string {
  let s=cleanMetadataText(value).normalize('NFKC');
  // QQ 的末尾括注常为读音/别名；feat/合作名单仍保留并参与集合比较。
  for (;;) {
    const match=s.match(/^(.+?)\s*\(([^()]*)\)\s*$/);
    if(!match || /\b(?:feat\.?|featuring|with)\b/i.test(match[2]!))return s;
    s=match[1]!.trim();
  }
}
const canonicalArtist=(s:string):string=>aliasMap.get(identityText(withoutArtistAlias(s))) || identityText(withoutArtistAlias(s));
const rawArtists=(t:Track):string[]=>[...(t.artists?.length?t.artists:[t.artist])].map(s=>String(s??''));
/** 拆开后的每位歌手（未归一化），按出现顺序（第一位当主唱）。#205 起 `\`、`;`、`；` 也拆（汽水 / QQ 有这样拼的）。 */
function artistPieces(t:Track):string[] {
  const source=rawArtists(t);
  const feat=cleanMetadataText(t.title).match(/(?:feat\.?|featuring)\s+([^()（）\[\]]+)/i);if(feat)source.push(feat[1]!);
  // 拆的时候保留末尾括号（QQ 的原名 / 读音，见 artistForms）；归一化名 canonicalArtist 自己会去掉它
  return source.flatMap(s=>cleanMetadataText(s).normalize('NFKC').split(/\s*(?:\/|\\|;|；|、|，|,|&|\bfeat\.?\b|\bfeaturing\b|\bx\b)\s*/i))
    .filter((s,i,all)=>{const id=canonicalArtist(s);return id && !/^(未知歌手|unknownartist|variousartists)$/.test(id) && all.findIndex(x=>canonicalArtist(x)===id)===i;});
}
// 频道名前后缀（#206）：「Official Blue」「EminemMusic」「Aimer Official YouTube Channel」「VEVO」「- Topic」「公式」
const CHANNEL_AFFIX=/^(?:official)+|(?:official|youtube|channel|vevo|topic|music|公式チャンネル|公式|オフィシャル)+$/;
const CJK_RUN=/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}ー々]+|[\p{Script=Latin}\p{N}][\p{Script=Latin}\p{N}\s.'’&+-]*/gu;
/**
 * 一位歌手的几种写法（#206）：归一化名、去掉频道前后缀的名；中英文写在一起的（「Kenshi Yonezu 米津玄師」「星野源 Gen Hoshino」
 * 「볼빨간사춘기 BOL4」）再按文字拆成各段，每段都算这位歌手的写法。
 */
function artistForms(piece:string):string[] {
  const id=canonicalArtist(piece),forms=new Set([id]);
  const bare=id.replace(CHANNEL_AFFIX,'');if(bare.length>=2)forms.add(bare);
  // QQ 把原名 / 读音写在括号里（「脸红的思春期 (볼빨간사춘기)」「Aimer (エメ)」）：括号里的也算这位的写法（#211）
  const paren=cleanMetadataText(piece).normalize('NFKC').match(/\(([^()]+)\)\s*$/);
  if (paren && !/\b(?:feat\.?|featuring|with)\b/i.test(paren[1]!)) {const f=canonicalArtist(paren[1]!);if(f.length>=2)forms.add(f);}
  const runs=withoutArtistAlias(piece).normalize('NFKC').match(CJK_RUN)||[];
  if (runs.length>1 && runs.some(r=>CJK.test(r)) && runs.some(r=>!CJK.test(r)))
    for (const r of runs) {const f=canonicalArtist(r).replace(CHANNEL_AFFIX,'');if(f.length>=2)forms.add(f);}
  return [...forms];
}
// 「版」和伴奏 / 语种 / 器乐 / 剪辑类词都算版本：国语版≠粤语版，Off Vocal 与原曲同长也不能顶替。
const VERSION=/\b(live|unplugged|remix|mix|remaster(?:ed)?|acoustic|instrumental|inst\.?|off\s*vocal|karaoke|cover|demo|edit|ver\.?|version|dj|the\s+first\s+take|tv\s*size|short|extended|clean|piano|guitar|orchestral?|sped\s*up|slowed|mono|stereo|\d+(?:\.\d+)?x)\b|版|现场|現場|演唱会|演唱會|伴奏|纯音乐|純音樂|翻唱|混音|重制|重製|重录|重錄|不插电|不插電|加速|降速|改编|改編|钢琴|鋼琴|吉他|女声|女聲|男声|男聲|片段|铃声|鈴聲|抖音/i;
// #205：卡拉 OK、翻唱说明也算版本（以前「（カラオケ）」「（翻自 某某）」这类中日文括注被当成译名，只靠歌手不同挡住）
const EXTRA_VERSION=/カラオケ|翻自|歌ってみた|弾いてみた|原曲歌手|\bcovered\s+by\b/i;
// #325：演出 / 演唱会 / 巡演 / 晚会等场次说明无论是否在括注末尾都属于非录音室版本（如「2023 FEAR and DREAMS世界巡回演唱会上海站」）
const CJK_LIVE_EVENT=/演唱会|演唱會|巡演|巡回|巡迴|音乐节|音樂節|音乐会|音樂會|联欢晚会|聯歡晚會|跨年晚会|跨年晚會|春晚|现场版|現場版|纯享|純享|消音|饭拍|飯拍|直拍/;
// #205：只说「原版 / 专辑版」的不算版本（网易云「前前前世 [original ver.]」就是原曲）
// （Single Version 常是剪短的单曲版，仍算版本）
// （「Original Mix」是电子乐的原版，#211 起也不算版本；Radio Edit / Extended Mix 仍算）
const PLAIN_VERSION=/^\s*(?:(?:original|album)\s*(?:ver\.?|version|mix)?|原版|原曲|专辑版|專輯版)\s*$/i;
// #205：出处说明不算版本（「 - From "La La Land" Soundtrack」「（Music from the FIFA World Cup …）」）
const SOURCE_NOTE=/^\s*(?:from\b|theme\s+(?:song\s+)?(?:from|of)\b|(?:original\s+)?(?:motion\s+picture\s+)?soundtrack|ost\b|music\s+from\b|电影|電影|电视剧|電視劇|动画|動畫|《)/i;
const HARD_VERSION=/\b(?:live|unplugged|remix|mix|instrumental|inst\.?|karaoke|acoustic|cover|off\s*vocal)\b|现场|現場|伴奏|翻唱|カラオケ|演唱会|演唱會|巡演|巡回|巡迴|音乐节|音樂節|音乐会|音樂會|春晚|跨年晚会|跨年晚會/i;
const notVersion=(s:string):boolean=>PLAIN_VERSION.test(s) || (SOURCE_NOTE.test(s) && !HARD_VERSION.test(s));
function versionText(s:string):string {
  return identityText(s.replace(/现场(?:版)?|現場(?:版)?|演唱[会會](?:版)?/g,'live').replace(/remastered/gi,'remaster').replace(/伴奏(?:版)?/g,'instrumental'));
}
const CJK=/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const CJK_ALL=/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+/gu;
// 中日文括注里的版本词要在末尾（「钢琴版」「2014 某某现场」），整句译名里碰巧含「伴奏」等字的不算（「任命友人A为我的伴奏者」，#211）
const CJK_VERSION_END=/(?:版|现场|現場|演唱会|演唱會|伴奏|纯音乐|純音樂|翻唱|混音|重制|重製|重录|重錄|不插电|不插電|加速|降速|改编|改編|钢琴|鋼琴|吉他|女声|女聲|男声|男聲|片段|铃声|鈴聲)\s*$/;
const VERSION_LATIN=/\b(live|unplugged|remix|mix|remaster(?:ed)?|acoustic|instrumental|inst\.?|off\s*vocal|karaoke|cover|demo|edit|ver\.?|version|dj|the\s+first\s+take|tv\s*size|short|extended|clean|piano|guitar|orchestral?|sped\s*up|slowed|mono|stereo|\d+(?:\.\d+)?x)\b/i;
const NOTES=/\(([^()]*)\)|\[([^\[\]]*)\]|【([^【】]*)】/g;
/**
 * 括注是否构成版本约束：版本词一定算；feat / Explicit 不算；
 * 中日韩文括注多为译名或出处，不算；英文括注只在标题本身是中日韩文（英文译名）时不算，
 * 英文标题后认不出的英文括注（如酷狗的 kwinst）保守地算版本。
 */
function versionNote(note:string,full:string):boolean {
  const s=note.trim();
  if (!s || /^(?:feat\.?|featuring|with)\s/i.test(s) || /^explicit$/i.test(s)) return false;
  if (notVersion(s)) return false;
  if (EXTRA_VERSION.test(s) || CJK_LIVE_EVENT.test(s)) return true;
  if (CJK.test(s)) return VERSION_LATIN.test(s.replace(CJK_ALL,' ')) || CJK_VERSION_END.test(s) || (s.length<=4 && VERSION.test(s));
  if (VERSION.test(s)) return true;
  return !CJK.test(full.replace(NOTES,''));
}
function title(t:Track):{names:Set<string>;version:string;cjk:boolean} {
  const versions:string[]=[],alt:string[]=[];
  const full=cleanMetadataText(t.title).normalize('NFKC');
  const plainCjk=CJK.test(full.replace(NOTES,' '));
  let base=full.replace(NOTES,(_whole,...groups)=>{
    const s=groups.slice(0,3).find(x=>typeof x==='string' && x) || '';
    if (versionNote(s,full)) versions.push(versionText(s));
    // 另一种文字的括注多是译名（「행복 (Happiness)」「ダンスホール（Dance Hall）」「The Other Side（天堂彼岸）」），也算歌名的一种写法（#211）
    else if (s.trim() && !/^(?:feat\.?|featuring|with)\s/i.test(s.trim()) && !/^explicit$/i.test(s.trim()) && CJK.test(s)!==plainCjk) alt.push(s);
    return ' ';
  });
  const suffix=base.match(/\s[-–—]\s(.+)$/);
  // 「 - 副标题」：是版本就记版本；不是（出处、feat、副标题）就当说明去掉，和「（副标题）」写法同等对待（#205）
  if (suffix) {
    const note=suffix[1]!;
    if (!notVersion(note) && (VERSION.test(note) || EXTRA_VERSION.test(note) || CJK_LIVE_EVENT.test(note))) versions.push(versionText(note));
    base=base.slice(0,suffix.index);
  }
  const bare=base.match(/\s+(live|remix|remaster(?:ed)?|instrumental|karaoke|acoustic|demo|the\s+first\s+take|dj(?:\s*版)?|网友改编|純音樂|纯音乐|伴奏|\d{4}\s+mix)\s*$/i);
  if (bare) {versions.push(versionText(bare[1]!));base=base.slice(0,bare.index);}
  const aliases=Array.isArray(t.extra?.titleAliases)?t.extra.titleAliases.filter((x):x is string=>typeof x==='string'):[];
  return {names:new Set([base,...alt,...aliases].map(identityText).filter(Boolean)),version:versions.filter(Boolean).sort().join('|'),cjk:CJK.test(base)};
}
/** 提取录音标题归一化分桶键，与 `recordingMatch` 标题门禁保持一致，用于 $O(N)$ 去重索引。 */
export function titleKeys(t:Track):string[] {
  return [...title(t).names];
}
/** 兜底搜索词：去掉译名、Explicit 等不构成版本的括注和歌手末尾的读音别名；版本括注保留。 */
export function searchKeyword(t:Track):string {
  const raw=cleanMetadataText(t.title).normalize('NFKC');
  const name=raw.replace(NOTES,(whole,...groups)=>versionNote(groups.slice(0,3).find(x=>typeof x==='string' && x) || '',raw)?whole:' ').replace(/\s+/g,' ').trim();
  return `${name || raw} ${withoutArtistAlias(t.artists?.[0] || t.artist || '')}`.trim();
}
export interface MatchDecision { ok:boolean; score:number; rank:number; note:string }
const LATIN=/[a-z]/i;
const latinOnly=(s:string):boolean=>LATIN.test(s) && !CJK.test(s);
const cjkOnly=(s:string):boolean=>CJK.test(s) && !LATIN.test(s);
/**
 * 歌手怎么对上的（#205，用户 2026-11-19 定：放宽的排在完全一致的后面）：
 * - exact：两边名单一样。
 * - loose：歌手名按宽松写法比（见下）后，一方是另一方的子集，且写得全的那边的主唱在另一边
 *   （Spotify 写全合作歌手、对方只写主唱，或反过来；「甲 / 乙」对「甲」认，对「乙」不认）。
 *   宽松写法 = artistForms 里任一写法相同，或一方是另一方的开头（频道名「Aimer Official YouTube Channel」对「Aimer」）。
 * - script：名单对不上，但时长相同（差 <1 秒）、两边歌手人数相同、两边歌手名是不同文字（#211 起不再要求歌名含中日韩文）
 *   （一边全是拉丁字母、一边全是中日韩文，如 Kenshi Yonezu / 米津玄師）。
 */
function artistFit(c:Track,t:Track,diff:number|null):'exact'|'loose'|'script'|null {
  const cp=artistPieces(c),tp=artistPieces(t);
  const ca=new Set(cp.map(canonicalArtist)),ta=new Set(tp.map(canonicalArtist));
  if (!ca.size || !ta.size) return null;
  if (ca.size===ta.size && [...ca].every(n=>ta.has(n))) return 'exact';
  const longEnough=(x:string,y:string)=>Math.min(x.length,y.length)>=(CJK.test(x+y)?2:3);
  const near=(x:string[],y:string[])=>x.some(a=>y.some(b=>a===b || ((a.startsWith(b)||b.startsWith(a)) && longEnough(a,b))));
  const cf=cp.map(artistForms),tf=tp.map(artistForms);
  // 写得全的那边（人数多；一样多时取目标）当 large，它的第一位是主唱
  const [small,large]=cf.length<tf.length?[cf,tf]:[tf,cf];
  if (small.every(s=>large.some(l=>near(s,l))) && small.some(s=>near(s,large[0]!))) return 'loose';
  const rc=rawArtists(c).join(' '),rt=rawArtists(t).join(' ');
  // 时长要相同（差 <1 秒）：#205 实测认对的 23 首里 22 首差 0 秒，认错的翻唱差 1 秒。
  // 两边歌手人数要相同（#211）：英文歌名也放开后（Apple 中国区把西方歌手写成中文名：艾薇儿 / Avril Lavigne），
  // 261 首候选里认对 12 首；认错的「三位原唱 → 单人翻唱、时长恰好相同」人数都不一样。
  if (diff!==null && diff<1 && cp.length===tp.length && ((latinOnly(rc)&&cjkOnly(rt))||(cjkOnly(rc)&&latinOnly(rt)))) return 'script';
  return null;
}
/** 共用的录音身份门禁：标题、歌手、版本、时长都满足才打分。rank 越小越优先：歌手 exact 0 / loose 2 / script 4，不同专辑再 +1。 */
export function recordingMatch(candidate:Track,target:Track):MatchDecision {
  const no=(note:string):MatchDecision=>({ok:false,score:0,rank:9,note});
  const a=title(candidate),b=title(target);
  if (!a.names.size || ![...a.names].some(n=>b.names.has(n))) return no('title');
  if (a.version!==b.version) return no('version');
  const duration=Number(target.duration),other=Number(candidate.duration),known=duration>0 && other>0;
  const diff=Math.abs(duration-other);
  const fit=artistFit(candidate,target,known?diff:null);
  if (!fit) return no('artists');
  if (known && diff>Math.max(2,Math.min(6,duration*.02))) return no('duration');
  const album=identityText(target.album),sameAlbum=!!album && album===identityText(candidate.album);
  if (!known && !sameAlbum) return no('missing-duration');
  const score=.92+(known?Math.max(0,.04-diff*.005):0)+(sameAlbum?.04:0);
  const tier=fit==='exact'?0:fit==='loose'?2:4;
  return {ok:true,score:Math.min(1,score),rank:tier+(sameAlbum?0:1),note:(sameAlbum?'recording-album':'recording')+(fit==='exact'?'':`-${fit}`)};
}
export const matchScore=(candidate:Track,target:Track):number=>recordingMatch(candidate,target).score;
