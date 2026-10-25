import { writeFile } from 'node:fs/promises';
const cases=['台北 101','台北市信義區市府路1號','龍潭大池','台北','台南','東京','巴黎'];
const results=[];
async function post(path,body){const r=await fetch('http://localhost:3000'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(85000)});const d=await r.json();if(!r.ok)throw new Error(d.error);return d;}
for(const query of cases){
 try{
  const resolved=await post('/api/resolve',{query});
  // A test chooses the first source candidate explicitly and records it; no application hard-code.
  const a=resolved.locations[0];
  for(const mode of ['food','attraction']){
   const r=await post('/api/search',{anchor:a,query,mode});
   const item={query,mode,anchor:r.anchor,alternatives:resolved.locations.map(v=>v.displayName),count:r.places.length,rounds:r.diagnostics.rounds,validPool:r.diagnostics.validPool,radius:r.diagnostics.radiusMeters,sorted:r.places.every((p,i)=>!i||r.places[i-1].distance<=p.distance),modeValid:r.places.every(p=>p.mode===mode),centerNotInjected:r.places.every(p=>p.id!==a.id),samples:r.places.slice(0,5).map(p=>({name:p.name,category:p.category,distance:p.distance,source:p.sourceUrl,osmTags:p.osmTags})),providers:r.diagnostics.providers,stop:r.diagnostics.stopReason,incomplete:r.diagnostics.incompleteReasons};
   results.push(item);console.log(JSON.stringify({query,mode,count:item.count,rounds:item.rounds,radius:item.radius,center:a.displayName,providers:item.providers.map(p=>`${p.provider}:${p.status}:${p.rawCount}`),samples:item.samples.map(p=>p.name)}));
   await writeFile('docs/LIVE-RESULTS.json',JSON.stringify({performedAt:new Date().toISOString(),type:'actual-public-HTTP-data',results},null,2));
  }
 }catch(e){results.push({query,error:e.message});console.log(JSON.stringify({query,error:e.message}));}
}
await writeFile('docs/LIVE-RESULTS.json',JSON.stringify({performedAt:new Date().toISOString(),type:'actual-public-HTTP-data',results},null,2));
