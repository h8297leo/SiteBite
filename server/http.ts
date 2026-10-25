import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

export type RequestBudget = { used:number; limit:number };
export type HttpContext = { signal:AbortSignal; budget:RequestBudget; meter?:{requests:number}; deadline?:number };
export type Retrieved<T> = { data:T; retrievedAt:string; cached:boolean; url:string };
const directory=new URL('../.cache/core-v2/',import.meta.url);
const lanes=new Map<string,Promise<void>>();
const cooldown=new Map<string,number>();
const failures=new Map<string,string>();
export class SourceError extends Error{
 constructor(readonly code:string,message:string,readonly retryAt?:number){super(message);this.name='SourceError';}
}
export function sourceFailure(error:unknown):SourceError{
 if(error instanceof SourceError)return error;
 const e=error as {name?:string;message?:string;code?:string;cause?:{code?:string}};
 const code=e?.cause?.code??e?.code;
 if(e?.name==='TimeoutError')return new SourceError('timeout','來源查詢逾時');
 if(e?.name==='AbortError')return new SourceError('cancelled','使用者取消搜尋');
 const status=e?.message?.match(/HTTP\s*(\d{3})/)?.[1];if(status)return new SourceError(status==='429'?'rate-limit':Number(status)>=500?'server-error':`http-${status}`,`來源 HTTP ${status}`);
 if(['ENOTFOUND','EAI_AGAIN'].includes(code??''))return new SourceError('dns','來源 DNS 解析失敗');
 if(e?.name==='SyntaxError')return new SourceError('json','來源 JSON 格式錯誤');
 if(e?.name==='ZodError')return new SourceError('schema','來源 JSON 欄位格式錯誤');
 if(e?.message?.includes('預算'))return new SourceError('budget','搜尋請求預算耗盡');
 if(/拒絕自動存取|robots|驗證或限制/.test(e?.message??''))return new SourceError('access','來源政策或驗證限制，未繞過');
 if(e?.message?.includes('大小限制'))return new SourceError('size','來源回應超過大小限制');
 return new SourceError('connection','來源 DNS 以外的連線失敗');
}
export function sourceCircuit(url:string){const u=new URL(url),endpoint=u.origin+u.pathname,key=(cooldown.get(u.host)??0)>(cooldown.get(endpoint)??0)?u.host:endpoint;return{retryAt:cooldown.get(key)??0,code:failures.get(key)??'circuit-open'};}
export function retryDelay(value:string|null|undefined,minimum:number){
  const delay=value?.trim()?(Number.isFinite(Number(value))?Number(value)*1000:Date.parse(value)-Date.now()):0;
  return Number.isFinite(delay)?Math.max(minimum,delay):minimum;
}
export function abortable<T>(promise:Promise<T>,signal:AbortSignal):Promise<T>{
  signal.throwIfAborted();return new Promise((resolve,reject)=>{
    const abort=()=>reject(signal.reason);signal.addEventListener('abort',abort,{once:true});
    promise.then(resolve,reject).finally(()=>signal.removeEventListener('abort',abort));
  });
}
export function serviceError(error:unknown){
  if(error instanceof Error&&/HTTP|拒絕自動存取|大小限制/.test(error.message))return error.message;
  return sourceFailure(error).message;
}
export function redactDiagnostic(value:string){
 return value.replace(/https?:\/\/[^\s<>]+/g,raw=>{try{const u=new URL(raw);u.username='';u.password='';for(const key of u.searchParams.keys())if(/key|token|secret|password|signature|authorization/i.test(key))u.searchParams.set(key,'REDACTED');return u.href;}catch{return '[無效來源網址]';}});
}
export async function requestJson<T>(url:string,ctx:HttpContext,parse:(raw:unknown)=>T,options:RequestInit={},ttl=600000,decode:(r:Response)=>Promise<unknown>=r=>r.json()):Promise<Retrieved<T>>{
  const host=new URL(url).host;
  const key=createHash('sha256').update(url+String(options.body??'')).digest('hex');
  const file=new URL(key+'.json',directory);
  const cached=async()=>{try{const c=JSON.parse(await readFile(file,'utf8'));if(c.expires>Date.now())return{data:parse(c.data),retrievedAt:c.retrievedAt,cached:true,url};}catch{}return null;};
  ctx.signal.throwIfAborted();const hit=await cached();if(hit)return hit;
  const prior=lanes.get(host)??Promise.resolve();let release!:()=>void;
  const tail=new Promise<void>(r=>release=r);const lane=prior.then(()=>tail);lanes.set(host,lane);
  try{
    await abortable(prior,ctx.signal);ctx.signal.throwIfAborted();const queuedHit=await cached();if(queuedHit)return queuedHit;
    const circuit=sourceCircuit(url);if(circuit.retryAt>Date.now())throw new SourceError(circuit.code,'來源冷卻中，未再次請求',circuit.retryAt);
    if(ctx.budget.used>=ctx.budget.limit)throw new Error('已達公開服務請求預算');ctx.budget.used++;if(ctx.meter)ctx.meter.requests++;
    const response=await fetch(url,{...options,headers:{'User-Agent':'SiteBite-Web/0.3 (+https://github.com/h8297leo/SiteBite)',Accept:'application/json',...options.headers},signal:ctx.signal});
    if(!response.ok){
      const code=response.status===429?'rate-limit':response.status>=500?'server-error':`http-${response.status}`;
      const minimum=[403,406].includes(response.status)?300000:response.status===429?30000:response.status>=500?10000:0;
      const until=minimum?Date.now()+retryDelay(response.headers.get('retry-after'),minimum):undefined;
      if(until){const key=[403,406,429].includes(response.status)?host:new URL(url).origin+new URL(url).pathname;cooldown.set(key,until);failures.set(key,code);}await response.body?.cancel();
      throw new SourceError(code,`來源 HTTP ${response.status}`,until);
    }
    // Bound legacy geographic/public API responses too, including custom ZIP decoders.
    const maximum=10000000;if(Number(response.headers.get('content-length'))>maximum)throw new Error('來源回應超過10 MB大小限制');
    const chunks:Uint8Array[]=[];let bytes=0;const reader=response.body?.getReader();
    if(reader){while(true){ctx.signal.throwIfAborted();const part=await reader.read();if(part.done)break;bytes+=part.value.byteLength;if(bytes>maximum){await reader.cancel();throw new Error('來源回應超過10 MB大小限制');}chunks.push(part.value);}}
    const bounded=new Response(new Uint8Array(Buffer.concat(chunks)),{status:response.status,headers:response.headers});
    const raw:unknown=await decode(bounded);const data=parse(raw);const retrievedAt=new Date().toISOString();
    try{await mkdir(directory,{recursive:true});await writeFile(file,JSON.stringify({expires:Date.now()+ttl,retrievedAt,data:raw}));}catch{/* Optional cache failure must not discard a validated public response. */}
    return{data,retrievedAt,cached:false,url};
  }catch(error){
    const failure=ctx.signal.aborted?sourceFailure(ctx.signal.reason):sourceFailure(error);
    if(!failure.retryAt&&['dns','connection','timeout','json','schema'].includes(failure.code)){const key=['dns','connection'].includes(failure.code)?host:new URL(url).origin+new URL(url).pathname;cooldown.set(key,Date.now()+10000);failures.set(key,failure.code);}
    throw failure;
  }finally{
    // A cancelled waiter still releases its place only after prior work completes.
    await new Promise(r=>setTimeout(r,1100));release();void lane.then(()=>{if(lanes.get(host)===lane)lanes.delete(host);});
  }
}
