import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { Anchor, defaultFilters } from '../shared/model';
vi.mock('node:fs/promises',()=>({readFile:vi.fn(async()=>{throw new Error('no fixture cache');}),mkdir:vi.fn(async()=>{}),writeFile:vi.fn(async()=>{})}));
const anchor:Anchor={id:'fixture',name:'合成中心',displayName:'合成中心',latitude:25,longitude:121,country:'TW',city:'',region:'',confidence:'user-coordinate',source:'https://example.org/',category:'搜尋中心',geoType:'coordinate',originalInput:'合成中心'};
const raw={type:'node',id:1,lat:25.001,lon:121,tags:{name:'合成餐廳',amenity:'restaurant'}};
const ctx=()=>({anchor,mode:'food' as const,filters:{...defaultFilters,category:'餐廳',meal:'晚餐'},radius:1000,round:1,signal:new AbortController().signal,budget:{used:0,limit:10}});
beforeEach(()=>{vi.resetModules();vi.stubEnv('OVERPASS_URL','');});
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();});
const json=(data:unknown,status=200,headers={})=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json',...headers}});
describe('P0 Overpass / HTTP — mock transport only',()=>{
 it('uses POST with category/radius only; missing hours does not discard restaurants',async()=>{
  const fetcher=vi.fn(async(_url:unknown,options:RequestInit)=>{expect(options.method).toBe('POST');const query=new URLSearchParams(String(options.body)).get('data')!;expect(query).toContain('restaurant');expect(query).not.toMatch(/opening_hours|breakfast|lunch|dinner/);return json({elements:[raw,{...raw,id:2,tags:{...raw.tags,opening_hours:'17:00-23:00'}},{...raw,id:3,tags:{name:'合成公園',leisure:'park'}}]});});vi.stubGlobal('fetch',fetcher);
  const {OverpassProvider}=await import('../server/providers');const c={...ctx(),meter:{requests:0}};const r=await new OverpassProvider().search(c);expect(c.meter.requests).toBe(1);expect(r.run.requests).toBe(1);expect(r.candidates).toHaveLength(2);expect(r.run.categoryExcluded).toBe(1);expect(fetcher).toHaveBeenCalledTimes(1);
 });
 it('isolates DNS failure and uses the second endpoint',async()=>{
  const fetcher=vi.fn(async(url:string)=>{if(url.includes('overpass-api.de'))throw new TypeError('fetch failed',{cause:{code:'ENOTFOUND'}});return json({elements:[raw]});});vi.stubGlobal('fetch',fetcher);
  const {OverpassProvider}=await import('../server/providers');const r=await new OverpassProvider().search(ctx());expect(r.candidates).toHaveLength(1);expect(r.run.endpointAttempts?.[0].code).toBe('dns');expect(r.run.status).toBe('partial');
 });
 it('reports both endpoint failures independently',async()=>{
  vi.stubGlobal('fetch',vi.fn(async()=>json({},503)));const {OverpassProvider}=await import('../server/providers');const r=await new OverpassProvider().search(ctx());expect(r.run.status).toBe('failed');expect(r.run.endpointAttempts).toHaveLength(2);expect(r.run.failureCode).toBe('server-error');
 });
 it('respects Retry-After; a second call in cooldown sends no HTTP',async()=>{
  vi.stubEnv('OVERPASS_URL','https://rate.fixture.invalid/api');const fetcher=vi.fn(async()=>json({},429,{'Retry-After':'120'}));vi.stubGlobal('fetch',fetcher);
  const {OverpassProvider}=await import('../server/providers');const provider=new OverpassProvider(),r=await provider.search(ctx());await provider.search(ctx());expect(fetcher).toHaveBeenCalledTimes(1);expect(r.run.retryAt).toBeGreaterThan(Date.now()+110000);expect(r.run.failureCode).toBe('rate-limit');
 });
 it('does not retry a 403 or change identity to bypass access restrictions',async()=>{
  vi.stubEnv('OVERPASS_URL','https://denied.fixture.invalid/api');const fetcher=vi.fn(async()=>json({},403));vi.stubGlobal('fetch',fetcher);
  const {OverpassProvider}=await import('../server/providers');const provider=new OverpassProvider();const r=await provider.search(ctx());await provider.search(ctx());expect(fetcher).toHaveBeenCalledTimes(1);expect(r.run.failureCode).toBe('http-403');
 });
 it.each(['timeout','json','schema'] as const)('distinguishes %s failures',async kind=>{
  vi.stubEnv('OVERPASS_URL',`https://${kind}.fixture.invalid/api`);vi.stubGlobal('fetch',vi.fn(async()=>{if(kind==='timeout')throw new DOMException('fixture','TimeoutError');return kind==='json'?new Response('not json'):json({unexpected:[]});}));
  const {OverpassProvider}=await import('../server/providers');const r=await new OverpassProvider().search(ctx());expect(r.run.failureCode).toBe(kind);expect(r.run.status).toBe('failed');
 });
 it('does not repeat a syntax error on another endpoint',async()=>{
  const fetcher=vi.fn(async()=>json({elements:[],remark:'parse error: invalid query'}));vi.stubGlobal('fetch',fetcher);const {OverpassProvider}=await import('../server/providers');const r=await new OverpassProvider().search(ctx());expect(r.run.failureCode).toBe('query-syntax');expect(fetcher).toHaveBeenCalledTimes(1);
 });
 it('distinguishes cancellation from failure and does not send a request',async()=>{
  const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);const {OverpassProvider}=await import('../server/providers');const c=new AbortController();c.abort();const r=await new OverpassProvider().search({...ctx(),signal:c.signal});expect(r.run.failureCode).toBe('cancelled');expect(fetcher).not.toHaveBeenCalled();
 });
 it('reports request budget exhaustion without HTTP',async()=>{
  vi.stubGlobal('fetch',vi.fn());const {OverpassProvider}=await import('../server/providers');const r=await new OverpassProvider().search({...ctx(),budget:{used:0,limit:0}});expect(r.run.failureCode).toBe('budget');expect(fetch).not.toHaveBeenCalled();
 });
});
