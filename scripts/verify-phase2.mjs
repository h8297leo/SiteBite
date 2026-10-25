import {writeFile,readFile} from 'node:fs/promises';
const stage=process.argv[2]||'baseline';
if(stage==='compare'){
 const baseline=JSON.parse(await readFile('docs/PHASE2-BASELINE.json','utf8')),after=JSON.parse(await readFile('docs/PHASE2-AFTER.json','utf8'));
 const norm=s=>s.normalize('NFKC').toLowerCase().replace(/台/g,'臺').replace(/[\s\p{P}]/gu,'');
 const meters=(a,b)=>{const r=v=>v*Math.PI/180,h=Math.sin(r(b.latitude-a.latitude)/2)**2+Math.cos(r(a.latitude))*Math.cos(r(b.latitude))*Math.sin(r(b.longitude-a.longitude)/2)**2;return 6371000*2*Math.asin(Math.min(1,Math.sqrt(h)));};
 const same=(a,b)=>a.id===b.id||(meters(a,b)<80&&[a.name,a.originalName,...a.aliases].map(norm).some(n=>[b.name,b.originalName,...b.aliases].map(norm).includes(n)));
 const rows=after.results.filter(v=>v.response).map(item=>{
  const prior=baseline.results.find(v=>v.query===item.query&&v.mode===item.mode&&v.response),a=item.response,b=prior?.response;
  const web=a.places.filter(p=>p.osmId===null&&p.evidence.some(e=>e.kind==='public-article'));
  const newVisible=web.filter(p=>!b?.places.some(v=>same(p,v)));
  const addedEvidence=a.places.reduce((sum,p)=>{const old=b?.places.find(v=>same(p,v));return sum+(old?p.evidence.filter(e=>!old.evidence.some(o=>o.url===e.url)).length:0);},0);
  return{query:item.query,mode:item.mode,baselineCenter:b?.anchor,afterCenter:a.anchor,centerShiftMeters:b?Math.round(meters(b.anchor,a.anchor)):null,baselineResolutionError:prior?.originalResolutionError,baselineFinal:b?.places.length,baselineVisibleOsm:b?.places.filter(p=>p.osmId!==null).length,baselineOsmProviderRounds:b?.diagnostics.providers.filter(p=>p.provider==='Overpass OSM').map(p=>({round:p.round,status:p.status,validBeforePoolDedup:p.validCount})),afterFinal:a.places.length,afterVisibleOsm:a.places.filter(p=>p.osmId!==null).length,afterOsmPool:a.diagnostics.osmPool??null,webDiscovery:a.diagnostics.webDiscovery??null,newWebOnlyFinalNotInBaseline:newVisible.length,newWebOnlyNames:newVisible.map(p=>p.name),sameVenueAdditionalSourceEvidence:addedEvidence,baselineMs:prior?.elapsedMs,afterMs:item.elapsedMs,timeChangeMs:prior?item.elapsedMs-prior.elapsedMs:null,checks:item.checks};
 });
 const aggregate=r=>{const map=new Map();for(const item of r.results.filter(v=>v.response))for(const run of item.response.diagnostics.providers){let v=map.get(run.provider)||{provider:run.provider,runs:0,attempted:0,failed:0,partial:0,skipped:0,httpRequests:0};v.runs++;v.httpRequests+=run.requests;if(run.status==='skipped')v.skipped++;else{v.attempted++;if(run.status==='failed')v.failed++;if(run.status==='partial')v.partial++;}map.set(run.provider,v);}return [...map.values()].map(v=>({...v,failureRate:v.attempted?v.failed/v.attempted:null,incompleteRate:v.attempted?(v.failed+v.partial)/v.attempted:null}));};
 const report={performedAt:new Date().toISOString(),notes:['非同時 A/B 測試；來源狀態、快取、搜尋半徑及修正的搜尋中心均會影響差異。','baselineVisibleOsm 只計最終50筆中的OSM；提供者 validCount 可能含各輪重複，不是獨立候選池數量。','newWebOnlyFinalNotInBaseline 為可見結果前後差異，未證明該場所絕對不在OSM資料庫；webDiscovery addedToPool 是本次各來源真正加入候選池的紀錄。'],rows,baselineFailures:aggregate(baseline),afterFailures:aggregate(after)};
 await writeFile('docs/PHASE2-COMPARISON.json',JSON.stringify(report,null,2));
 const lines=['# Phase 2 實際 HTTP 與量化比較','',`產生時間：${report.performedAt}`,'','完整修改前回應：`PHASE2-BASELINE.json`；修改後：`PHASE2-AFTER.json`；量化比較：`PHASE2-COMPARISON.json`。這些是實際 HTTP 公開資料測試，與 `tests/publicWeb.test.ts` 的7項模擬单元測試分開。','',...report.notes.map(n=>`- ${n}`),'','## 雙模式結果與新增來源貢獻','','「提取／驗證」是逐輪處理次数，可能重複；「新增池／最終」為本次來源貢獻去重後的独立地點。「舊OSM可見」只計修改前最終結果内有 OSM 識別碼的數量，未宣稱為未截取候選池總數。','','|輸入／模式|舊總數／OSM可見|新總數|網頁提取／驗證|新增池／最終|與OSM合併／额外證據|耗時舊→新（秒）|','|---|---:|---:|---:|---:|---:|---:|',...rows.map(r=>{const w=r.webDiscovery||{};return`|${r.query}／${r.mode==='food'?'美食':'景點'}|${r.baselineFinal}/${r.baselineVisibleOsm}|${r.afterFinal}|${w.extracted??0}/${w.verified??0}|${w.addedToPool??0}/${w.addedToFinal??0}|${w.osmDuplicates??0}/${w.additionalEvidence??0}|${(r.baselineMs/1000).toFixed(1)}→${(r.afterMs/1000).toFixed(1)}|`;}),'','## 修改後來源狀態','','失敗率分母為實際嘗試的 Provider 執行輪次；partial 為部分未完成。「未執行」不算成功，也不納入失敗率。所有來源共用有界請求與時間預算。','','|來源|實際嘗試|失敗|部分|未執行|失敗率|','|---|---:|---:|---:|---:|---:|',...report.afterFailures.map(v=>`|${v.provider}|${v.attempted}|${v.failed}|${v.partial}|${v.skipped}|${v.failureRate===null?'未執行':(100*v.failureRate).toFixed(1)+'%'}|`),'','## 限制與驗收範圍','','- 通用 SearXNG 未設定明確允許自動查詢的實例；DuckDuckGo 未宣稱可用。Wikipedia 關鍵字是限定百科的全文搜尋，Wikivoyage 是限定旅遊網站的文章搜尋，不能冒充全網搜尋。','- 任意地方美食／旅遊文章清單目前為選配擷取介面；未配置來源不算已整合。陌生 JSON-LD 自報座標須獨立地理驗證；不會只以文章標題生成場所。','- Wikidata 實體紀錄不是 HTML 網頁；診斷的網頁數不包含這些實體數。NYC 官方資料回應以一個資料文件計算，不把800筆紀錄說成800個網頁。','- 觀光署ZIP仍限制自動存取；沒有繞過。Overpass 的逾時／429／冷卻可能使某地餐飲結果不足或為0；保留真實診斷與已完成來源。','- 舊版首爾／巴黎／紐約中文輸入失敗後使用測試者英文重試；修改後原始輸入解析結果及所有替代位置完整保存在紀錄中。東京修正前後搜尋中心不同，因此結果差異不能全歸因於新來源。','- 名稱、分類及距離檢查皆為程式檢查，不等於每一場所的人工現地確認；未取得評論時所有分數為 null。','- 首次執行時網站尚未啟動的8筆連線失敗單獨保存在 `PHASE2-STARTUP-NOT-READY.json`，不納入公開來源失敗率。',''];
 await writeFile('docs/PHASE2-SEARCH-REPORT.md',lines.join('\n').replace(/单/g,'單').replace(/次数/g,'次數').replace(/独立/g,'獨立').replace(/额外/g,'額外').replace(/结果内/g,'結果內').replace(/数量/g,'數量').replace(/内/g,'內').replace('失敗率分母為實際嘗試的 Provider 執行輪次','失敗率分母為非 skipped 的 Provider 執行輪次（包含來源冷卻直接返回失敗，並非 HTTP 請求成功率）'));
 console.log(JSON.stringify({cases:rows.length,totals:rows.reduce((t,r)=>({pool:t.pool+(r.webDiscovery?.addedToPool||0),final:t.final+(r.webDiscovery?.addedToFinal||0),evidence:t.evidence+(r.webDiscovery?.additionalEvidence||0)}),{pool:0,final:0,evidence:0})}));process.exit(0);
}
const cases=[['台北101','TW'],['龍潭大池','TW'],['台南市中心','TW'],['東京新宿','JP'],['大阪難波','JP'],['首爾明洞','KR'],['巴黎艾菲爾鐵塔','FR'],['紐約時代廣場','US']];
let output={stage,startedAt:new Date().toISOString(),type:'actual HTTP via application; no mocked providers',results:[]};
const filename=`docs/PHASE2-${stage.toUpperCase()}.json`;
if(process.argv.includes('--resume'))output=JSON.parse(await readFile(filename,'utf8'));
async function save(){output.updatedAt=new Date().toISOString();await writeFile(filename,JSON.stringify(output,null,2));}
async function post(path,body){const start=Date.now();const r=await fetch('http://127.0.0.1:3000'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(100000)});const data=await r.json();if(!r.ok)throw Error(`${r.status}: ${data.error}`);return {data,elapsedMs:Date.now()-start};}
const health=await fetch('http://127.0.0.1:3000/api/health',{signal:AbortSignal.timeout(10000)});if(!health.ok)throw Error('Backend not ready');output.backend=await health.json();console.log(JSON.stringify({backend:output.backend}));
for(const [query,country] of cases){
 if(output.results.some(v=>v.query===query&&v.mode==='attraction'))continue;
 try{
  let resolution,resolvedQuery=query,originalResolutionError=null;
  try{({data:resolution}=await post('/api/resolve',{query}));}catch(e){
   originalResolutionError=e.message;
   const testerTranslations={'首爾明洞':'Myeongdong Seoul','巴黎艾菲爾鐵塔':'Eiffel Tower Paris','紐約時代廣場':'Times Square New York'};
   if(!testerTranslations[query])throw e;
   resolvedQuery=testerTranslations[query];({data:resolution}=await post('/api/resolve',{query:resolvedQuery}));
  }
  const alternatives=resolution.locations||[];
  const countryChoices=alternatives.filter(a=>a.country===country);
  // Select a real resolver alternative, with explicit country and name/context checks; never inject coordinates.
  const terms=query.replace(/台北|東京|大阪|首爾|巴黎|紐約|市中心/g,'').split(/\s+/).filter(Boolean);
  const anchor=countryChoices.find(a=>terms.every(t=>`${a.name} ${a.displayName}`.includes(t)))||countryChoices[0];
  if(!anchor)throw Error('No resolver alternative in expected country '+country);
  console.log(JSON.stringify({query,selected:anchor,alternatives}));
  for(const mode of ['food','attraction']){
   try{
    const {data:r,elapsedMs}=await post('/api/search',{anchor,query,mode});
    const item={query,resolvedQuery,originalResolutionError,expectedCountry:country,mode,selectionRule:'explicit country then matching location-name tokens; fallback first expected-country alternative. English retry is a manual tester translation, not application capability.',alternatives,selectedAnchor:anchor,elapsedMs,response:r,checks:{country:r.anchor.country===country,mode:r.places.every(p=>p.mode===mode),sorted:r.places.every((p,i)=>!i||r.places[i-1].distance<=p.distance),noInjectedCenter:r.places.every(p=>p.id!==anchor.id),noScores:r.places.every(p=>p.rating===null&&p.popularityScore===null&&p.localGemScore===null)}};
    output.results.push(item);console.log(JSON.stringify({query,mode,count:r.places.length,center:r.anchor.displayName,elapsedMs,providers:r.diagnostics.providers.map(p=>({provider:p.provider,status:p.status,raw:p.rawCount,valid:p.validCount,error:p.error})),checks:item.checks}));
   }catch(e){output.results.push({query,mode,error:e.message,alternatives,selectedAnchor:anchor});console.log(JSON.stringify({query,mode,error:e.message}));}
   await save();
  }
 }catch(e){output.results.push({query,error:e.message});console.log(JSON.stringify({query,error:e.message}));await save();}
}
output.finishedAt=new Date().toISOString();await save();
