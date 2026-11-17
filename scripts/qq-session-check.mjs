// 只读取仓库外的凭据副本；只写脱敏诊断，不写回Cookie、不输出账号ID或带签名URL。
// node scripts/qq-session-check.mjs --profile=../qq-copy --samples=../qq-samples.json --out=../qq-session.json
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),api=require('../dist-main/index.cjs');
const root=path.resolve(import.meta.dirname,'..');
const args=Object.fromEntries(process.argv.slice(2).map(a=>{const i=a.indexOf('=');return [a.slice(2,i<0?undefined:i),i<0?true:a.slice(i+1)];}));
const print=console.log.bind(console);
console.log=console.warn=console.error=console.info=console.debug=()=>{};
function outside(value){const file=path.resolve(root,String(value)),rel=path.relative(root,file);if(!rel || (!rel.startsWith('..'+path.sep)&&!path.isAbsolute(rel)))throw Error('outside');return file;}
function emit(out,value){fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,JSON.stringify(value,null,2));print(JSON.stringify({authStatus:value.authStatus,rightsKnown:!!value.rights,tracks:value.rows.length,diagnostic:value.status}));}
try {
  if(!args.profile || args.cookie)throw Error('profile');
  const profile=outside(args.profile),out=outside(args.out || '../qq-session-result.json');
  if(out.toLowerCase()===path.join(profile,'cookies.json').toLowerCase() || (args.samples && out.toLowerCase()===outside(args.samples).toLowerCase()))throw Error('output');
  const cookies=new api.CookieStore(path.join(profile,'cookies.json')),cookie=cookies.getHeader('qq') || '';
  const credential=api.qqCredential(cookie),http=new api.HttpClient(cookies),calls=[];
  const result={at:new Date().toISOString(),status:'completed',authStatus:'missing',credentials:{identityPresent:credential.uin!=='0',keyField:credential.keyName || null,loginType:credential.loginType},refreshMetadata:{},rights:null,calls,rows:[]};
  const fields=Object.fromEntries(cookie.split(';').map(p=>{const i=p.indexOf('=');return [p.slice(0,i).trim().toLowerCase(),p.slice(i+1).trim()];}));
  for(const [name,names] of Object.entries({refreshToken:['refresh_token','psrf_qqrefresh_token','wxrefresh_token'],refreshKey:['refresh_key'],openid:['openid','psrf_qqopenid','wxopenid'],unionid:['unionid','psrf_qqunionid']}))result.refreshMetadata[name+'Present']=names.some(k=>!!fields[k]);
  const request=http.requestJson.bind(http);
  http.requestJson=async(url,options)=>{
    const at=performance.now();
    const entries=Object.entries(options.body || {}).filter(([key,v])=>key!=='comm' && v && typeof v==='object' && typeof v.module==='string');
    try {
      const response=await request(url,options);
      for(const [key,part] of entries)calls.push({module:part.module,method:part.method,code:typeof response?.[key]?.code==='number'?response[key].code:null,rootCode:typeof response?.code==='number'?response.code:null,ms:Math.round(performance.now()-at)});
      return response;
    } catch(error){for(const [,part] of entries)calls.push({module:part.module,method:part.method,result:error?.code==='TIMEOUT'?'timeout':'network',ms:Math.round(performance.now()-at)});throw error;}
  };
  if(!api.validatePlatformCookie('qq',cookie).ok){result.status='not-run-missing-credential';emit(out,result);process.exitCode=2;}
  else {
    result.authStatus=await api.qqSession(http).check(cookie,true);
    const rights=await new api.QqRightsService(http).getRights(cookie);
    result.authStatus=api.qqSession(http).peek(cookie);
    result.rights=rights?{known:rights.known,isVip:rights.isVip,isSvip:rights.isSvip,vipType:rights.vipType,expiresAt:rights.expiresAt}:null;
    const samples=args.samples?JSON.parse(fs.readFileSync(outside(args.samples),'utf8')):[];
    if(!Array.isArray(samples))throw Error('samples');
    const adapter=new api.QqAdapter(http,cookies);
    for(const [index,t] of samples.slice(0,Math.min(80,Number(args.limit || 10))).entries()){
      if(t.platform!=='qq' || !t.sourceId)continue;
      for(const quality of ['128k','320k','flac']){
        const start=performance.now();
        try {
          const source=await adapter.fetchSongUrl(String(t.sourceId),t.extra?.albumId,quality,t.extra);
          const probe=source?.url?await api.probeAudioUrl(source.url,{platform:'qq',cookie}):null;
          result.rows.push({index,requestedQuality:quality,returnedQuality:source?.quality || null,playable:!!source?.url && !!probe?.ok,code:source?.code || null,trial:!!source?.trial,expiresAt:source?.expiresAt || null,ms:Math.round(performance.now()-start)});
        } catch {result.rows.push({index,requestedQuality:quality,playable:false,code:'NETWORK',ms:Math.round(performance.now()-start)});}
      }
    }
    result.authStatus=api.qqSession(http).peek(cookie);emit(out,result);
    if(result.authStatus!=='valid')process.exitCode=2;
  }
} catch {print('诊断未完成：必须指定仓库外的 --profile 凭据副本；--samples 和 --out 也必须在仓库外。未输出凭据或原始异常。');process.exitCode=2;}
