import { load } from 'cheerio';
import type { DiscoveryProvider, ProviderContext, ProviderResult } from './providers';
import { fetchPublicText } from './secureWeb';
import { collectWebPages, discoveryRun, searxSearch, WebHit } from './webDiscovery';
import { generateDiscoveryQueries } from './queryGenerator';

export const forumSources=[
 {name:'PTT',domains:['ptt.cc'],countries:['TW'],status:'可直接查詢',detail:'公開Food／旅遊板搜尋；每次仍檢查robots及存取限制，不處理18歲或登入確認'},
 {name:'Dcard',domains:['dcard.tw'],countries:['TW'],status:'僅能取得公開搜尋連結',detail:'未整合未授權API；內容需另確認合法授權'},
 {name:'5ちゃんねる',domains:['5ch.net'],countries:['JP'],status:'目前不可自動擷取',detail:'尚未確認可用的合法內容接口；僅搜尋連結'},
 {name:'食べログ',domains:['tabelog.com'],countries:['JP'],status:'僅能取得公開搜尋連結',detail:'不抓取星級及評論；內容讀取需合法授權'},
 {name:'Naver Blog',domains:['blog.naver.com'],countries:['KR'],status:'需要合法授權',detail:'搜尋連結可保留，未整合內容API'},
 {name:'Naver Cafe',domains:['cafe.naver.com'],countries:['KR'],status:'需要合法授權',detail:'不登入、不讀取非公開討論'},
 {name:'LIHKG',domains:['lihkg.com'],countries:['HK'],status:'需要合法授權',detail:'未使用未授權API'},
 {name:'Reddit',domains:['reddit.com'],countries:['global'],status:'需要合法授權',detail:'未實作授權Data API，僅保留合法搜尋連結'},
 {name:'Tripadvisor',domains:['tripadvisor.com'],countries:['global'],status:'僅能取得公開搜尋連結',detail:'不擷取受限評論'},
 {name:'Lonely Planet',domains:['lonelyplanet.com'],countries:['global'],status:'僅能取得公開搜尋連結',detail:'沒有假稱舊論壇仍可取得'},
 ...['Threads','Instagram','Facebook'].map(name=>({name,domains:[name==='Threads'?'threads.net':name.toLowerCase()+'.com'],countries:['global'],status:'需要合法授權',detail:'僅保留合法公開搜尋連結，不繞過登入或反爬蟲'})),
];
function matchesHost(host:string,domain:string){return host===domain||host.endsWith('.'+domain);}
export function mayReadForum(url:string){
 const host=new URL(url).hostname;
 if(matchesHost(host,'ptt.cc'))return true;
 return(process.env.FORUM_AUTHORIZED_DOMAINS??'').split(',').map(s=>s.trim()).filter(Boolean).some(domain=>host===domain);
}
export class ForumDiscoveryProvider implements DiscoveryProvider{
 id='論壇／社群場所探索';role='public-web' as const;
 async search(ctx:ProviderContext):Promise<ProviderResult>{
  const start=Date.now(),meter={requests:0},context={...ctx,meter},run=discoveryRun(this.id,ctx,'forum-discovery');let drafts:NonNullable<ProviderResult['drafts']>=[];
  try{
   const queries=generateDiscoveryQueries(ctx.anchor,ctx.mode,ctx.filters);let hits:WebHit[]=[];
   // Public PTT HTML is requested on demand, not an undocumented mobile API.
   if(ctx.anchor.country==='TW'&&process.env.PTT_PUBLIC_SEARCH_ENABLED!=='false'){
    const board=ctx.mode==='food'?'Food':'Tai-travel';
    const keywords=[ctx.anchor.name,...(ctx.anchor.city&&ctx.anchor.city!==ctx.anchor.name?[ctx.anchor.city+' '+(ctx.filters.category==='全部'?'':ctx.filters.category)]:[])].slice(0,2);
    for(const keyword of keywords){const u=new URL(`https://www.ptt.cc/bbs/${board}/search`);u.searchParams.set('q',keyword);
    run.endpoint=u.origin;run.queries!.push(u.href);run.query=run.queries!.join('；');
    try{const r=await fetchPublicText(u.href,context,{ttl:900000});const $=load(r.data);run.retrievedAt=r.retrievedAt;
     if(!$('div.r-list-container,div.bbs-screen').length)throw new Error('PTT未返回可辨識的公開搜尋頁；不將登入或錯誤頁當作空結果');
     hits.push(...$('.title a').toArray().flatMap(el=>{const href=$(el).attr('href');if(!href||!new RegExp(`^/bbs/${board}/M\\.`).test(href))return[];return[{url:new URL(href,u).href,title:$(el).text().trim()}];}).slice(0,8));
     if(hits.length)break;
    }catch(e){run.exclusions!.push(e instanceof Error?e.message:'PTT公開搜尋失敗');break;}}
   }
   if(process.env.SEARXNG_URL&&process.env.SEARXNG_AUTOMATION_ALLOWED==='true'){
    const sources=forumSources.filter(s=>s.countries.includes(ctx.anchor.country)||s.countries.includes('global')).slice(0,4);
    const query=`${queries[0].text} (${sources.flatMap(s=>s.domains).map(d=>'site:'+d).join(' OR ')})`;
    run.queries!.push(query);run.query=run.queries!.join('；');
    try{hits.push(...await searxSearch(query,queries[0].language,context));}catch(e){run.exclusions!.push(e instanceof Error?e.message:'論壇索引查詢失敗');}
   }
   if(!run.queries!.length){run.status='skipped';run.error='目前地區沒有可直接查詢的論壇來源；需要配置獲准的SearXNG或取得來源授權';return{candidates:[],drafts,run};}
   if(!hits.length&&run.exclusions!.length)throw new Error(run.exclusions!.join('；'));
   drafts=await collectWebPages(hits,context,run,mayReadForum);return{candidates:[],drafts,run};
  }catch(e){run.status=run.parsedPages?'partial':'failed';run.error=e instanceof Error?e.message:'論壇來源無法存取';return{candidates:[],drafts,run};}
  finally{run.requests=meter.requests;run.cached=run.status!=='skipped'&&meter.requests===0&&Boolean(run.retrievedAt);run.durationMs=Date.now()-start;run.exclusions=run.exclusions!.slice(0,20);}
 }
}
