import assert from 'node:assert/strict';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),b=require('../dist-main/index.cjs');
const singer={name:'测试歌手'},image='https://p1.music.126.net/test.jpg';
const responses={
 netease:{playlist:{id:1,name:'公开测试',tracks:[{id:1,name:'测试曲',ar:[singer],al:{name:'测试专辑',picUrl:image},dt:180000}]}},
 qq:{cdlist:[{disstid:1,dissname:'公开测试',songlist:[{songmid:'mid',songname:'测试曲',singer:[singer],albummid:'album',albumname:'测试专辑',interval:180}]}]},
 kugou:{data:{info:[{hash:'hash',songname:'测试曲',singername:'测试歌手',album_name:'测试专辑',imgurl:'https://imgessl.kugou.com/stdmusic/{size}/test.jpg',duration:180}]}},
 spotify:{id:'test',name:'公开测试',tracks:{items:[{track:{id:'song',name:'测试曲',artists:[singer],album:{name:'测试专辑',images:[{url:'https://i.scdn.co/image/small',width:64,height:64},{url:'https://i.scdn.co/image/big',width:640,height:640}]},duration_ms:180000}}]}},
 kuwo:{id:1,title:'公开测试',pic:'http://img1.kuwo.cn/star/userpl2015/1/2/3_150.jpg',total:1,musiclist:[{id:'123',name:'测试曲',artist:'测试歌手',album:'测试专辑',albumid:'9',albumpic:'http://img2.kuwo.cn/star/albumcover/120/6/48/1.jpg',duration:'180'}]},
 qishui:{playlist:{id:'1',title:'公开测试'},media_resources:[{entity:{track_wrapper:{track:{id:'1',title:'测试曲',artists:[singer],album:{name:'测试专辑',cover:'https://p3-luna.byteimg.com/test.jpg'},duration:180000}}}}]},
};
const cookies={getHeader:p=>p==='qishui'?'SYNTHETIC=1':'',get:()=>null,onChange:()=>{}},http={requestJson:async(_url,opts)=>responses[opts.platform]};
const adapters=b.createAdapters(http,cookies),handlers=new Map();
b.registerIpcHandlers({handle:(k,f)=>handlers.set(k,f)},{adapters,cookies,resolver:{},lyricService:{},login:{},audioProxy:{urlFor:u=>u}});
const urls={netease:'https://music.163.com/#/playlist?id=1',qq:'https://y.qq.com/n/ryqq/playlist/1',kugou:'https://www.kugou.com/yy/special/single/3756318.html',spotify:'https://open.spotify.com/playlist/test',qishui:'https://www.qishui.com/playlist/1',kuwo:'https://www.kuwo.cn/playlist_detail/1'};
let n=0;
for(const platform of Object.keys(urls)){
 const r=await handlers.get('nebula:import-playlist')(null,{url:urls[platform]});assert.equal(r.ok,true,r.error);assert.equal(r.data.tracks.length,1);
 const t=r.data.tracks[0];assert.equal(t.platform,platform);assert.equal(t.title,'测试曲');assert.equal(t.duration,180);assert.equal(t.originalUrl,'');assert.equal(t.coverInfo.verified,false);
 if(platform==='spotify')assert.equal(t.coverInfo.width,640);
 n++;console.log('通过 '+platform+' 适配器→IPC 导入与封面元数据');
}
assert.deepEqual(b.resolveAdapterByUrl('https://m.kugou.com/?specialid=3756318'),{platform:'kugou',id:'3756318'});n++;
const first=responses.spotify.tracks.items[0].track;let calls=0;
const paged=new b.SpotifyAdapter({requestJson:async(url)=>url.includes('pathfinder')?{}:++calls===1?{id:'test',items:{items:[{item:first}],next:'https://api.spotify.com/v1/playlists/test/items?offset=1'}}:{items:[{item:{...first,id:'second'}},{item:{...first,id:'episode',type:'episode'}}],next:null}},cookies);
assert.equal((await paged.fetchPlaylist('test')).tracks.length,2);assert.equal(calls,2);n++;console.log('通过 Spotify 新旧字段与多页歌曲导入');
const denied=new b.SpotifyAdapter({requestJson:async(url)=>url.includes('pathfinder')?{}:({id:'test',name:'无条目权限'})},cookies);await assert.rejects(denied.fetchPlaylist('test'),/访问权限/);n++;console.log('通过 Spotify 无条目权限不伪装空歌单');
// Spotify 优先走自家查询服务（公开接口对桌面客户端身份总是 429，#171）：两页拼完整、不碰公开接口
{
  const row=(id)=>({itemV2:{data:{uri:'spotify:track:'+id,name:'测试曲',artists:{items:[{profile:{name:'测试歌手'}}]},albumOfTrack:{name:'测试专辑',coverArt:{sources:[{url:'https://i.scdn.co/image/l',width:640,height:640}]}},trackDuration:{totalMilliseconds:180000}}}});
  const seen=[];
  const pf=new b.SpotifyAdapter({requestJson:async(url,opts)=>{seen.push(url);const off=opts.body.variables.offset;return {data:{playlistV2:{name:'查询服务歌单',images:{items:[]},content:{totalCount:3,items:off===0?[row('aaaaaaaaaaaaaaaaaaaaa1'),row('aaaaaaaaaaaaaaaaaaaaa2')]:[row('aaaaaaaaaaaaaaaaaaaaa3')]}}}};}},cookies);
  const pl=await pf.fetchPlaylist('test');
  assert.equal(pl.tracks.length,3);assert.equal(pl.name,'查询服务歌单');assert.equal(pl.tracks[2].duration,180);
  assert.ok(seen.every(u=>u.includes('pathfinder')));n++;console.log('通过 Spotify 查询服务分页导入');
}
console.log(`六平台导入契约 ${n}/${n}`);
