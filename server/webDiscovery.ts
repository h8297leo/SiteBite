import { z } from 'zod';
import { publicUrl, fetchPublicText } from './secureWeb';
import type { ProviderContext, ProviderResult, DiscoveryProvider } from './providers';
import { ProviderRun } from '../shared/model';
import { generateDiscoveryQueries } from './queryGenerator';
import { extractWebContent } from './webContentExtractor';
import { sourceFailure } from './http';

export type WebHit={title:string;url:string;snippet?:string};
// Apply the same content-access policy to general search hits and forum search hits.
export function mayReadSearchHit(url:string){
 const host=new URL(url).hostname;
 const restricted=['dcard.tw','5ch.net','tabelog.com','naver.com','lihkg.com','reddit.com','tripadvisor.com','lonelyplanet.com','threads.net','threads.com','instagram.com','facebook.com','google.com'];
 if(!restricted.some(d=>host===d||host.endsWith('.'+d)))return true;
 return(process.env.FORUM_AUTHORIZED_DOMAINS??'').split(',').map(s=>s.trim()).filter(Boolean).includes(host);
}
export function discoveryRun(id:string,ctx:ProviderContext,sourceType:string):ProviderRun{return{provider:id,role:'public-web',sourceType,status:'success',round:ctx.round,radiusMeters:ctx.radius,rawCount:0,validCount:0,invalidCount:0,categoryExcluded:0,durationMs:0,requests:0,cached:true,error:null,endpoint:'',query:'',retrievedAt:null,queries:[],webPages:0,parsedPages:0,extractedCandidates:0,verifiedPlaces:0,pendingPlaces:0,rejectedPlaces:0,exclusions:[],links:[]};}
export async function searxSearch(query:string,language:string,ctx:ProviderContext):Promise<WebHit[]>{
 if(!process.env.SEARXNG_URL||process.env.SEARXNG_AUTOMATION_ALLOWED!=='true')throw new Error('通用搜尋未配置獲准的SearXNG實例');
 const u=new URL('search',process.env.SEARXNG_URL.replace(/\/?$/,'/'));u.searchParams.set('q',query);u.searchParams.set('language',language);u.searchParams.set('format','json');
 const response=await fetchPublicText(u.href,ctx,{api:true,ttl:900000});
 const parsed=z.object({results:z.array(z.object({title:z.string(),url:z.string(),content:z.string().optional()}))}).parse(JSON.parse(response.data));
 return parsed.results.slice(0,20).flatMap(p=>{try{return[{title:p.title,url:publicUrl(p.url).href,snippet:p.content}];}catch{return[];}});
}
/** Full pages produce drafts, never direct recommendations from a headline or snippet. */
export async function collectWebPages(hits:WebHit[],ctx:ProviderContext,run:ProviderRun,mayRead:(url:string)=>boolean=mayReadSearchHit):Promise<NonNullable<ProviderResult['drafts']>>{
 const unique=[...new Map(hits.map(p=>{const u=new URL(p.url);u.hash='';return[u.href,p];})).values()];
 run.webPages=unique.length;run.rawCount=unique.length;run.links=unique.slice(0,20).map(p=>({url:p.url,title:p.title,snippet:p.snippet,level:p.snippet?'search-snippet':'link-only'}));
 const drafts:NonNullable<ProviderResult['drafts']>=[],pages=ctx.pageBudget??{remaining:8};let stopped=false;
 const official=(url:string)=>/\.(?:gov|gov\.[a-z]{2}|go\.[a-z]{2})$/i.test(new URL(url).hostname);
 const ranked=[...unique].sort((a,b)=>Number(official(b.url))-Number(official(a.url)));
 for(const hit of ranked){
  if(!mayRead(hit.url)){run.exclusions!.push(`${new URL(hit.url).hostname}：僅保留搜尋連結；內容擷取尚未獲准`);continue;}
  if(pages.remaining<=0||ctx.budget.used>=ctx.budget.limit||ctx.signal.aborted||Date.now()>=(ctx.deadline??Infinity)-8000){stopped=true;run.exclusions!.push('正文解析受篇數、剩餘時間或 HTTP 預算限制；未讀取的網頁不算解析成功');break;}
  pages.remaining--;
  try{
   const page=await fetchPublicText(hit.url,ctx,{ttl:900000});const content=extractWebContent(page.data,page.url);
   if(!content.places.length&&content.text.trim().length<80)throw new Error('頁面未提供足夠的可讀公開正文；可能為JavaScript殼頁');
   if(/subscribe to (?:continue|read)|訂閱後閱讀|登入後閱讀|로그인 후/.test(content.text))throw new Error('僅取得登入／訂閱提示，未讀取受限文章');
   run.retrievedAt=page.retrievedAt;run.cached=run.cached&&page.cached;run.parsedPages!++;
   drafts.push(...content.places.slice(0,12));run.exclusions!.push(...content.exclusions);
   if(!content.places.length)run.exclusions!.push(`${content.title||hit.title}：有文章，但未辨識出具名場所`);
  }catch(e){run.exclusions!.push(`${new URL(hit.url).hostname}：${e instanceof Error?e.message:'無法讀取內容'}`);if(ctx.signal.aborted)break;}
 }
 run.extractedCandidates=drafts.length;
 if(stopped||unique.length&&!run.parsedPages){run.status='partial';run.error=stopped?'正文解析預算已用完，保留已完成抽取':'已找到網頁，但內容受限制或未能讀取；未以摘要冒充全文';}
 return drafts;
}

