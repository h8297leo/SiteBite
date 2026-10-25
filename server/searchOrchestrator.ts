import { Anchor, CandidateSchema, DiscoveryMode, FilterState, Place, PlaceCandidate, ProviderRun, SearchResponse, categoryMatches, distanceMeters, matchesFilters } from '../shared/model';
import { AttractionDiscoveryEngine, FoodDiscoveryEngine } from './engines';
import { DiscoveryProvider, OverpassProvider, ProviderContext, ProviderResult, WikipediaProvider, WikivoyageProvider } from './providers';
import { RequestBudget, serviceError, sourceFailure, abortable, redactDiagnostic } from './http';
import { TaiwanFoodProvider, TaiwanAttractionProvider } from './taiwanOpenData';
import { PublicWebKeywordProvider, ConfiguredWebArticlesProvider, WikivoyageKeywordProvider } from './publicWeb';
import { WikidataPlaceProvider } from './wikidataProvider';
import { NewYorkFoodProvider } from './localWebSources';
import { PublicArticleProvider } from './webDiscovery';
import { ForumDiscoveryProvider, forumSources } from './forumDiscovery';
import { parseDiscoveryInput, relevanceReason } from './searchRelevance';
import { resolvePlaceEntity, prioritizeDrafts, EntityVerification, entityKey, completeAddress } from './placeEntityResolver';
import { venueKind, ExtractedPlace } from './webContentExtractor';
import { collectMealEvidence, mealAssessment } from '../shared/meals';

