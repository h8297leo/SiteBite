import {writeFile} from 'node:fs/promises';
const results=[];
async function post(path,body){const r=await fetch('http://127.0.0.1:3000'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(100000)});const d=await r.json();if(!r.ok)throw Error(d.error);return d;}
for(const query of ['龍潭大池','台北101']){
 const resolved=await post('/api/resolve',{query});const anchor=resolved.locations.find(a=>a.country==='TW');
 const response=await post('/api/search',{anchor,query,mode:'food'});
 results.push({query,response,assertions:{mode:response.places.every(p=>p.mode==='food'),noMaintenanceLabels:response.places.every(p=>!/dead link/i.test(p.name)),noScores:response.places.every(p=>p.rating===null)}});
 console.log(JSON.stringify({query,count:response.places.length,web:response.diagnostics.webDiscovery,providers:response.diagnostics.providers.map(r=>({provider:r.provider,status:r.status,valid:r.validCount,error:r.error}))}));
}
await writeFile('docs/PHASE2-RETRY.json',JSON.stringify({executedAt:new Date().toISOString(),kind:'actual HTTP targeted after final parser and fallback corrections; not replacement of original sixteen cases',results},null,2));