export class PublicArticleProvider implements DiscoveryProvider{
 role='public-web' as const;id:string;
 constructor(readonly kind:'gdelt'|'searxng'){this.id=kind==='gdelt'?'公開文章索引 GDELT':'通用網頁搜尋 SearXNG';}
 async search(ctx:ProviderContext):Promise<ProviderResult>{
  const start=Date.now(),meter={requests:0},context={...ctx,meter},run=discoveryRun(this.id,ctx,'web-discovery');let drafts:NonNullable<ProviderResult['drafts']>=[];
  try{
   if(this.kind==='searxng'&&(!process.env.SEARXNG_URL||process.env.SEARXNG_AUTOMATION_ALLOWED!=='true')){run.status='skipped';run.error='未配置自架或明確允許自動查詢的SearXNG；不將百科冒充通用搜尋';return{candidates:[],drafts,run};}
   if(this.kind==='gdelt'&&process.env.GDELT_ENABLED==='false'){run.status='skipped';run.error='管理者停用GDELT文章索引';return{candidates:[],drafts,run};}
   const queries=generateDiscoveryQueries(ctx.anchor,ctx.mode,ctx.filters);let hits:WebHit[]=[];
   if(this.kind==='gdelt'){
    const location=ctx.anchor.englishName??ctx.anchor.name;
    if(!/[A-Za-z]/.test(location)){run.status='skipped';run.error='GDELT為英譯新聞索引；目前缺少可靠英文地名，改由其他來源搜尋';return{candidates:[],drafts,run};}
    const english=queries.find(q=>q.scope==='english')!.text;
    run.query=english;run.queries=[english];run.endpoint='https://api.gdeltproject.org/api/v2/doc/doc';
    const specific:Record<string,string>={'小吃':'("street food" OR snack OR stall)','咖啡廳':'(cafe OR coffeehouse)','甜點':'(dessert OR patisserie)','麵包烘焙':'(bakery OR bread)','飲料茶飲':'("bubble tea" OR teahouse)','速食':'"fast food"','自助餐':'buffet','酒吧餐酒館':'(bar OR pub)','博物館':'museum','宗教景點':'(temple OR shrine OR church)','公園步道':'(park OR trail)','歷史古蹟':'(historic OR monument)','自然景觀':'(nature OR landscape)','展覽活動':'(exhibition OR gallery)'};
    const subject=specific[ctx.filters.category]??(ctx.mode==='food'?'(restaurant OR cafe OR "street food")':'(museum OR park OR attraction)');
    const u=new URL(run.endpoint);u.searchParams.set('query',`"${location.replace(/["()]/g,' ')}" ${subject}`);u.searchParams.set('mode','artlist');u.searchParams.set('format','json');u.searchParams.set('maxrecords','15');u.searchParams.set('timespan','3months');
    run.query=u.searchParams.get('query')!;run.queries=[run.query];
    const r=await fetchPublicText(u.href,context,{api:true,ttl:900000});run.retrievedAt=r.retrievedAt;run.cached=r.cached;
    const rows=z.object({articles:z.array(z.object({url:z.string(),title:z.string()}))}).parse(JSON.parse(r.data));
    hits=rows.articles.flatMap(p=>{try{return[{title:p.title,url:publicUrl(p.url).href}];}catch{return[];}});
   }else{
    run.endpoint=process.env.SEARXNG_URL!;
    for(const q of queries){run.queries!.push(q.text);try{hits.push(...await searxSearch(q.text,q.language,context));}catch(e){run.exclusions!.push(e instanceof Error?e.message:'搜尋失敗');if(ctx.signal.aborted)break;}}
    run.query=run.queries!.join('；');
    if(!hits.length&&run.exclusions!.length)throw new Error(run.exclusions!.join('；'));
   }
   drafts=await collectWebPages(hits,context,run);return{candidates:[],drafts,run};
  }catch(e){run.status=run.parsedPages?'partial':'failed';run.failureCode=sourceFailure(e).code;run.error=sourceFailure(e).message;return{candidates:[],drafts,run};}
  finally{run.requests=meter.requests;run.cached=run.status!=='skipped'&&meter.requests===0&&Boolean(run.retrievedAt);run.durationMs=Date.now()-start;run.exclusions=run.exclusions!.slice(0,20);}
 }
}