export class CandidatePool{
  places:Place[]=[];duplicates=0;invalid=0;geography=0;category=0;relevance=0;
  constructor(readonly anchor:Anchor,readonly mode:DiscoveryMode,readonly filters?:FilterState){}
  add(raw:PlaceCandidate,radius:number){
    const valid=CandidateSchema.safeParse(raw);if(!valid.success){this.invalid++;return 'rejected';}
    const p=valid.data;if(p.mode!==this.mode){this.category++;return 'rejected';}
    const distance=distanceMeters(this.anchor,p);if(distance>radius){this.geography++;return 'rejected';}
    p.mealEvidence=collectMealEvidence(p);
    if(this.filters){if(p.venueKind==='unknown')p.venueKind=venueKind(p.name);if(relevanceReason(p,this.mode,{...this.filters,meal:null})){this.relevance++;return 'rejected';}}
    const normal=(s:string)=>s.normalize('NFKC').toLowerCase().replace(/台/g,'臺').replace(/[\s\p{P}]/gu,'');
    const names=[p.name,p.originalName,...p.aliases].map(normal).filter(Boolean);
    const duplicate=this.places.find(v=>{
      if(v.id===p.id)return true;const separation=distanceMeters(v,p);
      const tolerance=p.mode==='food'?60:(['自然','公園'].includes(p.category)&&['自然','公園'].includes(v.category)?500:120);
      if(p.mode==='food'&&p.osmTags.level&&v.osmTags.level&&p.osmTags.level!==v.osmTags.level)return false;
      if(p.mode==='food'&&completeAddress(p.address)&&completeAddress(v.address)&&normal(p.address)!==normal(v.address))return false;
      if(p.mode==='food'&&p.id.startsWith('nyc:')&&v.id.startsWith('nyc:')&&p.id!==v.id)return false;
      return (p.entityId&&p.entityId===v.entityId&&separation<Math.max(200,tolerance))||(separation<tolerance&&[v.name,v.originalName,...v.aliases].some(n=>names.includes(normal(n))));
    });
    if(duplicate){this.duplicates++;const key=(url:string)=>{const u=new URL(url);u.hash='';return u.href;};for(const e of p.evidence)if(!duplicate.evidence.some(v=>key(v.url)===key(e.url)))duplicate.evidence.push(e);duplicate.aliases=[...new Set([...duplicate.aliases,p.name,p.originalName,...p.aliases])];duplicate.mealEvidence=[...new Map([...(duplicate.mealEvidence??[]),...p.mealEvidence].map(e=>[JSON.stringify(e),e])).values()];duplicate.mealTags=[...new Set([...duplicate.mealTags,...p.mealTags])];duplicate.featureTags=[...new Set([...duplicate.featureTags,...p.featureTags])];return duplicate.osmId!==null?'osm-merged':'merged';}
    this.places.push({...p,distance});return 'added';
  }
}
export async function executeSearch(anchor:Anchor,mode:DiscoveryMode,filters:FilterState,signal:AbortSignal,providers:DiscoveryProvider[]=[new PublicArticleProvider('gdelt'),new PublicArticleProvider('searxng'),new ForumDiscoveryProvider(),new ConfiguredWebArticlesProvider(),new OverpassProvider(),new TaiwanFoodProvider(),new TaiwanAttractionProvider(),new NewYorkFoodProvider(),new WikidataPlaceProvider(),new WikivoyageProvider(),new WikipediaProvider(),new PublicWebKeywordProvider(),new WikivoyageKeywordProvider()]):Promise<SearchResponse>{
  const start=Date.now(),engine=mode==='food'?FoodDiscoveryEngine:AttractionDiscoveryEngine;
  const intent=parseDiscoveryInput(anchor.originalInput||anchor.name,mode,filters);filters=intent.filters;
  const budget:RequestBudget={used:0,limit:30},pool=new CandidatePool(anchor,mode,filters),runs:ProviderRun[]=[],roundResults:SearchResponse['diagnostics']['roundResults']=[];
  const bounded=(name:string,fallback:number,min:number,max:number)=>{const n=Number(process.env[name]);return Number.isFinite(n)&&n>=min?Math.min(max,Math.floor(n)):fallback;};
  const referenceCandidates:PlaceCandidate[]=[],geocodeBudget={remaining:bounded('GEOCODE_CANDIDATE_LIMIT',6,0,12),attempted:new Set<string>(),nominatimRemaining:2},pageBudget={remaining:bounded('WEB_PAGE_LIMIT',8,1,16)};
  const providerBudget:RequestBudget={get used(){return budget.used;},set used(n){budget.used=n;},limit:22};
  const pendingDrafts=new Map<string,ExtractedPlace>(),validationStates=new Map<string,EntityVerification>();let validationDuplicates=0,staleRounds=0;
  const webDiscovery={pages:0,parsedPages:0,extracted:0,verified:0,osmDuplicates:0,addedToPool:0,addedToFinal:0,additionalEvidence:0};
  const webIds=new Set<string>();
  const deadline=Date.now()+bounded('SEARCH_TIME_BUDGET_MS',62000,1000,62000);let radius=engine.initialRadius,stopReason='已達合理地理範圍',round=0;
  const target=50;const providerCache=new Map<string,ProviderResult>(),lastFailures=new Map<string,ProviderRun>();
  for(round=1;round<=3;round++){
    signal.throwIfAborted();if(Date.now()>=deadline||budget.used>=budget.limit){stopReason='搜尋時間或公開服務請求預算已用完';break;}
    const remaining=deadline-Date.now();
    const priorPool=pool.places.length,priorEvidence=pool.places.reduce((n,p)=>n+p.evidence.length,0);
    const settled=await Promise.allSettled(providers.map(async(provider):Promise<ProviderResult>=>{
      const meter={requests:0};const providerSignal=AbortSignal.any([signal,AbortSignal.timeout(Math.max(1,Math.min(20000,remaining-8000)))]);
      const context:ProviderContext={anchor,mode,filters,radius,round,budget:providerBudget,signal:providerSignal,meter,referenceCandidates,geocodeBudget,pageBudget,deadline};
      const cached=providerCache.get(provider.id),failure=lastFailures.get(provider.id);
      if(cached||failure&&((failure.retryAt??0)>Date.now()||['access','http-403','http-406','query-syntax'].includes(failure.failureCode??''))){
        const prior=cached?.run??failure!;
        return{candidates:cached?.candidates??[],drafts:cached?.drafts,run:{...prior,round,radiusMeters:radius,status:'skipped' as const,requests:0,durationMs:0,rawCount:0,validCount:0,webPages:0,parsedPages:0,extractedCandidates:0,verifiedPlaces:0,pendingPlaces:0,rejectedPlaces:0,verificationSamples:[],error:cached?(prior.status==='skipped'?prior.error:'重用本次已取得的文章／候選，優先完成地理驗證，不重複查詢相同關鍵字'):'來源封鎖或冷卻，保留其他來源搜尋'}};
      }
      const result=await abortable(provider.search(context),providerSignal);if(!provider.id.startsWith('觀光署')&&!result.run.sourceType)result.run.requests=meter.requests;
      // Even a provider returning malformed data is isolated inside this settled job.
      result.candidates=result.candidates.flatMap(p=>{const parsed=CandidateSchema.safeParse(p);if(parsed.success)return[parsed.data];result.run.invalidCount++;return[];});
      if(result.run.status==='failed')lastFailures.set(provider.id,result.run);
      if((result.run.sourceType||provider.id==='Wikivoyage 公開旅遊文章')&&(['success','skipped'].includes(result.run.status)||(result.run.status==='partial'&&Boolean(result.drafts?.length))))providerCache.set(provider.id,{...result,candidates:[...result.candidates],drafts:result.drafts?[...result.drafts]:undefined,run:{...result.run}});
      return result;
    }));
    let rawCandidates=0;
    for(const r of settled)if(r.status==='fulfilled')for(const p of r.value.candidates)if(distanceMeters(anchor,p)<=radius&&!referenceCandidates.some(v=>v.id===p.id))referenceCandidates.push(p);
    const owners=new Map<string,Set<ProviderResult>>();
    for(const r of settled){
      if(r.status!=='fulfilled')continue;
      for(const draft of r.value.drafts??[]){
        const key=entityKey(draft),sourceKey=key+'|'+draft.sourceUrl.replace(/#.*$/,'');
        if(pendingDrafts.has(sourceKey))validationDuplicates++;else pendingDrafts.set(sourceKey,draft);
        if(!owners.has(key))owners.set(key,new Set());owners.get(key)!.add(r.value);
      }
    }
    const validationPeers=[...pendingDrafts.values()],groups=prioritizeDrafts(validationPeers);
    const validationSignal=AbortSignal.any([signal,AbortSignal.timeout(Math.max(1,Math.min(20000,deadline-Date.now())))]);
    // Priority-ordered small batches keep unrelated failures isolated without consuming
    // the geocoder budget once per article mentioning the same branch.
    for(let offset=0;offset<groups.length;offset+=3){
      await Promise.all(groups.slice(offset,offset+3).map(async group=>{
        const draft=group[0],key=entityKey(draft),sources=[...(owners.get(key)??[])];if(!sources.length)return;
        const meter={requests:0},began=Date.now();let check:EntityVerification;
        if(draft.mode!==mode||!categoryMatches(draft.category,filters.category))check={status:'rejected',reason:'場所類別不符合目前搜尋條件'};
        else if(validationSignal.aborted||Date.now()>=deadline)check={status:'pending',reason:'地理驗證時間預算耗盡，尚未確認位置'};
        else try{check=await resolvePlaceEntity(draft,{anchor,mode,filters,radius,round,budget,signal:validationSignal,meter,referenceCandidates,validationPeers,geocodeBudget,deadline},sources[0].run.retrievedAt??new Date().toISOString(),sources[0].run.provider);}catch(e){signal.throwIfAborted();check={status:'pending',reason:serviceError(e)};}
        validationStates.set(key,check);
        if(check.candidate){
          const candidate=check.candidate;
          for(const p of group){
            if(!candidate.evidence.some(e=>e.url.replace(/#.*$/,'')===p.sourceUrl.replace(/#.*$/,'')))candidate.evidence.push({provider:sources[0].run.provider,sourceId:p.sourceUrl,url:p.sourceUrl,retrievedAt:new Date().toISOString(),kind:'public-article',sourceType:p.extraction,sourceTitle:p.sourceTitle,extractedPlaceName:p.name,categoryEvidence:p.categoryEvidence,locationEvidence:check.reason??'同一具名場所與地址群組通過地理驗證',description:p.categoryEvidence+'；'+p.locationEvidence});
            candidate.mealEvidence=[...(candidate.mealEvidence??[]),...collectMealEvidence({osmTags:{},openingHours:p.openingHours??null,sourceUrl:p.sourceUrl})];
          }
          if(!referenceCandidates.some(p=>p.id===candidate.id))referenceCandidates.push(candidate);
        }
        for(let i=0;i<sources.length;i++){
          const result=sources[i],run=result.run;
          if(check.candidate){result.candidates.push(check.candidate);run.verifiedPlaces=(run.verifiedPlaces??0)+1;}
          else if(check.status==='pending')run.pendingPlaces=(run.pendingPlaces??0)+1;
          else{run.rejectedPlaces=(run.rejectedPlaces??0)+1;if(check.reason?.includes('類別'))run.categoryExcluded++;}
          run.verificationSamples??=[];if(run.verificationSamples.length<50)run.verificationSamples.push({name:draft.name,status:check.status,reason:check.reason??'名稱、位置、類別驗證通過',sourceUrl:draft.sourceUrl});
          if(i===0){run.requests+=meter.requests;run.durationMs+=Date.now()-began;if(meter.requests)run.cached=false;}
          run.validCount=result.candidates.length;
        }
      }));
    }
    signal.throwIfAborted();
    // Add the concurrently collected geographic reference pool before web drafts so
    // a referenced OSM place counts as added evidence, not a new independent venue.
    const order=settled.map((_,i)=>i).sort((a,b)=>Number(settled[a].status==='fulfilled'&&Boolean((settled[a] as PromiseFulfilledResult<ProviderResult>).value.run.sourceType))-Number(settled[b].status==='fulfilled'&&Boolean((settled[b] as PromiseFulfilledResult<ProviderResult>).value.run.sourceType)));
    for(const i of order){
      const result=settled[i];
      if(result.status==='fulfilled'){
        const {candidates,run}=result.value;runs.push(run);rawCandidates+=run.status==='skipped'?0:run.rawCount;
        const newWeb=Boolean(run.sourceType)&&run.status!=='skipped';
        if(newWeb){webDiscovery.pages+=run.webPages??0;webDiscovery.parsedPages+=run.parsedPages??0;webDiscovery.extracted+=run.extractedCandidates??0;webDiscovery.verified+=run.verifiedPlaces??candidates.length;}
        run.addedToPool=0;for(const p of candidates){const before=newWeb?pool.places.reduce((n,p)=>n+p.evidence.length,0):0;const outcome=pool.add(p,radius);if(outcome==='added')run.addedToPool++;if(newWeb){if(outcome==='added'){webDiscovery.addedToPool++;webIds.add(p.id);}if(outcome==='osm-merged')webDiscovery.osmDuplicates++;if(outcome==='merged'||outcome==='osm-merged')webDiscovery.additionalEvidence+=pool.places.reduce((n,p)=>n+p.evidence.length,0)-before;}}
      }else runs.push({provider:providers[i].id,role:providers[i].role,status:'failed',round,radiusMeters:radius,rawCount:0,validCount:0,invalidCount:0,categoryExcluded:0,durationMs:0,requests:0,cached:false,failureCode:sourceFailure(result.reason).code,error:serviceError(result.reason),endpoint:'',query:'Provider 未完成',retrievedAt:null});
    }
    roundResults.push({round,radiusMeters:radius,rawCandidates,validPool:pool.places.length});
    staleRounds=pool.places.length===priorPool&&pool.places.reduce((n,p)=>n+p.evidence.length,0)===priorEvidence?staleRounds+1:0;
    const matches=pool.places.filter(p=>matchesFilters(p,filters)).length;
    const webCount=pool.places.filter(p=>p.evidence.some(e=>['json-ld','body-list','forum-post'].includes(e.sourceType??''))).length;
    const webAvailable=runs.some(r=>['web-discovery','forum-discovery','configured-regional-articles'].includes(r.sourceType??'')&&r.status!=='failed'&&r.status!=='skipped');
    if(matches>=target&&(!webAvailable||webCount>=10)){stopReason='已收集符合意圖的場所，並完成公開網頁來源參與；依距離取最多50筆';break;}
    if(filters.maxDistance!==null&&radius>=filters.maxDistance){stopReason='已搜尋到使用者指定的距離範圍';break;}
    if(staleRounds>=2){stopReason='補充搜尋沒有新增場所或證據，停止重複請求';break;}
    if(runs.filter(r=>r.round===round).every(r=>r.status==='failed'||r.status==='skipped')&&round>=2){stopReason='目前來源均不可用或沒有可執行工作，停止擴大半徑';break;}
    if(round===3){stopReason='已完成三輪補充搜尋；顯示實際有效數量';break;}
    // Sparse areas expand more than dense areas. A query radius is not a user distance setting.
    const factor=matches<10?3:2;radius=Math.min(engine.maximumRadius,Math.round(radius*factor));
    if(filters.maxDistance!==null)radius=Math.min(radius,Math.max(engine.initialRadius,filters.maxDistance));
  }
  const mealExcluded=filters.meal?pool.places.filter(p=>mealAssessment(p,filters.meal!).status==='excluded').length:0;
  const poolDecisions=pool.places.filter(p=>!matchesFilters(p,filters)).slice(0,50).map(p=>({name:p.name,reason:filters.meal&&mealAssessment(p,filters.meal).status==='excluded'?'來源證據確認不符合所選餐期':'距離／評分／特色條件不符'}));
  const places=pool.places.filter(p=>matchesFilters(p,filters)).sort((a,b)=>a.distance-b.distance).slice(0,50);
  webDiscovery.addedToFinal=places.filter(p=>webIds.has(p.id)).length;
  for(const run of runs){run.endpoint=redactDiagnostic(run.endpoint);run.query=redactDiagnostic(run.query);if(run.error)run.error=redactDiagnostic(run.error);run.queries=run.queries?.map(redactDiagnostic);run.exclusions=run.exclusions?.map(redactDiagnostic);}
  const failures=runs.filter(r=>r.status==='failed'||r.status==='partial');
  const incompleteReasons=[...new Set(runs.filter(r=>r.status==='failed'||r.status==='partial'||(r.status==='skipped'&&r.error?.includes('安全性封鎖'))).map(r=>`${r.provider} 第${r.round}輪：${r.error??'來源未完成'}`))];
  if(Date.now()>=deadline||budget.used>=budget.limit)incompleteReasons.push('已達本次搜尋時間或請求預算，保留已完成來源的有效結果');
  const warnings=failures.length?['部分來源未完整搜尋；已保留其他來源驗證的地點，詳見搜尋診斷。']:[];
  if(!places.length)warnings.push(pool.places.length?'已取得有效地點，但沒有符合目前篩選條件的結果。':validationStates.size?'已抽取場所，但尚未完成位置驗證或被類別規則排除；請查看各候選理由。':incompleteReasons.length?'來源失敗或搜尋未完成，尚不能判定附近沒有地點；請查看診斷或稍後重試。':runs.some(r=>r.rawCount>0)?'來源已返回資料，但候選未通過類別、座標或地理範圍驗證；請查看排除數量。':'已執行來源在本次搜尋範圍未提供候選；不代表附近沒有場所。');
  return{anchor,mode,filters,places,warnings,diagnostics:{
    originalInput:anchor.originalInput,mode,providers:runs,rounds:roundResults.length,roundResults,
    candidates:roundResults.reduce((n,r)=>n+r.rawCandidates,0),categoryExcluded:pool.category+runs.filter(r=>r.status!=='skipped').reduce((n,r)=>n+r.categoryExcluded,0),
    invalidExcluded:pool.invalid+runs.filter(r=>r.status!=='skipped').reduce((n,r)=>n+r.invalidCount,0),geographyExcluded:pool.geography,duplicateExcluded:pool.duplicates,
    validPool:pool.places.length,finalCount:places.length,durationMs:Date.now()-start,radiusMeters:roundResults.at(-1)?.radiusMeters??0,requestCount:budget.used,requestBudget:budget.limit,stopReason,incompleteReasons,webDiscovery,osmPool:pool.places.filter(p=>p.osmId!==null).length,intent,relevanceExcluded:pool.relevance,mealExcluded,poolDecisions,pendingValidation:[...validationStates.values()].filter(v=>v.status==='pending').length,validationDuplicates,sourceCapabilities:forumSources.map(({name,status,detail})=>({name,status,detail})),
  }};
}
