import { PublicArticleProvider } from './webDiscovery';
import { z } from 'zod';
import { DiscoveryProvider, ProviderContext, ProviderResult, classifyArticle, parseTravelListings } from './providers';
import { ProviderRun, coords, distanceMeters } from '../shared/model';
import { serviceError } from './http';
import { fetchPublicText } from './secureWeb';
import { generateDiscoveryQueries } from './queryGenerator';
import { ExtractedPlace, extractWebContent } from './webContentExtractor';
import { resolvePlaceEntity } from './placeEntityResolver';

const wikiPage=z.object({pageid:z.number(),title:z.string(),fullurl:z.string().url(),extract:z.string().optional(),coordinates:z.array(z.object({lat:coords.latitude,lon:coords.longitude})).optional(),categories:z.array(z.object({title:z.string()})).optional(),pageprops:z.record(z.unknown()).optional()});
const SearchEnvelope=z.object({query:z.object({pages:z.record(z.unknown()).optional(),searchinfo:z.object({totalhits:z.number()}).optional()}).optional(),error:z.object({info:z.string().optional(),code:z.string().optional()}).optional()});
function api(host:string,params:Record<string,string>){const u=new URL('/w/api.php',host);for(const[k,v]of Object.entries({format:'json',maxlag:'5',...params}))u.searchParams.set(k,v);return u.href;}
function classifyLocalized(categories:string[],mode:ProviderContext['mode']){
 const text=categories.join(' ').toLowerCase();if(/restaurant chains|companies|disambiguation|districts of|neighbou?rhoods|streets in|roads in|cities in|villages in|communes|railway stations|企業|公司|チェーン|連鎖|曖昧|동음이의|市镇|市鎮|區劃|行政区/.test(text))return null;
 if(mode==='food'&&/defunct|closed restaurants|歇業|已結業|廃業|閉店/.test(text))return null;
 if(mode==='attraction'&&/industrial parks|science parks|business parks|研究園區|科學園區|工業區/.test(text))return null;
 const english=classifyArticle(categories,mode);if(english)return english;
 if(mode==='food'){
  if(/咖啡店|咖啡館|咖啡廳|喫茶店|カフェ|커피|카페|café/.test(text))return{category:'咖啡廳'};
  if(/餐廳|餐馆|餐館|飲食店|レストラン|음식점|식당|restaurant/.test(text))return{category:'餐廳'};return null;
 }
 const rules:[RegExp,string][]=[[/博物館|博物馆|美術館|박물관|미술관|musée/,'博物館'],[/公園|公园|庭園|공원|정원|jardin|parcs/,'公園'],[/史跡|古蹟|古迹|歴史的建造物|유적|monument/,'古蹟'],[/寺院|神社|教堂|성당|사찰|église/,'文化'],[/動物園|动物园|水族館|동물원|수족관/,'親子'],[/観光地|觀光景點|旅游景点|관광 명소/,'地標']];
 for(const[pattern,category]of rules)if(pattern.test(text))return{category};return null;
}
function runFor(ctx:ProviderContext,id:string,sourceType:string):ProviderRun{return{provider:id,role:'public-web',status:'success',round:ctx.round,radiusMeters:ctx.radius,rawCount:0,validCount:0,invalidCount:0,categoryExcluded:0,durationMs:0,requests:0,cached:true,error:null,endpoint:'',query:'',retrievedAt:null,webPages:0,parsedPages:0,extractedCandidates:0,verifiedPlaces:0,queries:[],exclusions:[],sourceType};}
/** Explicitly scoped Wikimedia fulltext discovery, never labelled generic internet search. */
export class PublicWebKeywordProvider implements DiscoveryProvider{
 id='Wikipedia 關鍵字網頁發現';role='public-web' as const;
 async search(ctx:ProviderContext):Promise<ProviderResult>{
  const start=Date.now(),meter={requests:0},context={...ctx,meter},run=runFor(ctx,this.id,'encyclopedia-keyword-search'),candidates:ProviderResult['candidates']=[],errors:string[]=[];
  const queries=generateDiscoveryQueries(ctx.anchor,ctx.mode,ctx.filters);
  // Fulltext keyword queries are spatially scoped by the search service, then verified again locally.
  const keywords:Record<string,string[]>={zh:ctx.mode==='food'?['餐廳','咖啡']:['博物館','公園'],ja:ctx.mode==='food'?['レストラン','喫茶店']:['博物館','公園'],ko:ctx.mode==='food'?['음식점','카페']:['박물관','공원'],fr:ctx.mode==='food'?['restaurant','café']:['musée','parc'],en:ctx.mode==='food'?['restaurant','cafe']:['museum','park']};
  try{
   for(const [index,q]of queries.entries()){
    ctx.signal.throwIfAborted();const host=`https://${q.language}.wikipedia.org`,chosen=keywords[q.language]??keywords.en;
    const tea=ctx.filters.meal==='下午茶'||ctx.filters.category==='咖啡廳'||ctx.filters.category==='甜點';
    const term=ctx.mode==='food'&&tea?chosen[1]:chosen[index%2];
    // CirrusSearch nearcoord accepts integer distance tokens; decimal km silently drops the spatial filter.
    const search=`nearcoord:${Math.max(1,Math.ceil(ctx.radius/1000))}km,${ctx.anchor.latitude},${ctx.anchor.longitude} ${term}`;
    const url=api(host,{action:'query',generator:'search',gsrsearch:search,gsrlimit:'20',gsrnamespace:'0',prop:'info|coordinates|categories|extracts|pageprops',inprop:'url',coprop:'type|country',colimit:'max',cllimit:'max',exintro:'1',exlimit:'max'});
    run.endpoint=host;run.queries!.push(`${q.language}: ${search}`);run.query=run.queries!.join('；');
    try{
     const response=await fetchPublicText(url,context,{api:true,maxBytes:3000000,ttl:3600000});const envelope=SearchEnvelope.parse(JSON.parse(response.data));
     if(envelope.error)throw new Error(`Wikimedia ${envelope.error.code}: ${envelope.error.info}`);
     run.cached=run.cached&&response.cached;run.retrievedAt=response.retrievedAt;const pages=Object.values(envelope.query?.pages??{});run.webPages!+=pages.length;run.rawCount+=pages.length;
     for(const raw of pages){
      const p=wikiPage.safeParse(raw);if(!p.success){run.invalidCount++;run.exclusions!.push('搜尋結果頁面格式無效');continue;}
      const page=p.data;if(!page.extract?.trim()){run.invalidCount++;continue;}
      if(/\b(?:incident|poisoning|massacre|murder|list of)\b|大火|火災|中毒|事件|事故|事案|列表|一覧/i.test(page.title)){run.categoryExcluded++;run.exclusions!.push(`${page.title}：事件或列表文章不是場所`);continue;}
      const body=extractWebContent(`<html><head><title>${page.title.replace(/[<&]/g,'')}</title></head><body><article>${page.extract}</article></body></html>`,page.fullurl);run.parsedPages!++;
      const classes=page.categories?.map(c=>c.title)??[];
      // Category validation uses explicit English categories. For other languages, Wikidata/structured types can supplement later.
      const classification=classifyLocalized(classes,ctx.mode);if(!classification){run.categoryExcluded++;continue;}
      const coord=page.coordinates?.[0];if(!coord){run.invalidCount++;run.exclusions!.push(`${page.title}：文章沒有可靠座標`);continue;}
      const extracted:ExtractedPlace={name:page.title,aliases:[],address:null,latitude:coord.lat,longitude:coord.lon,mode:ctx.mode,category:classification.category,sourceUrl:page.fullurl,sourceTitle:page.title,siteName:new URL(page.fullurl).host,publishedAt:null,officialUrl:null,categoryEvidence:`實際全文搜尋文章分類：${classes.filter(c=>/restaurant|cafe|museum|park|historic|landmark/i.test(c)).slice(0,4).join('、')}`,locationEvidence:'公開文章主座標及搜尋區域交叉驗證',extraction:'encyclopedia',entityId:typeof page.pageprops?.wikibase_item==='string'?page.pageprops.wikibase_item:null};
      if(body.text.length<20){run.invalidCount++;continue;}run.extractedCandidates!++;
      const checked=await resolvePlaceEntity(extracted,context,response.retrievedAt,this.id);if(checked.candidate){candidates.push(checked.candidate);run.verifiedPlaces!++;}else{run.invalidCount++;run.exclusions!.push(`${page.title}：${checked.reason}`);}
     }
    }catch(e){errors.push(`${host}：${e instanceof Error?e.message:serviceError(e)}`);ctx.signal.throwIfAborted();}
   }
   run.validCount=candidates.length;if(errors.length){run.status=candidates.length?'partial':'failed';run.error=errors.join('；');}return{candidates,run};
  }catch(e){run.status=candidates.length?'partial':'failed';run.error=serviceError(e);run.validCount=candidates.length;return{candidates,run};}
  finally{run.durationMs=Date.now()-start;run.requests=meter.requests;run.exclusions=Array.from(new Set(run.exclusions)).slice(0,30);}
 }
}

