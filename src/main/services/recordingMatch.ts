import type { Track } from '../types';
import { cleanMetadataText } from '../parsers/metadataText';

// 小范围、可审计的别名；未知译名不自动音译。仅做明确的等价归一化。
const ALIASES = [['椎名林檎','しいなりんご','シイナリンゴ','Shiina Ringo','Ringo Shiina'], ['宇多田ヒカル','Hikaru Utada','Utada Hikaru'], ['周杰伦','周杰倫','Jay Chou'],['BTS','防弹少年团','防彈少年團']];
const TRAD='愛樂風雲夢時後來說聽見過還這個為與無聲會開關讓淚從滿飛遠離憶';
const SIMP='爱乐风云梦时后来说听见过还这个为与无声会开关让泪从满飞远离忆';
export function identityText(text: string): string {
  return cleanMetadataText(text).normalize('NFKC').toLowerCase()
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
/** 歌手名单，按出现顺序（第一位当主唱）。#205 起 `\`、`;`、`；` 也拆（汽水 / QQ 有这样拼的）。 */
function artistList(t:Track):string[] {
  const source=rawArtists(t);
  const feat=cleanMetadataText(t.title).match(/(?:feat\.?|featuring)\s+([^()（）\[\]]+)/i);if(feat)source.push(feat[1]!);
  return source.flatMap(s=>withoutArtistAlias(s).split(/\s*(?:\/|\\|;|；|、|，|,|&|\bfeat\.?\b|\bfeaturing\b|\bx\b)\s*/i)).map(s=>canonicalArtist(s)).filter(s=>s && !/^(未知歌手|unknownartist|variousartists)$/.test(s));
}
// 「版」和伴奏 / 语种 / 器乐 / 剪辑类词都算版本：国语版≠粤语版，Off Vocal 与原曲同长也不能顶替。
const VERSION=/\b(live|remix|mix|remaster(?:ed)?|acoustic|instrumental|inst\.?|off\s*vocal|karaoke|cover|demo|edit|ver\.?|version|dj|the\s+first\s+take|tv\s*size|short|extended|clean|piano|guitar|orchestral?|sped\s*up|slowed|mono|stereo|\d+(?:\.\d+)?x)\b|版|现场|現場|演唱会|演唱會|伴奏|纯音乐|純音樂|翻唱|混音|重制|重製|重录|重錄|不插电|不插電|加速|降速|改编|改編|钢琴|鋼琴|吉他|女声|女聲|男声|男聲|片段|铃声|鈴聲|抖音/i;
// #205：卡拉 OK、翻唱说明也算版本（以前「（カラオケ）」「（翻自 某某）」这类中日文括注被当成译名，只靠歌手不同挡住）
const EXTRA_VERSION=/カラオケ|翻自|歌ってみた|弾いてみた|原曲歌手|\bcovered\s+by\b/i;
// #205：只说「原版 / 专辑版」的不算版本（网易云「前前前世 [original ver.]」就是原曲）
// （Single Version 常是剪短的单曲版，仍算版本）
const PLAIN_VERSION=/^\s*(?:(?:original|album)\s*(?:ver\.?|version)?|原版|原曲|专辑版|專輯版)\s*$/i;
// #205：出处说明不算版本（「 - From "La La Land" Soundtrack」「（Music from the FIFA World Cup …）」）
const SOURCE_NOTE=/^\s*(?:from\b|theme\s+(?:song\s+)?(?:from|of)\b|(?:original\s+)?(?:motion\s+picture\s+)?soundtrack|ost\b|music\s+from\b|电影|電影|电视剧|電視劇|动画|動畫|《)/i;
const HARD_VERSION=/\b(?:live|remix|mix|instrumental|inst\.?|karaoke|acoustic|cover|off\s*vocal)\b|现场|現場|伴奏|翻唱|カラオケ/i;
const notVersion=(s:string):boolean=>PLAIN_VERSION.test(s) || (SOURCE_NOTE.test(s) && !HARD_VERSION.test(s));
function versionText(s:string):string {
  return identityText(s.replace(/现场(?:版)?|現場(?:版)?|演唱[会會](?:版)?/g,'live').replace(/remastered/gi,'remaster').replace(/伴奏(?:版)?/g,'instrumental'));
}
const CJK=/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
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
  if (VERSION.test(s) || EXTRA_VERSION.test(s)) return true;
  if (CJK.test(s)) return false;
  return !CJK.test(full.replace(NOTES,''));
}
function title(t:Track):{names:Set<string>;version:string;cjk:boolean} {
  const versions:string[]=[];
  const full=cleanMetadataText(t.title).normalize('NFKC');
  let base=full.replace(NOTES,(_whole,...groups)=>{
    const s=groups.slice(0,3).find(x=>typeof x==='string' && x) || '';
    if (versionNote(s,full)) versions.push(versionText(s));
    return ' ';
  });
  const suffix=base.match(/\s[-–—]\s(.+)$/);
  // 「 - 副标题」：是版本就记版本；不是（出处、feat、副标题）就当说明去掉，和「（副标题）」写法同等对待（#205）
  if (suffix) {
    const note=suffix[1]!;
    if (!notVersion(note) && (VERSION.test(note) || EXTRA_VERSION.test(note))) versions.push(versionText(note));
    base=base.slice(0,suffix.index);
  }
  const bare=base.match(/\s+(live|remix|remaster(?:ed)?|instrumental|karaoke|acoustic|demo|the\s+first\s+take|dj(?:\s*版)?|网友改编|純音樂|纯音乐|伴奏|\d{4}\s+mix)\s*$/i);
  if (bare) {versions.push(versionText(bare[1]!));base=base.slice(0,bare.index);}
  const aliases=Array.isArray(t.extra?.titleAliases)?t.extra.titleAliases.filter((x):x is string=>typeof x==='string'):[];
  return {names:new Set([base,...aliases].map(identityText).filter(Boolean)),version:versions.filter(Boolean).sort().join('|'),cjk:CJK.test(base)};
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
 * - loose：一方是另一方的子集，且写得全的那边的主唱在另一边（Spotify 写全合作歌手、对方只写主唱，或反过来）；
 *   或每位歌手名都是对方某位的开头（YouTube 频道名「Aimer Official YouTube Channel」对「Aimer」）。
 * - script：名单对不上，但歌名含中日韩文、时长相同（差 <1 秒）、两边歌手名是不同文字
 *   （一边全是拉丁字母、一边全是中日韩文，如 Kenshi Yonezu / 米津玄師）。
 */
function artistFit(c:Track,t:Track,cjkTitle:boolean,diff:number|null):'exact'|'loose'|'script'|null {
  const cl=artistList(c),tl=artistList(t),ca=new Set(cl),ta=new Set(tl);
  if (!ca.size || !ta.size) return null;
  if (ca.size===ta.size && [...ca].every(n=>ta.has(n))) return 'exact';
  // 写得全的那边的主唱（第一位）必须在另一边：「甲 / 乙」对「甲」认，对「乙」不认
  const [small,large,main]=ca.size<=ta.size?[ca,ta,tl[0]!]:[ta,ca,cl[0]!];
  if ([...small].every(n=>large.has(n)) && small.has(main)) return 'loose';
  const longEnough=(x:string,y:string)=>Math.min(x.length,y.length)>=(CJK.test(x+y)?2:3);
  const covers=(xs:string[],ys:string[])=>xs.every(x=>ys.some(y=>(x.startsWith(y)||y.startsWith(x)) && longEnough(x,y)));
  if (covers(cl,tl) && covers(tl,cl)) return 'loose';
  const rc=rawArtists(c).join(' '),rt=rawArtists(t).join(' ');
  // 时长要相同（差 <1 秒）：#205 实测认对的 23 首里 22 首差 0 秒，认错的翻唱差 1 秒
  if (cjkTitle && diff!==null && diff<1 && ((latinOnly(rc)&&cjkOnly(rt))||(cjkOnly(rc)&&latinOnly(rt)))) return 'script';
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
  const fit=artistFit(candidate,target,a.cjk && b.cjk,known?diff:null);
  if (!fit) return no('artists');
  if (known && diff>Math.max(2,Math.min(6,duration*.02))) return no('duration');
  const album=identityText(target.album),sameAlbum=!!album && album===identityText(candidate.album);
  if (!known && !sameAlbum) return no('missing-duration');
  const score=.92+(known?Math.max(0,.04-diff*.005):0)+(sameAlbum?.04:0);
  const tier=fit==='exact'?0:fit==='loose'?2:4;
  return {ok:true,score:Math.min(1,score),rank:tier+(sameAlbum?0:1),note:(sameAlbum?'recording-album':'recording')+(fit==='exact'?'':`-${fit}`)};
}
export const matchScore=(candidate:Track,target:Track):number=>recordingMatch(candidate,target).score;
