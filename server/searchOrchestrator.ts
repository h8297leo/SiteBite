import { Anchor, CandidateSchema, DiscoveryMode, FilterState, Place, PlaceCandidate, ProviderRun, SearchResponse, distanceMeters, matchesFilters } from '../shared/model';
import { AttractionDiscoveryEngine, FoodDiscoveryEngine } from './engines';
import { DiscoveryProvider, OverpassProvider, ProviderContext, WikipediaProvider, WikivoyageProvider } from './providers';
import { RequestBudget, serviceError } from './http';
import { TaiwanFoodProvider, TaiwanAttractionProvider } from './taiwanOpenData';
import { PublicWebKeywordProvider, SearxngPublicSearchProvider, ConfiguredWebArticlesProvider, WikivoyageKeywordProvider } from './publicWeb';
import { WikidataPlaceProvider } from './wikidataProvider';
import { NewYorkFoodProvider } from './localWebSources';

export class CandidatePool{
  places:Place[]=[];duplicates=0;invalid=0;geography=0;category=0;
  constructor(readonly anchor:Anchor,readonly mode:DiscoveryMode){}
  add(raw:PlaceCandidate,radius:number){
    const valid=CandidateSchema.safeParse(raw);if(!valid.success){this.invalid++;return 'rejected';}
    const p=valid.data;if(p.mode!==this.mode){this.category++;return 'rejected';}
    const distance=distanceMeters(this.anchor,p);if(distance>radius){this.geography++;return 'rejected';}
    const normal=(s:string)=>s.normalize('NFKC').toLowerCase().replace(/台/g,'臺').replace(/[\s\p{P}]/gu,'');
    const names=[p.name,p.originalName,...p.aliases].map(normal).filter(Boolean);
    const duplicate=this.places.find(v=>{
      if(v.id===p.id)return true;const separation=distanceMeters(v,p);
      const tolerance=p.mode==='food'?60:(['自然','公園'].includes(p.category)&&['自然','公園'].includes(v.category)?500:120);
      if(p.mode==='food'&&p.osmTags.level&&v.osmTags.level&&p.osmTags.level!==v.osmTags.level)return false;
      if(p.mode==='food'&&p.id.startsWith('nyc:')&&v.id.startsWith('nyc:')&&p.id!==v.id)return false;
      return (p.entityId&&p.entityId===v.entityId&&separation<Math.max(200,tolerance))||(separation<tolerance&&[v.name,v.originalName,...v.aliases].some(n=>names.includes(normal(n))));
    });
    if(duplicate){this.duplicates++;const key=(url:string)=>{const u=new URL(url);u.hash='';return u.href;};for(const e of p.evidence)if(!duplicate.evidence.some(v=>key(v.url)===key(e.url)))duplicate.evidence.push(e);duplicate.aliases=[...new Set([...duplicate.aliases,p.name,p.originalName,...p.aliases])];return duplicate.osmId!==null?'osm-merged':'merged';}
    this.places.push({...p,distance});return 'added';
  }
}
export async function executeSearch(anchor:Anchor,mode:DiscoveryMode,filters:FilterState,signal:AbortSignal,providers:DiscoveryProvider[]=[new OverpassProvider(),new WikipediaProvider(),new WikivoyageProvider(),new TaiwanFoodProvider(),new TaiwanAttractionProvider(),new PublicWebKeywordProvider(),new WikivoyageKeywordProvider(),new WikidataPlaceProvider(),new NewYorkFoodProvider(),new SearxngPublicSearchProvider(),new ConfiguredWebArticlesProvider()]):Promise<SearchResponse>{
  const start=Date.now(),engine=mode==='food'?FoodDiscoveryEngine:AttractionDiscoveryEngine;
  const budget:RequestBudget={used:0,limit:30},pool=new CandidatePool(anchor,mode),runs:ProviderRun[]=[],roundResults:SearchResponse['diagnostics']['roundResults']=[];
  const webDiscovery={pages:0,parsedPages:0,extracted:0,verified:0,osmDuplicates:0,addedToPool:0,addedToFinal:0,additionalEvidence:0};
  const webIds=new Set<string>();
  const deadline=Date.now()+62000;let radius=engine.initialRadius,stopReason='已達合理地理範圍',round=0;
  const target=50;const providerCache=new Map<string,PlaceCandidate[]>();
  for(round=1;round<=3;round++){
    signal.throwIfAborted();if(Date.now()>=deadline||budget.used>=budget.limit){stopReason='搜尋時間或公開服務請求預算已用完';break;}
    const remaining=deadline-Date.now();
    const settled=await Promise.allSettled(providers.map(async provider=>{
      const meter={requests:0};const providerSignal=AbortSignal.any([signal,AbortSignal.timeout(Math.max(1,Math.min(23000,remaining)))]);
      const context:ProviderContext={anchor,mode,filters,radius,round,budget,signal:providerSignal,meter};
      if(provider.id==='Wikivoyage 公開旅遊文章'&&providerCache.has(provider.id)){
        const prior=runs.find(v=>v.provider===provider.id)!;
        return{candidates:providerCache.get(provider.id)!,run:{...prior,round,radiusMeters:radius,status:'skipped' as const,requests:0,durationMs:0,error:'本次搜尋已讀取附近文章，重用已驗證候選以避免重複請求'}};
      }
      const result=await provider.search(context);if(!provider.id.startsWith('觀光署')&&!result.run.sourceType)result.run.requests=meter.requests;
      // Even a provider returning malformed data is isolated inside this settled job.
      result.candidates=result.candidates.flatMap(p=>{const parsed=CandidateSchema.safeParse(p);if(parsed.success)return[parsed.data];result.run.invalidCount++;return[];});
      if(provider.id==='Wikivoyage 公開旅遊文章')providerCache.set(provider.id,result.candidates);
      return result;
    }));
    let rawCandidates=0;
    for(let i=0;i<settled.length;i++){
      const result=settled[i];
      if(result.status==='fulfilled'){
        const {candidates,run}=result.value;runs.push(run);rawCandidates+=run.status==='skipped'?0:run.rawCount;
        const newWeb=Boolean(run.sourceType)&&run.status!=='skipped';
        if(newWeb){webDiscovery.pages+=run.webPages??0;webDiscovery.parsedPages+=run.parsedPages??0;webDiscovery.extracted+=run.extractedCandidates??0;webDiscovery.verified+=run.verifiedPlaces??candidates.length;}
        for(const p of candidates){const before=pool.places.reduce((n,p)=>n+p.evidence.length,0);const outcome=pool.add(p,radius);if(newWeb){if(outcome==='added'){webDiscovery.addedToPool++;webIds.add(p.id);}if(outcome==='osm-merged')webDiscovery.osmDuplicates++;if(outcome==='merged'||outcome==='osm-merged')webDiscovery.additionalEvidence+=pool.places.reduce((n,p)=>n+p.evidence.length,0)-before;}}
      }else runs.push({provider:providers[i].id,role:providers[i].role,status:'failed',round,radiusMeters:radius,rawCount:0,validCount:0,invalidCount:0,categoryExcluded:0,durationMs:0,requests:0,cached:false,error:serviceError(result.reason),endpoint:'',query:'Provider 未完成',retrievedAt:null});
    }
    roundResults.push({round,radiusMeters:radius,rawCandidates,validPool:pool.places.length});
    const matches=pool.places.filter(p=>matchesFilters(p,filters)).length;
    if(matches>=target){stopReason='已取得至少50個符合條件且去重的有效候選';break;}
    if(filters.maxDistance!==null&&radius>=filters.maxDistance){stopReason='已搜尋到使用者指定的距離範圍';break;}
    if(round===3){stopReason='已完成三輪補充搜尋；顯示實際有效数量';break;}
    // Sparse areas expand more than dense areas. A query radius is not a user distance setting.
    const factor=matches<10?3:2;radius=Math.min(engine.maximumRadius,Math.round(radius*factor));
    if(filters.maxDistance!==null)radius=Math.min(radius,Math.max(engine.initialRadius,filters.maxDistance));
  }
  const places=pool.places.filter(p=>matchesFilters(p,filters)).sort((a,b)=>a.distance-b.distance).slice(0,50);
  webDiscovery.addedToFinal=places.filter(p=>webIds.has(p.id)).length;
  const failures=runs.filter(r=>r.status==='failed'||r.status==='partial');
  const incompleteReasons=[...new Set(runs.filter(r=>r.status==='failed'||r.status==='partial'||(r.status==='skipped'&&r.error?.includes('安全性封鎖'))).map(r=>`${r.provider} 第${r.round}輪：${r.error??'來源未完成'}`))];
  if(Date.now()>=deadline||budget.used>=budget.limit)incompleteReasons.push('已達本次搜尋時間或請求預算，保留已完成來源的有效結果');
  return{anchor,mode,filters,places,warnings:failures.length?['部分來源未完整搜尋；已保留其他來源驗證的地點，詳見搜尋診斷。']:[],diagnostics:{
    originalInput:anchor.originalInput,mode,providers:runs,rounds:roundResults.length,roundResults,
    candidates:roundResults.reduce((n,r)=>n+r.rawCandidates,0),categoryExcluded:pool.category+runs.filter(r=>r.status!=='skipped').reduce((n,r)=>n+r.categoryExcluded,0),
    invalidExcluded:pool.invalid+runs.filter(r=>r.status!=='skipped').reduce((n,r)=>n+r.invalidCount,0),geographyExcluded:pool.geography,duplicateExcluded:pool.duplicates,
    validPool:pool.places.length,finalCount:places.length,durationMs:Date.now()-start,radiusMeters:roundResults.at(-1)?.radiusMeters??0,requestCount:budget.used,requestBudget:budget.limit,stopReason,incompleteReasons,webDiscovery,osmPool:pool.places.filter(p=>p.osmId!==null).length,
  }};
}
