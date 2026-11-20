import http from 'node:http';
import https from 'node:https';
import type { CookieStore } from './cookieStore';
import { mediaHeaders } from './http';
import type { Platform } from './types';

const HOSTS: Array<[string, Platform]> = [
  ['music.163.com','netease'], ['music.126.net','netease'],
  ['qq.com','qq'], ['gtimg.cn','qq'], ['gtimg.com','qq'], ['qpic.cn','qq'],
  ['kugou.com','kugou'], ['kugou.com.cn','kugou'], ['kugou.net','kugou'],
  // 汽水车机协议的音频 CDN（#212）：只放 CDN 域名，接口域名（douyin.com / qishui.com 等）不进代理
  ['douyinvod.com','qishui'], ['zjcdn.com','qishui'], ['bytefcdn.com','qishui'], ['365yg.com','qishui'], ['douyinscdn.com','qishui'],
  ['bytecdn.cn','qishui'], ['byteicdn.com','qishui'], ['ibytedtos.com','qishui'], ['pstatp.com','qishui'], ['bytetos.com','qishui'],
  ['volcvideo.com','qishui'], ['volccdn.com','qishui'],
  ['kuwo.cn','kuwo'], // 波点（bodian）的试听地址也在 *.kuwo.cn；整曲域名待真实登录验证，见 bodianAdapter.fetchSongUrl 的 TODO
];
export function audioPlatform(url: URL): Platform | null {
  if (!['https:','http:'].includes(url.protocol) || url.username || url.password) return null;
  const h = url.hostname.toLowerCase();
  return HOSTS.find(([domain]) => h === domain || h.endsWith('.'+domain))?.[1] ?? null;
}

/** 仅代理受信音频域名；每一跳重新校验并生成对应平台的凭证头。 */
export class AudioProxy {
  private server: http.Server | null = null;
  private starting: Promise<void> | null = null;
  private port = 0;
  private active = 0;
  private httpAgent = new http.Agent({keepAlive:true,maxSockets:8,maxTotalSockets:16,maxFreeSockets:4});
  private httpsAgent = new https.Agent({keepAlive:true,maxSockets:8,maxTotalSockets:16,maxFreeSockets:4});
  // 注入点只供 Node 离线测试使用；IPC 不能传入。
  constructor(private cookies: CookieStore, private classify: (url: URL) => Platform | null = audioPlatform) {}
  start(): Promise<void> {
    if (this.starting) return this.starting;
    this.server = http.createServer((req,res) => { void this.handle(req,res); });
    this.server.headersTimeout = 10000;
    this.server.requestTimeout = 10000;
    this.starting = new Promise((resolve,reject) => {
      this.server!.once('error',reject);
      this.server!.listen(0,'127.0.0.1',() => {
        const addr = this.server!.address();
        if (addr && typeof addr === 'object') this.port = addr.port;
        resolve();
      });
    });
    return this.starting;
  }
  urlFor(raw: string): string {
    if (!raw || !this.port) return '';
    try {
      let url = new URL(raw);
      if (url.hostname === '127.0.0.1' && url.pathname === '/api/audio') url = new URL(url.searchParams.get('url') || '');
      if (!this.classify(url)) return '';
      return `http://127.0.0.1:${this.port}/api/audio?url=${encodeURIComponent(url.href)}`;
    } catch { return ''; }
  }
  dispose(): void {
    this.server?.closeAllConnections(); this.server?.close();
    this.httpAgent.destroy(); this.httpsAgent.destroy();
    this.server=null; this.starting=null; this.port=0;
  }
  private async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    res.setHeader('Access-Control-Allow-Origin','*');
    res.setHeader('Access-Control-Allow-Headers','Range, Content-Type');
    const fail = (status: number, message: string) => {
      if (res.destroyed || res.writableEnded) return;
      if (res.headersSent) res.destroy();
      else { res.statusCode=status; res.end(message); }
    };
    if (req.method==='OPTIONS') { res.writeHead(204); res.end(); return; }
    if (!['GET','HEAD'].includes(req.method || '')) { fail(405,'method not allowed'); return; }
    let current: URL;
    try {
      const local = new URL(req.url || '/', 'http://127.0.0.1');
      if (local.pathname !== '/api/audio') { fail(404,'not found'); return; }
      current = new URL(local.searchParams.get('url') || '');
    } catch { fail(400,'invalid url'); return; }
    const range = req.headers.range;
    if (range && !/^bytes=(?:\d+-\d*|-\d+)$/.test(range)) { fail(416,'unsupported range'); return; }
    if (this.active>=16) { fail(503,'audio connections busy'); return; }
    this.active++;
    let upstreamReq: http.ClientRequest | undefined;
    const abort = () => { if (!res.writableEnded) upstreamReq?.destroy(); };
    res.once('close',abort);
    try {
      for (let hop=0; hop<=3; hop++) {
        if (res.destroyed) return;
        const platform=this.classify(current);
        if (!platform || !['http:','https:'].includes(current.protocol) || current.username || current.password) { fail(403,'host not allowed'); return; }
        const headers: Record<string,string> = {...mediaHeaders(platform),Accept:'*/*'};
        // 跨域跳转不转发上一跳 Cookie；只按新域名读取对应平台。
        // 汽水 CDN 不需要 PC 登录 Cookie，不往外发（#212）
        const cookie=platform==='qishui'?'':this.cookies.getHeader(platform);
        if (cookie) headers.Cookie=cookie;
        if (range) headers.Range=range;
        const next = await new Promise<URL | null>(resolve => {
          let settled=false;
          const finish=(value: URL | null) => { if (!settled) { settled=true; resolve(value); } };
          const secure=current.protocol==='https:';
          upstreamReq=(secure?https:http).request(current,{
            method:req.method,headers,agent:secure?this.httpsAgent:this.httpAgent,timeout:30000,
          }, upstream => {
            const status=upstream.statusCode || 502;
            if (status>=300 && status<400) {
              let target: URL | null=null;
              try { if (hop<3 && upstream.headers.location) target=new URL(upstream.headers.location,current); } catch { /* 非法跳转 */ }
              upstream.destroy();
              if (!target) fail(502,'invalid redirect');
              finish(target); return;
            }
            res.statusCode=status;
            for (const key of ['content-type','content-length','content-range','accept-ranges','etag','cache-control']) {
              const value=upstream.headers[key]; if (value!==undefined) res.setHeader(key,value);
            }
            upstream.once('aborted',()=>{ fail(502,'upstream interrupted'); finish(null); });
            upstream.once('error',()=>{ fail(502,'upstream interrupted'); finish(null); });
            upstream.once('end',()=>finish(null));
            upstream.once('close',()=>{ if (!upstream.complete) fail(502,'upstream interrupted'); finish(null); });
            if (req.method==='HEAD') { upstream.resume(); res.end(); }
            else upstream.pipe(res);
          });
          upstreamReq.once('timeout',()=>upstreamReq?.destroy(new Error('upstream timeout')));
          upstreamReq.once('error',()=>{ fail(502,'audio upstream unavailable'); finish(null); });
          upstreamReq.once('close',()=>{ if (res.destroyed) finish(null); });
          upstreamReq.end();
        });
        if (!next) return;
        current=next;
      }
    } finally { this.active--; res.removeListener('close',abort); }
  }
}
