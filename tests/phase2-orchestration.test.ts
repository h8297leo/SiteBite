import { expect, it } from 'vitest';
import { Anchor, CandidateSchema, defaultFilters, filterPlaces } from '../shared/model';
import { normalizeOsm, DiscoveryProvider, parseTravelListings } from '../server/providers';
import { CandidatePool, executeSearch } from '../server/searchOrchestrator';
const anchor:Anchor={id:'fixture',name:'測試中心',displayName:'測試中心',latitude:25,longitude:121,country:'TW',city:'',region:'',confidence:'user-coordinate',source:'https://example.org/',category:'搜尋中心',geoType:'coordinate',originalInput:'測試'};
const at='2026-10-12T00:00:00Z';
const poi=(i:number)=>normalizeOsm({type:'node',id:i+1,lat:25+i/100000,lon:121,tags:{name:`餐廳${i}`,amenity:'restaurant'}},'food',at).candidate!;
it('failed travel searches retry next round; only successful article results are reused',async()=>{
 let attempts=0;const provider:DiscoveryProvider={id:'Wikivoyage 公開旅遊文章',role:'public-web',search:async ctx=>{attempts++;return{candidates:attempts===1?[]:[poi(0)],run:{provider:'Wikivoyage 公開旅遊文章',role:'public-web',status:attempts===1?'failed':'success',round:ctx.round,radiusMeters:ctx.radius,rawCount:attempts===1?0:1,validCount:attempts===1?0:1,invalidCount:0,categoryExcluded:0,durationMs:0,requests:0,cached:false,error:attempts===1?'synthetic timeout':null,endpoint:'fixture',query:'fixture',retrievedAt:at}};}};
 const result=await executeSearch(anchor,'food',defaultFilters,new AbortController().signal,[provider]);expect(attempts).toBe(2);expect(result.places).toHaveLength(1);expect(result.diagnostics.providers[2].status).toBe('skipped');
});
it('merging a validated duplicate preserves source-supported filter tags',()=>{
 const pool=new CandidatePool(anchor,'food');pool.add(poi(0),2000);pool.add({...poi(0),id:'web:tea',mealTags:['下午茶'],evidence:[{...poi(0).evidence[0],url:'https://example.org/tea'}]},2000);
 expect(filterPlaces(pool.places,{...defaultFilters,meal:'下午茶'})).toHaveLength(1);expect(pool.places[0].evidence).toHaveLength(2);
});
it('empty results distinguish an incomplete source from a successful empty source',async()=>{
 const empty:DiscoveryProvider={id:'fixture empty',role:'public-web',search:async ctx=>({candidates:[],run:{provider:'fixture empty',role:'public-web',status:'success',round:ctx.round,radiusMeters:ctx.radius,rawCount:0,validCount:0,invalidCount:0,categoryExcluded:0,durationMs:0,requests:0,cached:false,error:null,endpoint:'fixture',query:'fixture',retrievedAt:at}})};
 const good=await executeSearch(anchor,'food',defaultFilters,new AbortController().signal,[empty]);expect(good.warnings.at(-1)).toContain('未提供候選');
 const failed=await executeSearch(anchor,'food',defaultFilters,new AbortController().signal,[{...empty,search:async()=>{throw new Error('synthetic failure');}}]);expect(failed.warnings.at(-1)).toContain('來源失敗');
});
it('synthetic integration: fast OSM fifty cannot exclude slower web collection; contributions differ from final fifty',async()=>{
 const osm:DiscoveryProvider={id:'fixture osm',role:'geographic',search:async ctx=>({candidates:Array.from({length:80},(_,i)=>poi(i)),run:{provider:'fixture osm',role:'geographic',status:'success',round:ctx.round,radiusMeters:ctx.radius,rawCount:80,validCount:80,invalidCount:0,categoryExcluded:0,durationMs:1,requests:0,cached:false,error:null,endpoint:'fixture',query:'fixture',retrievedAt:at}})};
 const web:DiscoveryProvider={id:'fixture web',role:'public-web',search:async ctx=>{await new Promise(r=>setTimeout(r,15));return{candidates:[{...poi(0),id:'web:duplicate',evidence:[{provider:'fixture web',sourceId:'article',url:'https://example.org/article',retrievedAt:at,kind:'public-article',description:'Synthetic evidence only'}]},{...poi(100),id:'web:new',name:'獨立場所',originalName:'獨立場所',aliases:[],osmId:null,osmType:null}],run:{provider:'fixture web',role:'public-web',status:'success',round:ctx.round,radiusMeters:ctx.radius,rawCount:3,validCount:2,invalidCount:0,categoryExcluded:0,durationMs:15,requests:0,cached:false,error:null,endpoint:'fixture',query:'fixture',retrievedAt:at,sourceType:'fixture-web',webPages:3,parsedPages:2,extractedCandidates:2,verifiedPlaces:2}};}};
 const r=await executeSearch(anchor,'food',defaultFilters,new AbortController().signal,[osm,web]);
 expect(r.places).toHaveLength(50);expect(r.diagnostics.validPool).toBe(81);expect(r.diagnostics.webDiscovery).toMatchObject({pages:3,parsedPages:2,extracted:2,verified:2,osmDuplicates:1,addedToPool:1,addedToFinal:0,additionalEvidence:1});expect(r.places[0].evidence).toHaveLength(2);
});
it('synthetic integration: two official branch identifiers remain separate; same article fragments are one evidence',()=>{
 const pool=new CandidatePool(anchor,'food');const p={...poi(0),id:'nyc:1',osmId:null,osmType:null};pool.add(p,2000);pool.add({...p,id:'nyc:2',latitude:25.00001},2000);expect(pool.places).toHaveLength(2);
 const e={...p.evidence[0],url:'https://example.org/article#one'};pool.add({...p,evidence:[e]},2000);pool.add({...p,evidence:[{...e,url:'https://example.org/article#two'}]},2000);expect(pool.places[0].evidence.filter(e=>e.url.includes('example.org'))).toHaveLength(1);
});
it('external evidence URLs cannot become executable frontend links',()=>{expect(CandidateSchema.safeParse({...poi(0),sourceUrl:'javascript:alert(1)'}).success).toBe(false);});
it('article maintenance labels are not venue names; explicitly closed venues and plain roads are excluded',()=>{
 const listing=(name:string,body='')=>`<span class="vcard"><span class="listing-name">${name}</span><span class="latitude">25</span><span class="longitude">121</span><span class="listing-content">${body}</span></span>`;
 const result=parseTravelListings('<h2>Eat</h2>'+listing('<sup>[formerly dead link]</sup> Cafe Sample')+listing('Closed Sample','Permanently closed')+listing('Some Street')+listing('Sample Night Market'),'https://example.org/travel','food',at);
 expect(result.candidates.map(p=>p.name)).toEqual(['Cafe Sample','Sample Night Market']);expect(result.candidates[1].category).toBe('小吃');
});
