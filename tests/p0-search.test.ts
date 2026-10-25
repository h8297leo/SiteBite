import { it, expect, vi, afterEach } from 'vitest';
import { defaultFilters, Anchor, filterPlaces } from '../shared/model';
import { collectMealEvidence, mealAssessment } from '../shared/meals';
import { normalizeOsm, ProviderContext, DiscoveryProvider } from '../server/providers';
import { CandidatePool, executeSearch } from '../server/searchOrchestrator';
import { prioritizeDrafts, resolvePlaceEntity } from '../server/placeEntityResolver';
import { ExtractedPlace, extractWebContent } from '../server/webContentExtractor';
import { collectWebPages, discoveryRun } from '../server/webDiscovery';
import { requestJson, redactDiagnostic, sourceFailure } from '../server/http';
import { fetchPublicText } from '../server/secureWeb';
vi.mock('../server/http',async original=>({...await original<typeof import('../server/http')>(),requestJson:vi.fn()}));
vi.mock('../server/secureWeb',async original=>({...await original<typeof import('../server/secureWeb')>(),fetchPublicText:vi.fn()}));
const at='2026-10-25T00:00:00Z';
const anchor:Anchor={id:'fixture',name:'合成中心',displayName:'合成中心',latitude:25,longitude:121,country:'TW',city:'合成市',region:'',confidence:'user-coordinate',source:'https://example.org/',category:'搜尋中心',geoType:'coordinate',originalInput:'合成中心'};
const ctx=():ProviderContext=>({anchor,mode:'food',filters:defaultFilters,radius:3000,round:1,signal:new AbortController().signal,budget:{used:0,limit:30},geocodeBudget:{remaining:6,attempted:new Set()}});
const poi=(hours:string|null=null)=>normalizeOsm({type:'node',id:1,lat:25.001,lon:121,tags:{name:'合成餐廳',amenity:'restaurant',...(hours?{opening_hours:hours}:{})}},'food',at).candidate!;
const draft=(name='甲餐廳',address:string|null='合成市測試路10號'):ExtractedPlace=>({name,aliases:[],address,latitude:null,longitude:null,mode:'food',category:'餐廳',sourceUrl:'https://example.org/article',sourceTitle:'合成多店文章',siteName:'fixture',publishedAt:null,officialUrl:null,categoryEvidence:'具名餐廳及地址',locationEvidence:'原文地址',extraction:'body-list'});
const run=(id:string,c:ProviderContext)=>({provider:id,role:'public-web' as const,status:'success' as const,round:c.round,radiusMeters:c.radius,rawCount:1,validCount:0,invalidCount:0,categoryExcluded:0,durationMs:0,requests:0,cached:false,error:null,endpoint:'fixture',query:'fixture',retrievedAt:at});
const provider=(drafts:ExtractedPlace[]):DiscoveryProvider=>({id:'fixture web',role:'public-web',search:async c=>({candidates:[],drafts,run:{...run('fixture web',c),sourceType:'web-discovery',webPages:1,parsedPages:1,extractedCandidates:drafts.length}})});
afterEach(()=>{vi.resetAllMocks();vi.unstubAllEnvs();});
it('public diagnostics redact credentials and token values and preserve HTTP failure categories',()=>{
 const text=redactDiagnostic('https://name:password@example.org/search?api_key=secret&q=fixture');expect(text).not.toContain('password');expect(text).not.toContain('secret');expect(text).toContain('q=fixture');expect(sourceFailure(new Error('公開來源 HTTP 406')).code).toBe('http-406');
});
it('meal states distinguish confirmation, unknown, exclusion, midnight and complex hours',()=>{
 expect(mealAssessment(poi('17:00-23:00'),'晚餐').status).toBe('confirmed');expect(mealAssessment(poi(),'晚餐').status).toBe('unknown');expect(mealAssessment(poi('07:00-14:00'),'晚餐').status).toBe('excluded');
 expect(mealAssessment(poi('Mo-Su 20:00-02:00'),'宵夜').status).toBe('confirmed');expect(mealAssessment(poi('Mo-Fr 09:00-17:00; PH unknown'),'晚餐').status).toBe('unknown');expect(mealAssessment(poi('00:00-00:00'),'晚餐').status).toBe('unknown');
 const pool=new CandidatePool(anchor,'food',{...defaultFilters,meal:'晚餐'});pool.add(poi(),2000);expect(filterPlaces(pool.places,{...defaultFilters,meal:'晚餐'})).toHaveLength(1);
 expect(filterPlaces([{...poi('07:00-14:00'),distance:100}],defaultFilters)).toHaveLength(1);
});
it('merging preserves original tags, hours, source evidence and conflicts without changing distance order',()=>{
 const p=poi('07:00-14:00'),other={...poi('17:00-23:00'),id:'web:1',sourceUrl:'https://independent.example/venue',mealTags:['晚餐'],evidence:[{...p.evidence[0],url:'https://independent.example/venue'}]};
 const pool=new CandidatePool(anchor,'food',{...defaultFilters,meal:'晚餐'});pool.add(p,2000);pool.add(other,2000);
 expect(pool.places).toHaveLength(1);expect(mealAssessment(pool.places[0],'晚餐')).toEqual({status:'unknown',conflict:true});expect(pool.places[0].mealTags).toContain('晚餐');expect(pool.places[0].osmTags.opening_hours).toBe('07:00-14:00');
 expect(new Set(pool.places[0].mealEvidence?.map(e=>e.openingHours))).toEqual(new Set(['07:00-14:00','17:00-23:00']));expect(collectMealEvidence(pool.places[0]).filter(e=>e.sourceUrl===p.sourceUrl&&e.status==='confirmed'&&e.meal==='晚餐')).toEqual([]);
 const near={...poi(),id:'other',name:'未知店',originalName:'未知店',aliases:[],latitude:25.0005};pool.add(near,2000);expect(filterPlaces(pool.places,{...defaultFilters,meal:'晚餐'})[0].name).toBe('未知店');
});
it('draft preparation deduplicates branches by name and address and prioritizes authoritative coordinates',()=>{
 const a=draft(),b={...a,sourceUrl:'https://other.example/article'},branch=draft(a.name,'合成市測試路20號'),official={...draft('官方餐廳'),officialLocationAuthority:true,latitude:25.001,longitude:121};
 const groups=prioritizeDrafts([draft('無地址',null),a,b,branch,official]);expect(groups).toHaveLength(4);expect(groups[0][0].officialLocationAuthority).toBe(true);expect(groups.find(g=>g[0].name===a.name&&g[0].address===a.address)).toHaveLength(2);
});
it('official coordinates verify without Photon; conflicting coordinates and incomplete addresses stay pending',async()=>{
 const official={...draft(),latitude:25.001,longitude:121,officialLocationAuthority:true};expect((await resolvePlaceEntity(official,ctx(),at,'fixture')).status).toBe('verified');
 const conflicting={...official,sourceUrl:'https://other.example/',latitude:25.01};expect((await resolvePlaceEntity(official,{...ctx(),validationPeers:[official,conflicting]},at,'fixture')).reason).toContain('矛盾');
 expect((await resolvePlaceEntity(draft('不完整餐廳','合成市'),ctx(),at,'fixture')).reason).toContain('地址不完整');expect(requestJson).not.toHaveBeenCalled();
});
it('verification budget is configurable and unique branches, not article mentions, consume it',async()=>{
 vi.stubEnv('GEOCODE_CANDIDATE_LIMIT','4');vi.mocked(requestJson).mockImplementation(async url=>({data:{features:[{geometry:{coordinates:[121,25.001]},properties:{name:new URL(url).searchParams.get('q')!.split(' ')[0],osm_key:'amenity',countrycode:'TW'}}]},url,cached:false,retrievedAt:at}));
 const drafts=Array.from({length:6},(_,i)=>draft(`合成餐廳${i}`,`合成市測試路${i+10}號`));drafts.push({...drafts[0],sourceUrl:'https://independent.example/article'});
 const r=await executeSearch(anchor,'food',defaultFilters,new AbortController().signal,[provider(drafts)]);expect(requestJson).toHaveBeenCalledTimes(4);expect(r.places).toHaveLength(4);expect(r.diagnostics.pendingValidation).toBe(2);expect(r.places.find(p=>p.name===drafts[0].name)?.evidence.some(e=>e.url.includes('independent.example'))).toBe(true);
});
it('six unlocatable venues produce six pending reasons, not an unexplained empty result',async()=>{
 const r=await executeSearch(anchor,'food',defaultFilters,new AbortController().signal,[provider(Array.from({length:6},(_,i)=>draft(`合成餐廳${i}`,null)))]);expect(r.places).toEqual([]);expect(r.diagnostics.pendingValidation).toBe(6);expect(r.diagnostics.providers[0].verificationSamples).toHaveLength(6);expect(r.warnings.at(-1)).toContain('尚未完成位置驗證');expect(requestJson).not.toHaveBeenCalled();
});
it('source failure is isolated; no-result searches stop without repeating stable article queries',async()=>{
 const search=vi.fn(provider([]).search),bad:DiscoveryProvider={id:'fixture fail',role:'geographic',search:async()=>{throw new Error('fixture failure');}};
 const r=await executeSearch(anchor,'food',defaultFilters,new AbortController().signal,[{...provider([]),search},bad]);expect(search).toHaveBeenCalledTimes(1);expect(r.diagnostics.rounds).toBe(2);expect(r.diagnostics.providers.some(p=>p.status==='failed')).toBe(true);
});
it('orchestrator bounds uncooperative providers by time and responds to user cancellation',async()=>{
 vi.stubEnv('SEARCH_TIME_BUDGET_MS','1000');const stalled:DiscoveryProvider={id:'fixture stall',role:'geographic',search:()=>new Promise(()=>{})};
 const r=await executeSearch(anchor,'food',defaultFilters,new AbortController().signal,[stalled]);expect(r.diagnostics.incompleteReasons.length).toBeGreaterThan(0);
 const c=new AbortController(),job=executeSearch(anchor,'food',defaultFilters,c.signal,[stalled]);c.abort();await expect(job).rejects.toBeDefined();
});
it('JSON-LD address/geo references and HTML list items produce individual venue drafts',()=>{
 const html='<article><ul><li><strong>甲餐廳</strong> 類型：餐廳 地址：合成市測試路10號</li><li><strong>乙咖啡廳</strong> 地址：合成市測試路20號</li></ul></article><script type="application/ld+json">{"@graph":[{"@type":"Restaurant","name":"丙餐廳","address":{"@id":"#address"},"geo":{"@id":"#geo"}},{"@id":"#address","@type":"PostalAddress","streetAddress":"合成市測試路30號"},{"@id":"#geo","@type":"GeoCoordinates","latitude":25.001,"longitude":121}]}</script>';
 const result=extractWebContent(html,'https://example.org/article');expect(result.places.map(p=>p.name)).toEqual(expect.arrayContaining(['甲餐廳','乙咖啡廳','丙餐廳']));expect(result.places.find(p=>p.name==='丙餐廳')).toMatchObject({latitude:25.001,address:'合成市測試路30號'});
});
it('正文 budget can process more than three pages and stops at its shared resource limit',async()=>{
 vi.mocked(fetchPublicText).mockImplementation(async url=>({url,retrievedAt:at,cached:false,data:'<script type="application/ld+json">{"@type":"Restaurant","name":"合成餐廳","address":"合成市測試路10號"}</script>'}));
 const c={...ctx(),pageBudget:{remaining:5}},r=discoveryRun('fixture',c,'web-discovery');const drafts=await collectWebPages(Array.from({length:8},(_,i)=>({title:'合成文章',url:`https://example.org/${i}`})),c,r);
 expect(drafts).toHaveLength(5);expect(r.parsedPages).toBe(5);expect(r.status).toBe('partial');expect(c.pageBudget.remaining).toBe(0);
});
