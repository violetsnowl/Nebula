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
function artists(t:Track):Set<string> {
  const source=[...(t.artists?.length?t.artists:[t.artist])];
  const feat=cleanMetadataText(t.title).match(/(?:feat\.?|featuring)\s+([^()（）\[\]]+)/i);if(feat)source.push(feat[1]!);
  return new Set(source.flatMap(s=>withoutArtistAlias(s).split(/\s*(?:\/|、|，|,|&|\bfeat\.?\b|\bfeaturing\b|\bx\b)\s*/i)).map(s=>canonicalArtist(s)).filter(s=>s && !/^(未知歌手|unknownartist|variousartists)$/.test(s)));
}
// 「版」和伴奏 / 语种 / 器乐 / 剪辑类词都算版本：国语版≠粤语版，Off Vocal 与原曲同长也不能顶替。
const VERSION=/\b(live|remix|mix|remaster(?:ed)?|acoustic|instrumental|inst\.?|off\s*vocal|karaoke|cover|demo|edit|ver\.?|version|dj|the\s+first\s+take|tv\s*size|short|extended|clean|piano|guitar|orchestral?|sped\s*up|slowed|mono|stereo|\d+(?:\.\d+)?x)\b|版|现场|現場|演唱会|演唱會|伴奏|纯音乐|純音樂|翻唱|混音|重制|重製|重录|重錄|不插电|不插電|加速|降速|改编|改編|钢琴|鋼琴|吉他|女声|女聲|男声|男聲|片段|铃声|鈴聲|抖音/i;
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
  if (VERSION.test(s)) return true;
  if (CJK.test(s)) return false;
  return !CJK.test(full.replace(NOTES,''));
}
function title(t:Track):{names:Set<string>;version:string} {
  const versions:string[]=[];
  const full=cleanMetadataText(t.title).normalize('NFKC');
  let base=full.replace(NOTES,(_whole,...groups)=>{
    const s=groups.slice(0,3).find(x=>typeof x==='string' && x) || '';
    if (versionNote(s,full)) versions.push(versionText(s));
    return ' ';
  });
  const suffix=base.match(/\s[-–—]\s(.+)$/);
  if (suffix && VERSION.test(suffix[1]!)) {versions.push(versionText(suffix[1]!));base=base.slice(0,suffix.index);}
  const bare=base.match(/\s+(live|remix|remaster(?:ed)?|instrumental|karaoke|acoustic|demo|the\s+first\s+take|dj(?:\s*版)?|网友改编|純音樂|纯音乐|伴奏|\d{4}\s+mix)\s*$/i);
  if (bare) {versions.push(versionText(bare[1]!));base=base.slice(0,bare.index);}
  const aliases=Array.isArray(t.extra?.titleAliases)?t.extra.titleAliases.filter((x):x is string=>typeof x==='string'):[];
  return {names:new Set([base,...aliases].map(identityText).filter(Boolean)),version:versions.filter(Boolean).sort().join('|')};
}
/** 兜底搜索词：去掉译名、Explicit 等不构成版本的括注和歌手末尾的读音别名；版本括注保留。 */
export function searchKeyword(t:Track):string {
  const raw=cleanMetadataText(t.title).normalize('NFKC');
  const name=raw.replace(NOTES,(whole,...groups)=>versionNote(groups.slice(0,3).find(x=>typeof x==='string' && x) || '',raw)?whole:' ').replace(/\s+/g,' ').trim();
  return `${name || raw} ${withoutArtistAlias(t.artists?.[0] || t.artist || '')}`.trim();
}
export interface MatchDecision { ok:boolean; score:number; rank:number; note:string }
/** 共用的录音身份门禁：标题、全部歌手、版本、时长都满足才打分。 */
export function recordingMatch(candidate:Track,target:Track):MatchDecision {
  const no=(note:string):MatchDecision=>({ok:false,score:0,rank:9,note});
  const a=title(candidate),b=title(target);
  if (!a.names.size || ![...a.names].some(n=>b.names.has(n))) return no('title');
  if (a.version!==b.version) return no('version');
  const ca=artists(candidate),ta=artists(target);
  if (!ca.size || !ta.size || ca.size!==ta.size || [...ca].some(n=>!ta.has(n))) return no('artists');
  const duration=Number(target.duration),other=Number(candidate.duration),known=duration>0 && other>0;
  const diff=Math.abs(duration-other);
  if (known && diff>Math.max(2,Math.min(6,duration*.02))) return no('duration');
  const album=identityText(target.album),sameAlbum=!!album && album===identityText(candidate.album);
  if (!known && !sameAlbum) return no('missing-duration');
  const score=.92+(known?Math.max(0,.04-diff*.005):0)+(sameAlbum?.04:0);
  return {ok:true,score:Math.min(1,score),rank:sameAlbum?0:1,note:sameAlbum?'recording-album':'recording'};
}
export const matchScore=(candidate:Track,target:Track):number=>recordingMatch(candidate,target).score;
