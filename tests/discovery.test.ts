import { describe, expect, it, vi } from 'vitest';
import { Anchor, defaultFilters, filterPlaces, navigationUrl } from '../shared/model';
import { classifyOsm, overpassQuery } from '../server/engines';
import { normalizeOsm, classifyArticle, parseTravelListings, DiscoveryProvider, OverpassProvider, WikipediaProvider } from '../server/providers';
import { CandidatePool, executeSearch } from '../server/searchOrchestrator';
import { coordinateAnchor, resolveLocation } from '../server/locationResolver';
import { requestJson } from '../server/http';
import { mkdir } from 'node:fs/promises';
vi.mock('node:fs/promises',async importOriginal=>{const actual=await importOriginal<typeof import('node:fs/promises')>();return{...actual,mkdir:vi.fn(actual.mkdir)};});
const anchor:Anchor={id:'test:anchor',name:'地址測試中心',displayName:'地址測試中心',latitude:25,longitude:121,country:'TW',region:'',city:'',confidence:'user-coordinate',source:'https://www.openstreetmap.org/',category:'搜尋中心',geoType:'address',originalInput:'測試地址'};
const at='2026-10-12T00:00:00Z';
const raw={type:'node',id:42,lat:25.001,lon:121,tags:{name:'測試咖啡',amenity:'cafe'}};
function candidate(id=42){return normalizeOsm({...raw,id},'food',at).candidate!;}
function fake(id:string,search:DiscoveryProvider['search']):DiscoveryProvider{return{id,role:'geographic',search};}
describe('core validation — synthetic fixtures only',()=>{
 it('validated public responses survive an optional disk-cache write failure',async()=>{
  vi.mocked(mkdir).mockRejectedValueOnce(new Error('synthetic read-only cache'));
  vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({ok:true}))));
  try{const r=await requestJson(`http://cache-failure.fixture.invalid/${Date.now()}`,{signal:new AbortController().signal,budget:{used:0,limit:1}},v=>v as {ok:boolean});expect(r.data.ok).toBe(true);}finally{vi.unstubAllGlobals();}
 });
 it('Photon failure leaves the existing encyclopedia location resolver available',async()=>{
  vi.stubEnv('PHOTON_URL','http://resolver-failure.fixture.invalid');
  vi.stubGlobal('fetch',vi.fn(async(input:string)=>{if(new URL(input).hostname==='resolver-failure.fixture.invalid')throw new Error('synthetic source failure');return new Response(JSON.stringify({query:{pages:{'1':{pageid:1,title:'FixtureTown',fullurl:'https://en.wikipedia.org/wiki/FixtureTown',coordinates:[{lat:25,lon:121,type:'city',country:'TW'}]}}}}));}));
  try{const locations=await resolveLocation('FixtureTown',{signal:new AbortController().signal,budget:{used:0,limit:4}});expect(locations[0].name).toBe('FixtureTown');expect(locations[0].source).toContain('wikipedia.org');}finally{vi.unstubAllGlobals();vi.unstubAllEnvs();}
 });
 it('Overpass HTTP200 timeout remark without candidates tries the alternate endpoint',async()=>{
  vi.stubEnv('OVERPASS_URL','');vi.stubGlobal('fetch',vi.fn(async(input:string)=>new Response(JSON.stringify(new URL(input).hostname==='overpass-api.de'?{elements:[],remark:'synthetic timeout'}:{elements:[raw]}))));
  try{const r=await new OverpassProvider().search({anchor,mode:'food',filters:defaultFilters,radius:1234,round:1,signal:new AbortController().signal,budget:{used:0,limit:4}});expect(r.candidates).toHaveLength(1);expect(r.run.endpoint).toContain('private.coffee');expect(r.run.status).toBe('partial');}finally{vi.unstubAllGlobals();vi.unstubAllEnvs();}
 });
 it('cancelling a search cannot place a healthy Overpass endpoint in global cooldown',async()=>{
  vi.stubEnv('OVERPASS_URL','http://cancel.fixture.invalid/overpass');vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({elements:[raw]}))));
  const cancelled=new AbortController();cancelled.abort();const context={anchor,mode:'food' as const,filters:defaultFilters,radius:4321,round:1,signal:cancelled.signal,budget:{used:0,limit:4}};
  try{await new OverpassProvider().search(context);const r=await new OverpassProvider().search({...context,signal:new AbortController().signal});expect(r.candidates).toHaveLength(1);}finally{vi.unstubAllGlobals();vi.unstubAllEnvs();}
 });
 it('reverse geocoder timeout cannot discard a known GPS coordinate (mocked HTTP)',async()=>{
  vi.stubEnv('PHOTON_URL','http://fixture.invalid/gps-timeout');vi.stubGlobal('fetch',vi.fn(async()=>{throw new DOMException('simulated timeout','TimeoutError');}));
  try{const a=await coordinateAnchor(25.123456,121.123456,{signal:new AbortController().signal,budget:{used:0,limit:1}});expect(a.confidence).toBe('user-coordinate');expect(a.latitude).toBe(25.123456);expect(a.longitude).toBe(121.123456);}finally{vi.unstubAllGlobals();vi.unstubAllEnvs();}
 });
 it('pure addresses, administrative locations and roads cannot become POIs',()=>{for(const tags of [{'addr:street':'測試路',name:'測試地址'},{place:'city',name:'測試市'},{highway:'residential',name:'測試路'}])expect(normalizeOsm({...raw,tags},'food',at).candidate).toBeUndefined();});
 it('food and attraction tag queries are distinct and validate modes',()=>{expect(overpassQuery('food',25,121,1200,defaultFilters)).not.toContain('museum');expect(overpassQuery('attraction',25,121,2000,defaultFilters)).not.toContain('restaurant');expect(normalizeOsm(raw,'attraction',at).reason).toBe('category');expect(classifyOsm({leisure:'park'})?.mode).toBe('attraction');});
 it('coffee/tea retail tags do not falsely prove a cafe',()=>{expect(classifyOsm({shop:'coffee'})).toBeNull();expect(classifyOsm({shop:'tea'})).toBeNull();expect(classifyOsm({shop:'coffee',amenity:'cafe'})?.category).toBe('咖啡廳');});
 it('missing optional address/website does not discard valid POIs; invalid coordinates do',()=>{expect(candidate().address).toBe('未取得公開地址');expect(normalizeOsm({...raw,lat:100},'food',at).candidate).toBeUndefined();expect(candidate().rating).toBeNull();expect(candidate().osmTags.amenity).toBe('cafe');});
 it('pool has no implicit center; deduplicates identity and nearby same entity',()=>{const pool=new CandidatePool(anchor,'food');expect(pool.places).toHaveLength(0);pool.add(candidate(),3000);pool.add({...candidate(),id:'web:42',sourceUrl:'https://example.org/place'},3000);expect(pool.places).toHaveLength(1);expect(pool.duplicates).toBe(1);expect(pool.places[0].id).not.toBe(anchor.id);});
 it('rejects geographical mismatch and keeps branch locations distinct',()=>{const pool=new CandidatePool(anchor,'food');pool.add(candidate(),3000);pool.add({...candidate(43),latitude:25.02},3000);pool.add({...candidate(44),latitude:45},3000);expect(pool.places).toHaveLength(2);expect(pool.geography).toBe(1);});
 it('article titles cannot bypass category evidence',()=>{expect(classifyArticle(['Category:Companies','Category:Restaurant chains'],'food')).toBeNull();expect(classifyArticle(['Category:Districts of Tokyo'],'attraction')).toBeNull();expect(classifyArticle(['Category:Museums in Paris'],'attraction')?.category).toBe('博物館');});
 it('travel articles use named listings with independent coordinates and sections',()=>{const html='<h2>Eat</h2><span class="vcard"><span class="listing-name" id="Cafe">Fixture Cafe</span><span class="latitude">25</span><span class="longitude">121</span></span><h2>See</h2><span class="vcard"><span class="listing-name">Fixture Museum</span><span class="latitude">25.01</span><span class="longitude">121</span></span>';expect(parseTravelListings(html,'https://en.wikivoyage.org/wiki/Fixture','food',at).candidates.map(p=>p.name)).toEqual(['Fixture Cafe']);expect(parseTravelListings(html,'https://en.wikivoyage.org/wiki/Fixture','attraction',at).candidates.map(p=>p.name)).toEqual(['Fixture Museum']);});
 it('filters actual distance, class and null evidence',()=>{const p={...candidate(),distance:111};expect(filterPlaces([p],defaultFilters)).toHaveLength(1);expect(filterPlaces([p],{...defaultFilters,maxDistance:50})).toHaveLength(0);expect(filterPlaces([p],{...defaultFilters,minRating:4})).toHaveLength(0);expect(new URL(navigationUrl(p)).searchParams.has('key')).toBe(false);});
 it('a failed or malformed provider does not interrupt others; expands when insufficient',async()=>{
  const good=fake('fixture valid',async ctx=>({candidates:[candidate(ctx.round)],run:{provider:'fixture valid',role:'geographic',status:'success',round:ctx.round,radiusMeters:ctx.radius,rawCount:1,validCount:1,invalidCount:0,categoryExcluded:0,durationMs:1,requests:0,cached:false,error:null,endpoint:'fixture',query:'fixture',retrievedAt:at}}));
  const failure=fake('fixture timeout',async()=>{throw new DOMException('fixture','TimeoutError');});const result=await executeSearch(anchor,'food',defaultFilters,new AbortController().signal,[good,failure]);
  expect(result.diagnostics.rounds).toBe(3);expect(result.places).toHaveLength(1);expect(result.diagnostics.radiusMeters).toBeGreaterThan(3000);expect(result.diagnostics.providers.some(p=>p.status==='failed')).toBe(true);
 });
 it('candidates exceed fifty before validation, deduplication and final limit',async()=>{
  const provider=fake('fixture pool',async ctx=>({candidates:Array.from({length:75},(_,i)=>({...candidate(i+1),name:`Fixture ${i}`,originalName:`Fixture ${i}`,aliases:[],latitude:25+i/100000})),run:{provider:'fixture pool',role:'geographic',status:'success',round:ctx.round,radiusMeters:ctx.radius,rawCount:75,validCount:75,invalidCount:0,categoryExcluded:0,durationMs:0,requests:0,cached:false,error:null,endpoint:'fixture',query:'fixture',retrievedAt:at}}));const result=await executeSearch(anchor,'food',defaultFilters,new AbortController().signal,[provider]);expect(result.diagnostics.validPool).toBe(75);expect(result.places).toHaveLength(50);expect(result.diagnostics.rounds).toBe(1);
 });
 it('HTTP 200 invalid provider format is isolated while public article provider continues (mocked HTTP)',async()=>{
  vi.stubEnv('OVERPASS_URL','http://fixture.invalid/invalid-overpass');vi.stubEnv('WIKIPEDIA_URL','http://fixture.invalid');
  vi.stubGlobal('fetch',vi.fn(async(input:string)=>{
   const u=new URL(input);let body:unknown;
   if(u.pathname.includes('invalid-overpass'))body={unrelated:'this HTTP 200 is not Overpass'};
   else if(u.searchParams.get('list')==='geosearch')body={query:{geosearch:Array.from({length:55},(_,i)=>({pageid:100+i,title:`Fixture museum ${i}`,lat:25.001,lon:121}))}};
   else body={query:{pages:Object.fromEntries(Array.from({length:55},(_,i)=>[String(100+i),{pageid:100+i,title:`Fixture museum ${i}`,fullurl:`http://fixture.invalid/wiki/Fixture_${i}`,extract:'Synthetic museum article content used only in this test',coordinates:[{lat:25.001,lon:121}],categories:[{title:'Category:Museums in Fixture'}]}]))}};
   return new Response(JSON.stringify(body),{status:200,headers:{'Content-Type':'application/json'}});
  }));
  try{const r=await executeSearch(anchor,'attraction',defaultFilters,new AbortController().signal,[new OverpassProvider(),new WikipediaProvider()]);expect(r.places).toHaveLength(50);expect(r.diagnostics.providers[0].status).toBe('failed');expect(r.diagnostics.providers[1].status).toBe('success');expect(r.diagnostics.requestCount).toBeGreaterThanOrEqual(1);}finally{vi.unstubAllEnvs();vi.unstubAllGlobals();}
 });
});
