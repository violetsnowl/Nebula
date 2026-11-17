// 从公开榜单准备 100 首固定样本；不读取用户歌单或凭据。
import fs from 'node:fs';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),b=require('../dist-main/index.cjs'),print=console.log.bind(console);
console.log=console.info=console.warn=console.error=console.debug=()=>{};
const charts=[['zh','3778678'],['ja','5059644681'],['en','2809513713'],['ko','745956260']],rows=[];
for(const [language,id] of charts){
 const r=await b.callNcmSafe('playlist_track_all',{id,limit:40,offset:0});
 const raw=r?.body?.songs||[];
 for(const song of raw.slice(0,25)){const t=b.mapNeteaseTrack(song);if(t)rows.push({...t,language,playlistId:id,languageBasis:'公开语种榜单；个别英文歌名不能证明歌词语种',rightsHint:{fee:song.fee??null,noCopyright:!!song.noCopyrightRcmd}});}
 print(language+': '+raw.length);
}
fs.writeFileSync(new URL('./fixtures/public-playlists.json',import.meta.url),JSON.stringify(rows,null,2));print('公开榜单样本 '+rows.length);process.exit(rows.length===100?0:1);
