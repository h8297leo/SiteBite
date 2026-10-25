import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

// Start the real npm command, not a second test implementation of the server.
const development=process.argv.includes('--dev'),live=process.argv.includes('--live');
const port=development?13002:13001,host=development?'127.0.0.1':'0.0.0.0';
assert(process.env.npm_execpath,'Run with npm run test:deployment');
const child=spawn(process.execPath,[process.env.npm_execpath,'run',development?'dev':'start'],{
 env:{...process.env,PORT:String(port),NODE_ENV:development?'development':'production',GEMINI_API_KEY:'',GOOGLE_MAPS_API_KEY:'',GOOGLE_SEARCH_API_KEY:'',GOOGLE_SEARCH_CX:''},
 detached:process.platform!=='win32',stdio:['ignore','pipe','pipe'],
});
let output='';child.stdout.on('data',v=>output+=v);child.stderr.on('data',v=>output+=v);
const closed=once(child,'close');
const base=`http://127.0.0.1:${port}`,checks=[];
async function request(path,body){return fetch(base+path,{...(body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),signal:AbortSignal.timeout(85000)});}
try{
 const deadline=Date.now()+60000;let ready=false;
 while(Date.now()<deadline){
  assert.equal(child.exitCode,null,output);
  try{if(output.includes(`http://${host}:${port}`)&&(await request('/api/health')).ok){ready=true;break;}}catch{}
  await new Promise(r=>setTimeout(r,250));
 }
 assert(ready,`Server did not start: ${output}`);checks.push(`npm run ${development?'dev':'start'} listens on ${host}:${port}`);
 const health=await request('/api/health');assert.equal(health.status,200);
 assert.deepEqual(await health.json(),{ok:true,version:'0.3.0-public-web',phase:2,apiKeysRequired:false,engines:['food','attraction']});checks.push('health HTTP 200 and exact Phase 2 JSON');
 const home=await request('/'),html=await home.text();assert.equal(home.status,200);assert.match(home.headers.get('content-type'),/text\/html/);assert.match(html,/id="root"/);
 if(development)assert.match(html,/@vite\/client/);
 else {assert.doesNotMatch(html,/@vite\/client/);const asset=html.match(/<script[^>]+src="([^"]+)"/);assert(asset);const js=await request(asset[1]);assert.equal(js.status,200);assert.match(js.headers.get('content-type'),/javascript/);}
 checks.push('homepage HTML and same-origin frontend assets');
 for(const [path,body]of [['/api/resolve',{query:''}],['/api/search',{mode:'invalid'}]]){const r=await request(path,body);assert.equal(r.status,400);assert.equal(typeof(await r.json()).error,'string');}
 const missing=await request('/api/missing');assert.equal(missing.status,404);assert.equal(typeof(await missing.json()).error,'string');checks.push('resolve/search validation and API JSON 404 remain intact');
 if(live){
  const located=await request('/api/resolve',{query:'台北101'});assert.equal(located.status,200);const {locations}=await located.json();const anchor=locations.find(a=>a.country==='TW');assert(anchor);
  for(const mode of ['food','attraction']){
   const searched=await request('/api/search',{anchor,query:'台北101',mode});assert.equal(searched.status,200);const data=await searched.json();assert.equal(data.mode,mode);assert(data.places.length<=50);
   assert(data.places.every((p,i)=>p.mode===mode&&p.rating===null&&(!i||data.places[i-1].distance<=p.distance)));
   checks.push({actualPublicHTTP:mode,count:data.places.length,center:data.anchor.displayName,providers:data.diagnostics.providers.map(p=>({provider:p.provider,status:p.status,valid:p.validCount}))});
  }
 }
 console.log(JSON.stringify({mode:development?'development':'production',node:process.version,checks},null,2));
}finally{
 if(child.exitCode===null){
  if(process.platform==='win32'){const stopped=spawn('taskkill',['/pid',String(child.pid),'/t','/f'],{stdio:'ignore'});await once(stopped,'close');}
  else process.kill(-child.pid,'SIGTERM');
  await closed;
 }
}
