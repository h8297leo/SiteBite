import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { Anchor, SearchIntentSchema, ResponseSchema, ModeSchema, defaultFilters } from '../shared/model';
import { parseDiscoveryInput } from './searchRelevance';
import { forumSources } from './forumDiscovery';
import { resolveLocation, coordinateAnchor } from './locationResolver';
import { executeSearch } from './searchOrchestrator';
const app=express();app.use(express.json({limit:'16kb'}));
const anchors=new Map<string,Anchor>();
function remember(list:Anchor[]) { for(const a of list)anchors.set(a.id,a);while(anchors.size>500)anchors.delete(anchors.keys().next().value!); }
function signalFor(res:express.Response) { const c=new AbortController();res.on('close',()=>{if(!res.writableEnded)c.abort();});return AbortSignal.any([c.signal,AbortSignal.timeout(75000)]); }
app.get('/api/health',(_req,res)=>res.json({ok:true,version:'0.3.0-public-web',phase:2,apiKeysRequired:false,engines:['food','attraction']}));
app.get('/api/source-capabilities',(_req,res)=>res.json({forums:forumSources,generalSearch:{gdelt:'公開新聞文章索引；並非全網搜尋',searxng:process.env.SEARXNG_URL&&process.env.SEARXNG_AUTOMATION_ALLOWED==='true'?'已配置；執行結果仍以診斷為準':'需要額外部署或配置獲准實例'}}));
app.post('/api/resolve',async(req,res)=>{try {
 const input=z.object({query:z.string().trim().min(1).max(200),mode:ModeSchema.default('food'),context:z.object({latitude:z.number().min(-90).max(90),longitude:z.number().min(-180).max(180)}).optional()}).parse(req.body);
 const intent=parseDiscoveryInput(input.query,input.mode,defaultFilters);
 const list=(await resolveLocation(intent.locationQuery,{signal:AbortSignal.any([signalFor(res),AbortSignal.timeout(45000)]),budget:{used:0,limit:10}},input.context)).map(a=>({...a,originalInput:input.query}));remember(list);res.json({locations:list});
 }catch(e){res.status(e instanceof z.ZodError?400:502).json({error:e instanceof z.ZodError?'請輸入有效地點':e instanceof Error&&e.name==='TimeoutError'?'地點解析逾時，請稍後重試。':'公開地點服務暫時無法解析，請重試或使用座標。'});}});
app.post('/api/search',async(req,res)=>{try {
 const input=SearchIntentSchema.parse(req.body);const signal=signalFor(res);let anchor:Anchor;
 if(input.anchor){const known=anchors.get(input.anchor.id);if(!known) {res.status(409).json({error:'此地點選擇已過期，請重新搜尋。'});return;}anchor=known;}
 else if(input.latitude!==undefined&&input.longitude!==undefined){anchor=await coordinateAnchor(input.latitude,input.longitude,{signal,budget:{used:0,limit:1}});remember([anchor]);}
 else {const intent=parseDiscoveryInput(input.query!,input.mode,input.filters);const list=await resolveLocation(intent.locationQuery,{signal,budget:{used:0,limit:10}});remember(list);if(list.length>1){res.status(409).json({error:'請選擇搜尋位置',locations:list});return;}anchor=list[0];}
 if(input.query)anchor={...anchor,originalInput:input.query};
 res.json(ResponseSchema.parse(await executeSearch(anchor,input.mode,input.filters,signal)));
 }catch(e){if(!res.destroyed)res.status(e instanceof z.ZodError?400:502).json({error:e instanceof z.ZodError?'搜尋資料格式無效':e instanceof Error?e.message:'公開資料服務暫時無法取得，請重試。'});}});
app.use('/api',(_req,res)=>res.status(404).json({error:'找不到此 API'}));
app.use((error:unknown,_req:express.Request,res:express.Response,_next:express.NextFunction)=>res.status(400).json({error:'請求格式無效'}));
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const production=process.argv.includes('--production');
if(production){app.use(express.static(path.join(root,'dist')));app.get('*',(_req,res)=>res.sendFile(path.join(root,'dist/index.html')));}
else {const {createServer}=await import('vite');const vite=await createServer({root,server:{middlewareMode:true},appType:'spa'});app.use(vite.middlewares);}
const port=Number(process.env.PORT??3000),host=production?'0.0.0.0':'127.0.0.1';
app.listen(port,host,()=>console.log(`SiteBite Phase 2 ready: http://${host}:${port} (frontend + backend; no API key)`));

