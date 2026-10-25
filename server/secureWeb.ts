import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import http from 'node:http';
import https from 'node:https';
import type { HttpContext, Retrieved } from './http';

const agent='SiteBite-Web/0.3 (+http://localhost:3000; public discovery)';
type Address={address:string;family:number};
type WireResponse={status:number;headers:Record<string,string|undefined>;body:string};
type Dependencies={resolve:(host:string)=>Promise<Address[]>;transport:(url:URL,address:Address,signal:AbortSignal,maxBytes:number)=>Promise<WireResponse>;spacing?:number};

/** Conservative public-unicast policy: also reject documentation and transition ranges. */
export function isPublicAddress(address:string):boolean {
  if(isIP(address)===4){
    if(address==='168.63.129.16')return false; // Azure platform virtual IP; never a discovery source.
    const [a,b,c]=address.split('.').map(Number);
    return !(a===0||a===10||a===127||a>=224||a===169&&b===254||a===172&&b>=16&&b<=31||a===192&&(b===168||b===0||b===2||b===88&&c===99)||a===100&&b>=64&&b<=127||a===198&&(b===18||b===19||b===51&&c===100)||a===203&&b===0&&c===113);
  }
  if(isIP(address)!==6)return false;
  const normalized=new URL(`http://[${address}]/`).hostname.slice(1,-1).toLowerCase();
  const first=parseInt(normalized.split(':')[0],16);
  const second=parseInt(normalized.split(':')[1]||'0',16);
  return first>=0x2000&&first<0x3fff&&!(first===0x2001&&(second<0x200||second===0xdb8))&&first!==0x2002;
}
export function publicUrl(raw:string):URL {
  const url=new URL(raw);
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.port&&!['80','443'].includes(url.port))throw new Error('公開來源網址協定或連接埠不允許');
  const host=url.hostname.replace(/^\[|\]$/g,'');
  if(host==='localhost'||host.endsWith('.localhost')||host.endsWith('.local')||host.endsWith('.internal')||isIP(host)&&!isPublicAddress(host))throw new Error('禁止存取內部或保留網路位址');
  url.hash='';return url;
}
function apiAllowed(url:URL){
  const h=url.hostname;
  let configured='';try{configured=new URL(process.env.SEARXNG_URL??'').host;}catch{}
  return /^(?:[a-z0-9-]+\.)?(?:wikipedia|wikivoyage)\.org$/.test(h)&&url.pathname==='/w/api.php'
    ||h==='www.wikidata.org'&&(url.pathname==='/w/api.php'||/^\/wiki\/Special:EntityData\/Q\d+\.json$/.test(url.pathname))
    ||h==='query.wikidata.org'&&url.pathname==='/sparql'
    ||h==='data.cityofnewyork.us'&&url.pathname==='/resource/43nn-pn8j.json'
    ||Boolean(configured&&url.host===configured&&url.pathname.endsWith('/search'));
}
function cancellable<T>(promise:Promise<T>,signal:AbortSignal):Promise<T>{
  signal.throwIfAborted();return new Promise((resolve,reject)=>{const abort=()=>reject(signal.reason);signal.addEventListener('abort',abort,{once:true});promise.then(resolve,reject).finally(()=>signal.removeEventListener('abort',abort));});
}
function expression(pattern:string){return new RegExp('^'+pattern.split('*').map(v=>v.replace(/[.+?^${}()|[\]\\]/g,'\\$&')).join('.*').replace(/\\\$$/,'$'));}
/** robots rules use longest matching rule; equally specific Allow wins. */
function applicableRobots(text:string){
  type Group={agents:string[];rules:Array<{allow:boolean;path:string}>;delays:number[];directives:boolean};
  const groups:Group[]=[];let group:Group|undefined;
  for(const raw of text.split(/\r?\n/)){
    const line=raw.split('#')[0].trim();const colon=line.indexOf(':');if(colon<0)continue;
    const key=line.slice(0,colon).toLowerCase(),value=line.slice(colon+1).trim();
    if(key==='user-agent'){if(!group||group.directives){group={agents:[],rules:[],delays:[],directives:false};groups.push(group);}group.agents.push(value.toLowerCase());}
    else if(group){group.directives=true;if(['allow','disallow'].includes(key)&&value)group.rules.push({allow:key==='allow',path:value});if(key==='crawl-delay'&&/^\d+(?:\.\d+)?$/.test(value)&&Number.isFinite(Number(value)))group.delays.push(Number(value));}
  }
  const specific=groups.filter(g=>g.agents.some(a=>a!=='*'&&'sitebite-web'.includes(a)));
  return specific.length?specific:groups.filter(g=>g.agents.includes('*'));
}
export function robotsCrawlDelay(text:string):number{return Math.max(0,...applicableRobots(text).flatMap(g=>g.delays));}
export function robotsPermits(text:string,url:URL):boolean {
  const applicable=applicableRobots(text);
  const path=url.pathname+url.search;
  const matched=applicable.flatMap(g=>g.rules).filter(r=>expression(r.path).test(path)).sort((a,b)=>b.path.length-a.path.length||Number(b.allow)-Number(a.allow));
  return matched[0]?.allow??true;
}
const nativeTransport:Dependencies['transport']=(url,address,signal,maxBytes)=>new Promise((resolve,reject)=>{
  const request=(url.protocol==='https:'?https:http).request(url,{method:'GET',signal,headers:{'User-Agent':agent,Accept:'text/html,application/json,text/plain;q=0.9','Accept-Encoding':'identity'},lookup:((_host:unknown,options:unknown,callback:unknown)=>{
    const cb=callback as (...args:unknown[])=>void;
    if((options as {all?:boolean}).all)cb(null,[address]);else cb(null,address.address,address.family);
  }) as NonNullable<http.RequestOptions['lookup']>},response=>{
    let size=0;const chunks:Buffer[]=[];const headers:Record<string,string|undefined>={};for(const [key,value]of Object.entries(response.headers))headers[key]=Array.isArray(value)?value.join(','):value;
    if(Number(headers['content-length'])>maxBytes){response.destroy();request.destroy(new Error('公開來源回應超過大小限制'));return;}
    response.on('data',(chunk:Buffer)=>{size+=chunk.length;if(size>maxBytes){response.destroy();request.destroy(new Error('公開來源回應超過大小限制'));}else chunks.push(chunk);});
    response.on('error',reject);response.on('end',()=>resolve({status:response.statusCode??0,headers,body:Buffer.concat(chunks).toString('utf8')}));
  });
  request.on('error',reject);request.end();
});

