import {describe,it,expect,vi,afterEach} from 'vitest';
import {Anchor,defaultFilters} from '../shared/model';
import {parseDiscoveryInput,relevanceReason,supportedMeals} from '../server/searchRelevance';
import {normalizeOsm,DiscoveryProvider,ProviderContext} from '../server/providers';
import {overpassQuery} from '../server/engines';
import {extractWebContent,ExtractedPlace,venueKind} from '../server/webContentExtractor';
import {resolvePlaceEntity} from '../server/placeEntityResolver';
import {PublicArticleProvider} from '../server/webDiscovery';
import {ForumDiscoveryProvider,mayReadForum} from '../server/forumDiscovery';
import {executeSearch} from '../server/searchOrchestrator';
import {fetchPublicText} from '../server/secureWeb';
import {requestJson} from '../server/http';
vi.mock('../server/secureWeb',async original=>({...await original<typeof import('../server/secureWeb')>(),fetchPublicText:vi.fn()}));
vi.mock('../server/http',async original=>({...await original<typeof import('../server/http')>(),requestJson:vi.fn()}));
const at='2026-10-25T00:00:00Z';
const anchor:Anchor={id:'fixture',name:'測試夜市',englishName:'Fixture Market',displayName:'測試夜市',latitude:25,longitude:121,country:'TW',city:'測試市',region:'',confidence:'source-match',source:'https://example.org/',category:'搜尋中心',geoType:'landmark',originalInput:'測試夜市 小吃'};
const context=():ProviderContext=>({anchor,mode:'food',filters:{...defaultFilters,category:'小吃'},radius:2000,round:1,budget:{used:0,limit:20},signal:new AbortController().signal,geocodeBudget:{remaining:2}});
const draft=(overrides:Partial<ExtractedPlace>={}):ExtractedPlace=>({name:'測試攤位',aliases:[],address:'測試路12號',latitude:25.001,longitude:121,mode:'food',category:'小吃',sourceUrl:'https://example.org/article',sourceTitle:'多店文章',siteName:'fixture',publishedAt:null,officialUrl:null,categoryEvidence:'原文具名小吃攤',locationEvidence:'原文獨立場所座標',extraction:'body-list',venueKind:'stall',...overrides});
const retrieved=(data:unknown,url='https://example.org/')=>({data:typeof data==='string'?data:JSON.stringify(data),url,cached:false,retrievedAt:at});
afterEach(()=>{vi.resetAllMocks();vi.unstubAllEnvs();});
describe('search reconstruction — mocked public sources, no real HTTP',()=>{
 it('separates center and snack intent; a manual all-types selection can override inferred intent',()=>{
  expect(parseDiscoveryInput('測試夜市 小吃','food',defaultFilters)).toMatchObject({locationQuery:'測試夜市',category:'小吃'});
  expect(parseDiscoveryInput('測試地點 小吃 早餐','food',defaultFilters)).toMatchObject({locationQuery:'測試地點',category:'小吃',meal:'早餐'});
  expect(parseDiscoveryInput('Fixture City street food','food',defaultFilters).category).toBe('小吃');
  expect(parseDiscoveryInput('測試夜市 小吃','food',{...defaultFilters,queryIntent:false}).category).toBe('全部');
  expect(overpassQuery('food',25,121,1000,{...defaultFilters,category:'麵包烘焙'})).toContain('bakery');
  expect(overpassQuery('food',25,121,1000,{...defaultFilters,category:'麵包烘焙'})).not.toContain('pub');
 });
 it('keeps markets distinct from named stalls, and never invents meal times from a cafe category',()=>{
  expect(venueKind('測試夜市')).toBe('market');expect(venueKind('測試夜市甲攤')).toBe('stall');
  expect(supportedMeals({osmTags:{amenity:'cafe'},openingHours:null})).toEqual([]);
  expect(supportedMeals({osmTags:{},openingHours:'Mo-Fr 14:00-17:00'})).toContain('下午茶');
  const p=normalizeOsm({type:'node',id:1,lat:25.001,lon:121,tags:{name:'測試酒吧',amenity:'bar'}},'food',at).candidate!;
  expect(relevanceReason(p,'food',{...defaultFilters,category:'小吃'})).toContain('分類');
 });
 it('extracts separate named forum venues and addresses, not a dish or an article headline',()=>{
  const html='<title>十大必吃</title><div id="main-content">餐廳名稱：甲小吃攤\n地址：測試市測試路12號\n類型：小吃\n餐廳名稱：乙咖啡廳\n地址：測試市測試路16號\n類型：咖啡廳</div>';
  const r=extractWebContent(html,'https://www.ptt.cc/bbs/Food/M.fixture.html');expect(r.places.map(p=>p.name)).toEqual(['甲小吃攤','乙咖啡廳']);expect(r.places[0].extraction).toBe('forum-post');
  expect(extractWebContent('<article>這個城市的蚵仔煎很好吃</article>','https://example.org/post').places).toEqual([]);
 });
 it('verifies against independent OSM identity without Photon and retains article evidence',async()=>{
  const p=normalizeOsm({type:'node',id:9,lat:25.001,lon:121,tags:{name:'測試攤位',amenity:'food_stall'}},'food',at).candidate!;
  const r=await resolvePlaceEntity(draft({latitude:null,longitude:null}),{...context(),referenceCandidates:[p]},at,'fixture web');
  expect(r.status).toBe('verified');expect(r.candidate?.evidence).toHaveLength(2);expect(requestJson).not.toHaveBeenCalled();
 });
 it('can verify a non-OSM venue from two different domains with matching name/address/coordinates',async()=>{
  const a=draft(),b=draft({sourceUrl:'https://independent.example/article'});const r=await resolvePlaceEntity(a,{...context(),validationPeers:[a,b]},at,'fixture web');
  expect(r.status).toBe('verified');expect(r.candidate?.osmId).toBeNull();expect(r.candidate?.rating).toBeNull();
 });
 it('uses a bounded Nominatim fallback; missing positions stay pending rather than using the center',async()=>{
  vi.mocked(requestJson).mockResolvedValue({data:{features:[]},url:'https://photon.komoot.io/api/',retrievedAt:at,cached:false});
  vi.mocked(fetchPublicText).mockResolvedValue(retrieved([{lat:'25.001',lon:'121',name:'測試攤位',display_name:'測試路12號',category:'amenity',type:'restaurant',address:{road:'測試路',house_number:'12'}}]));
  const r=await resolvePlaceEntity(draft({latitude:null,longitude:null}),context(),at,'fixture');expect(r.status).toBe('verified');expect(vi.mocked(fetchPublicText).mock.calls[0][0]).toContain('nominatim');
  expect((await resolvePlaceEntity(draft({latitude:null,longitude:null,address:null}),context(),at,'fixture')).status).toBe('pending');
 });
 it('an actual search adapter fetches full pages and produces drafts, never headline recommendations',async()=>{
  vi.stubEnv('SEARXNG_URL','https://authorized.example/');vi.stubEnv('SEARXNG_AUTOMATION_ALLOWED','true');
  vi.mocked(fetchPublicText).mockImplementation(async url=>new URL(url).hostname==='authorized.example'?retrieved({results:[{title:'集合文章',url:'https://example.org/article',content:'僅摘要'}]}):retrieved('<title>集合文章</title><script type="application/ld+json">{"@type":"Restaurant","name":"甲店","address":"測試路12號"}</script>'));
  const r=await new PublicArticleProvider('searxng').search(context());expect(r.run.parsedPages).toBe(1);expect(r.drafts?.[0].name).toBe('甲店');expect(r.candidates).toEqual([]);
 });
 it('public PTT search reads discussion HTML; restricted community sources stay link-only',async()=>{
  vi.stubEnv('SEARXNG_URL','');vi.mocked(fetchPublicText).mockImplementation(async url=>url.includes('/search?')?retrieved('<div class="r-list-container"><div class="title"><a href="/bbs/Food/M.fixture.html">討論</a></div></div>'):retrieved('<div id="main-content">餐廳名稱：甲小吃攤\n地址：測試路12號\n類型：小吃</div>'));
  const r=await new ForumDiscoveryProvider().search(context());expect(r.drafts?.[0].name).toBe('甲小吃攤');expect(r.run.parsedPages).toBe(1);expect(mayReadForum('https://www.reddit.com/r/example')).toBe(false);
 });
 it('HTTP200 invalid article-index envelopes are failed sources, not successful empty searches',async()=>{
  vi.mocked(fetchPublicText).mockResolvedValue(retrieved({error:'invalid response'}));const r=await new PublicArticleProvider('gdelt').search(context());expect(r.run.status).toBe('failed');expect(r.candidates).toEqual([]);
 });
 it('the orchestrator verifies drafts centrally and excludes fifty nearby bars from a snack request',async()=>{
  const run=(id:string,ctx:ProviderContext)=>({provider:id,role:'public-web' as const,status:'success' as const,round:ctx.round,radiusMeters:ctx.radius,rawCount:1,validCount:0,invalidCount:0,categoryExcluded:0,durationMs:0,requests:0,cached:false,error:null,endpoint:'fixture',query:'fixture',retrievedAt:at});
  const web:DiscoveryProvider={id:'fixture primary',role:'public-web',search:async ctx=>({candidates:[],drafts:[draft({officialLocationAuthority:true})],run:{...run('fixture primary',ctx),sourceType:'web-discovery',webPages:1,parsedPages:1,extractedCandidates:1}})};
  const geo:DiscoveryProvider={id:'fixture geo',role:'geographic',search:async ctx=>({candidates:Array.from({length:60},(_,i)=>normalizeOsm({type:'node',id:i+1,lat:25.001,lon:121,tags:{name:`酒吧${i}`,amenity:'bar'}},'food',at).candidate!),run:run('fixture geo',ctx)})};
  const r=await executeSearch(anchor,'food',defaultFilters,new AbortController().signal,[web,geo]);expect(r.places.map(p=>p.name)).toEqual(['測試攤位']);expect(r.diagnostics.relevanceExcluded).toBeGreaterThan(0);expect(r.diagnostics.intent?.category).toBe('小吃');
 });
});
