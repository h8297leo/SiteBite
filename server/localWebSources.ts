import { z } from 'zod';
import { CandidateSchema, distanceMeters } from '../shared/model';
import { DiscoveryProvider, ProviderContext, ProviderResult } from './providers';
import { serviceError } from './http';
import { fetchPublicText } from './secureWeb';

/** Official public datasets are independent location evidence, not reviews. */
export class NewYorkFoodProvider implements DiscoveryProvider {
 id='NYC 官方餐飲開放資料'; role='public-web' as const;
 async search(ctx:ProviderContext):Promise<ProviderResult>{
  const start=Date.now(),endpoint='https://data.cityofnewyork.us/resource/43nn-pn8j.json';
  const run:ProviderResult['run']={provider:this.id,role:this.role,status:'skipped',round:ctx.round,radiusMeters:ctx.radius,rawCount:0,validCount:0,invalidCount:0,categoryExcluded:0,durationMs:0,requests:0,cached:false,error:null,endpoint,query:'依搜尋中心查詢紐約官方具名餐廳及座標',retrievedAt:null,webPages:0,parsedPages:0,extractedCandidates:0,verifiedPlaces:0,sourceType:'government-open-data',queries:[],exclusions:[]};
  const candidates:ProviderResult['candidates']=[];
  if(ctx.mode!=='food'||ctx.anchor.country!=='US'||ctx.anchor.latitude<40.4||ctx.anchor.latitude>41||ctx.anchor.longitude< -74.3||ctx.anchor.longitude> -73.5){run.error='不符合紐約餐飲資料涵蓋地區／模式';return{candidates,run};}
  try{
   const delta=ctx.radius/111000,dx=delta/Math.cos(ctx.anchor.latitude*Math.PI/180),u=new URL(endpoint);
   const fields='camis,dba,boro,building,street,zipcode,cuisine_description,latitude,longitude';
   u.searchParams.set('$select',fields);u.searchParams.set('$group',fields);u.searchParams.set('$limit','800');
   u.searchParams.set('$where',`latitude between ${ctx.anchor.latitude-delta} and ${ctx.anchor.latitude+delta} AND longitude between ${ctx.anchor.longitude-dx} and ${ctx.anchor.longitude+dx} AND dba IS NOT NULL AND boro != '0'`);
   run.query=u.href;run.queries=[u.href];
   const fetched=await fetchPublicText(u.href,ctx,{api:true,ttl:3600000});run.webPages=1;run.cached=fetched.cached;run.retrievedAt=fetched.retrievedAt;
   const rows=z.array(z.unknown()).parse(JSON.parse(fetched.data));run.parsedPages=1;run.rawCount=rows.length;
   for(const row of rows){
    const parsed=z.object({camis:z.string(),dba:z.string().min(1),boro:z.string(),building:z.string().optional(),street:z.string().optional(),zipcode:z.string().optional(),cuisine_description:z.string().optional(),latitude:z.coerce.number().min(40).max(41),longitude:z.coerce.number().min(-75).max(-73)}).safeParse(row);
    if(!parsed.success){run.invalidCount++;continue;}
    const p=parsed.data;run.extractedCandidates!++;
    if(distanceMeters(ctx.anchor,p)>ctx.radius){run.exclusions!.push(`${p.dba}：超出本輪範圍`);continue;}
    const cuisine=p.cuisine_description??'',category=/coffee|tea/i.test(cuisine)?'咖啡廳':/bakery|dessert|ice cream/i.test(cuisine)?'甜點':'餐廳';
    const sourceUrl=`https://data.cityofnewyork.us/resource/43nn-pn8j.json?camis=${encodeURIComponent(p.camis)}`;
    const address=[p.building,p.street,p.boro,'New York',p.zipcode].filter(Boolean).join(' ');
    const normalized=CandidateSchema.safeParse({id:`nyc:${p.camis}`,name:p.dba,originalName:p.dba,mode:'food',category,latitude:p.latitude,longitude:p.longitude,address,sourceUrl,retrievedAt:fetched.retrievedAt,osmType:null,osmId:null,osmTags:{},mealTags:[],featureTags:[],openingHours:null,website:null,
     evidence:[{provider:this.id,sourceId:p.camis,url:sourceUrl,retrievedAt:fetched.retrievedAt,kind:'public-article',description:'官方餐廳登記名稱、地址、分店識別碼及座標；不採用衛生檢查分數作推薦評分',sourceType:'government-open-data',providerName:this.id,sourceUrl,sourceTitle:'DOHMH New York City Restaurant Inspection Results',evidenceType:'official-location-record',extractedPlaceName:p.dba,locationEvidence:`${address} · ${p.latitude},${p.longitude}`,categoryEvidence:`官方餐廳資料集；餐飲類型 ${cuisine}`}],rating:null,reviewCount:null,popularityScore:null,localGemScore:null});
    if(normalized.success)candidates.push(normalized.data);else run.invalidCount++;
   }
   run.validCount=candidates.length;run.verifiedPlaces=candidates.length;run.status='success';return{candidates,run};
  }catch(e){run.status='failed';run.error=serviceError(e);return{candidates,run};}finally{run.durationMs=Date.now()-start;run.requests=ctx.meter?.requests??0;run.exclusions=run.exclusions?.slice(0,20);}
 }
}

export const websiteSources=[
 {id:'wikimedia',regions:['global'],access:'integrated',policy:'官方 MediaWiki API，保留文章網址與授權'},
 {id:'nyc-dohmh',regions:['US-NYC'],access:'integrated',policy:'官方 Socrata 公開資料 API，不取得評論／推薦評分'},
 {id:'taipei-travel',regions:['TW'],access:'blocked',policy:'2026-10-12 官方 Open API 回傳 Cloudflare 驗證；不繞過'},
 {id:'taiwan-tourism',regions:['TW'],access:'blocked',policy:'P1.5 官方 ZIP 端點拒絕自動存取；保留失敗診斷'},
 {id:'regional-html',regions:['TW','JP','KR','FR','US'],access:'configured-only',policy:'WEB_SOURCE_URLS 公開頁面需遵守 robots、條款及網址安全驗證；未配置網站不宣稱完成'},
 {id:'searxng',regions:['global'],access:'configured-only',policy:'只接入自架或取得允許的實例；要求 JSON 可用，禁止任意實例輪換'},
 {id:'duckduckgo',regions:['global'],access:'unavailable',policy:'未建立允許程式化完整搜尋的介面；不抓驗證頁面／不冒充百科結果'},
 ...['Google Search','Google Maps','Threads','Instagram','Facebook','PTT','Dcard','Reddit'].map(id=>({id,regions:['global'],access:'link-evidence-only',policy:'只保留合法搜尋取得的連結／摘要；未整合內容擷取或評分'})),
];
