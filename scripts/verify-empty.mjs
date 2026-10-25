import { writeFile } from 'node:fs/promises';
const response=await fetch('http://localhost:3000/api/search',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({latitude:0,longitude:0,mode:'food'}),signal:AbortSignal.timeout(85000)});
const result=await response.json();await writeFile('docs/NO-RESULTS-LIVE.json',JSON.stringify({performedAt:new Date().toISOString(),type:'actual-public-HTTP-data',purpose:'uninhabited ocean coordinate no-result test',httpStatus:response.status,result},null,2));
console.log(JSON.stringify({status:response.status,count:result.places?.length,rounds:result.diagnostics?.rounds,error:result.error,providers:result.diagnostics?.providers.map(p=>`${p.provider}:${p.status}:${p.rawCount}`)}));
if(!response.ok||result.places.length!==0)process.exitCode=1;