/** Generic search requires an explicitly authorized instance; no public instance scraping or DDG bypass. */
export class SearxngPublicSearchProvider extends PublicArticleProvider{constructor(){super('searxng');}}

/** Opt-in regional public article registry; policies and robots are checked per destination. */
export class ConfiguredWebArticlesProvider implements DiscoveryProvider{
 id='地方公開文章擷取';role='public-web' as const;
 async search(ctx:ProviderContext):Promise<ProviderResult>{
  const start=Date.now(),meter={requests:0},context={...ctx,meter},run=runFor(ctx,this.id,'configured-regional-articles');
  const drafts:ExtractedPlace[]=[];
  if(!process.env.WEB_SOURCE_URLS){run.status='skipped';run.cached=false;run.error='未設定具有合法存取依據的地方文章來源WEB_SOURCE_URLS';return{candidates:[],drafts,run};}
  try{
   const sources=z.array(z.object({url:z.string().url(),country:z.string(),mode:z.enum(['food','attraction']),automationAllowed:z.literal(true),officialLocationAuthority:z.boolean().default(false)})).max(30).parse(JSON.parse(process.env.WEB_SOURCE_URLS));
   const selected=sources.filter(p=>p.country.toUpperCase()===ctx.anchor.country.toUpperCase()&&p.mode===ctx.mode).slice(0,2);
   if(!selected.length){run.status='skipped';run.error='來源清單未涵蓋目前國家／模式';}
   for(const source of selected){
    run.queries!.push(source.url);run.endpoint=source.url;run.webPages!++;run.rawCount++;
    try{const response=await fetchPublicText(source.url,context,{ttl:900000});const content=extractWebContent(response.data,response.url);run.parsedPages!++;run.retrievedAt=response.retrievedAt;
     drafts.push(...content.places.slice(0,12).map(p=>({...p,officialLocationAuthority:source.officialLocationAuthority})));run.exclusions!.push(...content.exclusions);
    }catch(e){run.exclusions!.push(e instanceof Error?e.message:'文章無法存取');if(ctx.signal.aborted)break;}
   }
   run.extractedCandidates=drafts.length;if(run.exclusions!.length){run.status=run.parsedPages?'partial':'failed';run.error='部分文章無法讀取或解析';}return{candidates:[],drafts,run};
  }catch(e){run.status='failed';run.error=e instanceof Error?e.message:'文章來源配置錯誤';return{candidates:[],drafts,run};}
  finally{run.requests=meter.requests;run.cached=run.status!=='skipped'&&meter.requests===0&&Boolean(run.retrievedAt);run.durationMs=Date.now()-start;run.query=run.queries!.join('；');}
 }
}
/** Fulltext travel article discovery followed by actual typed listing extraction. */
export class WikivoyageKeywordProvider implements DiscoveryProvider{
 id='Wikivoyage 關鍵字文章發現';role='public-web' as const;
 async search(ctx:ProviderContext):Promise<ProviderResult>{
  const start=Date.now(),meter={requests:0},context={...ctx,meter},run=runFor(ctx,this.id,'travel-keyword-search'),candidates:ProviderResult['candidates']=[];
  const query=`nearcoord:${Math.max(1,Math.ceil(ctx.radius/1000))}km,${ctx.anchor.latitude},${ctx.anchor.longitude} ${ctx.mode==='food'?'eat':'see'}`;
  run.query=query;run.queries=[query];run.endpoint='https://en.wikivoyage.org';
  try{
   const response=await fetchPublicText(api(run.endpoint,{action:'query',list:'search',srsearch:query,srlimit:'2',srnamespace:'0'}),context,{api:true,ttl:3600000});
   const envelope=z.object({query:z.object({search:z.array(z.object({pageid:z.number(),title:z.string()}))})}).parse(JSON.parse(response.data));run.webPages=envelope.query.search.length;run.rawCount=run.webPages;run.cached=response.cached;
   for(const page of envelope.query.search){
    try{
     const article=await fetchPublicText(api(run.endpoint,{action:'parse',pageid:String(page.pageid),prop:'text'}),context,{api:true,ttl:3600000,maxBytes:3000000});
     const parsed=z.object({parse:z.object({text:z.object({'*':z.string()})})}).parse(JSON.parse(article.data));run.parsedPages!++;run.retrievedAt=article.retrievedAt;run.cached=run.cached&&article.cached;
     const pageUrl=`https://en.wikivoyage.org/wiki/${encodeURIComponent(page.title.replace(/ /g,'_'))}`;
     const extracted=parseTravelListings(parsed.parse.text['*'],pageUrl,ctx.mode,article.retrievedAt);run.extractedCandidates!+=extracted.candidates.length;run.categoryExcluded+=extracted.categoryExcluded;run.invalidCount+=extracted.invalid;
     for(const candidate of extracted.candidates){
      if(/(?:\b(?:street|road|avenue|boulevard)|路|街|大道|通り)$/i.test(candidate.name)&&!/museum|market|park|寺|博物館/i.test(candidate.name)){run.categoryExcluded++;run.exclusions!.push(`${candidate.name}：普通道路不當成推薦場所`);continue;}
      if(distanceMeters(ctx.anchor,candidate)>ctx.radius){run.invalidCount++;continue;}
      candidate.evidence=candidate.evidence.map(e=>({...e,provider:this.id,providerName:this.id,sourceType:'travel-article-listing',sourceUrl:e.url,sourceTitle:page.title,publishedAt:null,evidenceType:'listing-location-category',extractedPlaceName:candidate.name,locationEvidence:'旅遊文章獨立 listing 座標',categoryEvidence:`文章已分類 listing：${candidate.category}`}));
      candidates.push(candidate);run.verifiedPlaces!++;
     }
    }catch(e){run.exclusions!.push(`${page.title}：${e instanceof Error?e.message:serviceError(e)}`);ctx.signal.throwIfAborted();}
   }
   run.validCount=candidates.length;if(run.exclusions!.length){run.status='partial';run.error='部分全文旅遊文章解析失敗';}return{candidates,run};
  }catch(e){run.status=candidates.length?'partial':'failed';run.error=e instanceof Error?e.message:serviceError(e);return{candidates,run};}
  finally{run.durationMs=Date.now()-start;run.requests=meter.requests;}
 }
}
