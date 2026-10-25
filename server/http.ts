import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

export type RequestBudget = { used:number; limit:number };
export type HttpContext = { signal:AbortSignal; budget:RequestBudget; meter?:{requests:number} };
export type Retrieved<T> = { data:T; retrievedAt:string; cached:boolean; url:string };
const directory=new URL('../.cache/core-v2/',import.meta.url);
const lanes=new Map<string,Promise<void>>();
const cooldown=new Map<string,number>();
function abortable<T>(promise:Promise<T>,signal:AbortSignal):Promise<T>{
  signal.throwIfAborted();return new Promise((resolve,reject)=>{
    const abort=()=>reject(signal.reason);signal.addEventListener('abort',abort,{once:true});
    promise.then(resolve,reject).finally(()=>signal.removeEventListener('abort',abort));
  });
}
export function serviceError(error:unknown){
  if(error instanceof Error&&['TimeoutError','AbortError'].includes(error.name))return '來源逾時或搜尋已取消';
  if(error instanceof Error&&error.message.includes('HTTP'))return error.message;
  if(error instanceof Error&&error.message.includes('預算'))return error.message;
  if(error instanceof Error&&error.message.includes('拒絕自動存取'))return error.message;
  if(error instanceof Error&&error.message.includes('大小限制'))return error.message;
  return '來源無法連線或資料格式無效';
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
    if((cooldown.get(host)??0)>Date.now())throw new Error('來源 HTTP 429/406 冷卻中');
    if(ctx.budget.used>=ctx.budget.limit)throw new Error('已達公開服務請求預算');ctx.budget.used++;if(ctx.meter)ctx.meter.requests++;
    const response=await fetch(url,{...options,headers:{'User-Agent':'SiteBite-Web/0.2 (+http://localhost:3000; local preview)',Accept:'application/json',...options.headers},signal:ctx.signal});
    if(!response.ok){if([429,406].includes(response.status))cooldown.set(host,Date.now()+30000);throw new Error(`來源 HTTP ${response.status}`);}
    // Bound legacy geographic/public API responses too, including custom ZIP decoders.
    const maximum=10000000;if(Number(response.headers.get('content-length'))>maximum)throw new Error('來源回應超過10 MB大小限制');
    const chunks:Uint8Array[]=[];let bytes=0;const reader=response.body?.getReader();
    if(reader){while(true){ctx.signal.throwIfAborted();const part=await reader.read();if(part.done)break;bytes+=part.value.byteLength;if(bytes>maximum){await reader.cancel();throw new Error('來源回應超過10 MB大小限制');}chunks.push(part.value);}}
    const bounded=new Response(new Uint8Array(Buffer.concat(chunks)),{status:response.status,headers:response.headers});
    const raw:unknown=await decode(bounded);const data=parse(raw);const retrievedAt=new Date().toISOString();
    await mkdir(directory,{recursive:true});await writeFile(file,JSON.stringify({expires:Date.now()+ttl,retrievedAt,data:raw}));
    return{data,retrievedAt,cached:false,url};
  }finally{
    // A cancelled waiter still releases its place only after prior work completes.
    await new Promise(r=>setTimeout(r,1100));release();if(lanes.get(host)===lane)lanes.delete(host);
  }
}