export function createPublicFetcher(dependencies:Dependencies){
  const cache=new Map<string,{expires:number;value:Retrieved<string>}>();
  const robotsCache=new Map<string,{expires:number;text:string}>();
  const lanes=new Map<string,Promise<void>>();const cooldown=new Map<string,number>();
  const crawlDelays=new Map<string,number>();const nextAllowed=new Map<string,number>();
  async function waitUntilAllowed(host:string,signal:AbortSignal){
    while((nextAllowed.get(host)??0)>Date.now()){
      const remaining=(nextAllowed.get(host)??0)-Date.now();
      await new Promise<void>((resolve,reject)=>{signal.throwIfAborted();const abort=()=>{clearTimeout(timer);reject(signal.reason);};const timer=setTimeout(()=>{signal.removeEventListener('abort',abort);resolve();},Math.min(remaining,60000));signal.addEventListener('abort',abort,{once:true});});
    }
  }
  async function wire(url:URL,ctx:HttpContext,maxBytes:number):Promise<WireResponse>{
    ctx.signal.throwIfAborted();
    const prior=lanes.get(url.host)??Promise.resolve();let release!:()=>void;const tail=new Promise<void>(r=>release=r);const lane=prior.then(()=>tail);lanes.set(url.host,lane);
    try{
      await cancellable(prior,ctx.signal);ctx.signal.throwIfAborted();
      await waitUntilAllowed(url.host,ctx.signal);
      if((cooldown.get(url.host)??0)>Date.now())throw new Error('公開來源 HTTP 429/403 冷卻中');
      const signal=AbortSignal.any([ctx.signal,AbortSignal.timeout(12000)]);
      const host=url.hostname.replace(/^\[|\]$/g,'');const addresses=isIP(host)?[{address:host,family:isIP(host)}]:await cancellable(dependencies.resolve(host),signal);
      if(!addresses.length||addresses.some(a=>!isPublicAddress(a.address)))throw new Error('禁止存取內部或保留網路位址');
      if(ctx.budget.used>=ctx.budget.limit)throw new Error('已達公開服務請求預算');ctx.budget.used++;if(ctx.meter)ctx.meter.requests++;
      const result=await cancellable(dependencies.transport(url,addresses[0],signal,maxBytes),signal);
      if(Buffer.byteLength(result.body)>maxBytes)throw new Error('公開來源回應超過大小限制');
      if([403,429].includes(result.status))cooldown.set(url.host,Date.now()+60000);
      return result;
    }finally{nextAllowed.set(url.host,Date.now()+Math.max(dependencies.spacing??1100,crawlDelays.get(url.host)??0));setTimeout(release,dependencies.spacing??1100);if(lanes.get(url.host)===lane)lane.finally(()=>{if(lanes.get(url.host)===lane)lanes.delete(url.host);});}
  }
  async function robots(url:URL,ctx:HttpContext){
    const hit=robotsCache.get(url.origin);let text=hit&&hit.expires>Date.now()?hit.text:undefined;
    if(text===undefined){
      const robotUrl=new URL('/robots.txt',url);const response=await chain(robotUrl,ctx,256000,false,false,url.origin);
      if(response.status===404||response.status===410)text='';else if(response.status===200&&!/<html|captcha|access denied/i.test(response.body))text=response.body;else throw new Error('無法確認 robots.txt 政策，停止讀取公開頁面');
      robotsCache.set(url.origin,{text,expires:Date.now()+3600000});
      const delay=robotsCrawlDelay(text)*1000;crawlDelays.set(url.host,delay);nextAllowed.set(url.host,Math.max(nextAllowed.get(url.host)??0,Date.now()+delay));
    }
    if(!robotsPermits(text,url))throw new Error('robots.txt 不允許讀取此公開頁面');
  }
  async function chain(start:URL,ctx:HttpContext,maxBytes:number,checkRobots:boolean,api:boolean,robotsOrigin?:string){
    let url=start;
    for(let hop=0;hop<=4;hop++){
      if(robotsOrigin&&url.origin!==robotsOrigin)throw new Error('robots.txt 重新導向至不同來源，停止讀取');
      if(api&&!apiAllowed(url))throw new Error('未授權的公開 API 來源');
      if(checkRobots)await robots(url,ctx);
      const response=await wire(url,ctx,maxBytes);
      if([301,302,303,307,308].includes(response.status)){
        if(!response.headers.location)throw new Error('公開來源重新導向缺少目的地');
        url=publicUrl(new URL(response.headers.location,url).href);continue;
      }
      return {...response,url:url.href};
    }
    throw new Error('公開來源重新導向次數過多');
  }
  return async function fetchPublicText(raw:string,ctx:HttpContext,options:{api?:boolean;maxBytes?:number;ttl?:number}={}):Promise<Retrieved<string>>{
    const url=publicUrl(raw);if(options.api&&!apiAllowed(url))throw new Error('未授權的公開 API 來源');ctx.signal.throwIfAborted();
    const maxBytes=Math.min(options.maxBytes??2000000,2000000);
    const key=url.href+Boolean(options.api);const hit=cache.get(key);if(hit&&hit.expires>Date.now()){if(Buffer.byteLength(hit.value.data)>maxBytes)throw new Error('公開來源回應超過大小限制');return {...hit.value,cached:true};}
    let response=await chain(url,ctx,maxBytes,!options.api,Boolean(options.api));
    if([502,503].includes(response.status)){await new Promise(r=>setTimeout(r,500));ctx.signal.throwIfAborted();response=await chain(url,ctx,maxBytes,!options.api,Boolean(options.api));}
    if(response.status!==200)throw new Error(`公開來源 HTTP ${response.status}`);
    if(/(?:captcha|verify you are human|access denied|request rejected|sign in to continue)/i.test(response.body.slice(0,16000)))throw new Error('公開來源要求驗證或限制自動存取，未繞過封鎖');
    const value={data:response.body,url:response.url,retrievedAt:new Date().toISOString(),cached:false};
    if(cache.size>=100)cache.delete(cache.keys().next().value!);cache.set(key,{value,expires:Date.now()+(options.ttl??3600000)});return value;
  };
}
export const fetchPublicText=createPublicFetcher({resolve:host=>lookup(host,{all:true,verbatim:true}),transport:nativeTransport});
