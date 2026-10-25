import { unzipSync, strFromU8 } from 'fflate';
import { z } from 'zod';
import { CandidateSchema, PlaceCandidate, distanceMeters, coords, ProviderRun } from '../shared/model';
import { DiscoveryProvider, ProviderContext, ProviderResult } from './providers';
import { requestJson, serviceError } from './http';

const Restaurant=z.object({RestaurantID:z.string(),RestaurantName:z.string().min(1),PositionLat:coords.latitude,PositionLon:coords.longitude,AlternateNames:z.array(z.string()).optional(),Description:z.string().optional(),PostalAddress:z.object({City:z.string().optional(),Town:z.string().optional(),StreetAddress:z.string().optional()}).optional(),ServiceTimeInfo:z.string().optional(),ServiceStatus:z.number().optional(),WebsiteURL:z.string().optional(),SameAsURLs:z.array(z.string()).optional()});
const Attraction=Restaurant.omit({RestaurantID:true,RestaurantName:true}).extend({AttractionID:z.string(),AttractionName:z.string().min(1)});
const deniedUntil=new Map<string,number>();
export class TaiwanFoodProvider implements DiscoveryProvider{
  id='觀光署公開餐飲資料';role='public-web' as const;
  async search(ctx:ProviderContext):Promise<ProviderResult>{
    const start=Date.now(),meter={requests:0};ctx={...ctx,meter};
    const endpoint=process.env.TAIWAN_FOOD_URL??'https://media.taiwan.net.tw/XMLReleaseAll_public/v2.0/Zh_tw/Restaurant-json.zip';
    const run={provider:this.id,role:this.role,status:'success' as 'success'|'failed'|'skipped',round:ctx.round,radiusMeters:ctx.radius,rawCount:0,validCount:0,invalidCount:0,categoryExcluded:0,durationMs:0,requests:0,cached:false,error:null as string|null,endpoint,query:'官方餐飲目錄 → 有名稱與座標 → 本輪範圍驗證',retrievedAt:null as string|null};
    const candidates:PlaceCandidate[]=[];
    if(ctx.mode!=='food'||ctx.anchor.country!=='TW'){run.status='skipped';run.error='此來源只涵蓋台灣餐飲；未發送請求';return{candidates,run};}
    if((deniedUntil.get(endpoint)??0)>Date.now()){run.status='skipped';run.error='最近回傳安全性封鎖；暫停請求，未繞過';return{candidates,run};}
    try{
      const data=await requestJson(endpoint,ctx,v=>z.object({Restaurants:z.array(z.unknown())}).parse(v),{},86400000,async response=>{
        if(response.headers.get('content-type')?.includes('text/html'))throw new Error('來源拒絕自動存取；未繞過安全性封鎖');
        const files=unzipSync(new Uint8Array(await response.arrayBuffer()),{filter:f=>f.name.endsWith('RestaurantList.json')});
        const file=Object.values(files)[0];if(!file)throw new Error('公開ZIP沒有餐飲資料檔');return JSON.parse(strFromU8(file));
      });
      run.cached=data.cached;run.retrievedAt=data.retrievedAt;
      for(const raw of data.data.Restaurants){
        const parsed=Restaurant.safeParse(raw);if(!parsed.success){run.invalidCount++;continue;}const r=parsed.data;
        if(distanceMeters(ctx.anchor,{latitude:r.PositionLat,longitude:r.PositionLon})>ctx.radius)continue;run.rawCount++;
        if(r.ServiceStatus!==undefined&&r.ServiceStatus!==1){run.categoryExcluded++;continue;}
        // This is a restaurant directory, not geocoding: food evidence comes from its entity schema.
        const text=`${r.RestaurantName} ${r.Description??''}`;
        const category=/咖啡|coffee|café|cafe/i.test(r.RestaurantName)?'咖啡廳':/蛋糕|甜品|甜點|烘焙|冰店|豆花|糕餅|餅舖|麵包/.test(r.RestaurantName)?'甜點':/小吃|麵館|米粉|粄條|肉圓|水餃|豆漿/.test(r.RestaurantName)?'小吃':'餐廳';
        const mealTags=[];if(/早餐|早午餐/.test(text))mealTags.push('早餐');if(/宵夜|24小時/.test(r.ServiceTimeInfo??''))mealTags.push('宵夜');
        let website:string|null=null;try{const u=new URL(r.WebsiteURL??'');if(['http:','https:'].includes(u.protocol))website=u.href;}catch{}
        const url='https://data.gov.tw/dataset/7779';
        const p=CandidateSchema.safeParse({id:`tourism:${r.RestaurantID}`,name:r.RestaurantName,originalName:r.RestaurantName,aliases:r.AlternateNames??[],mode:'food',category,latitude:r.PositionLat,longitude:r.PositionLon,address:[r.PostalAddress?.City,r.PostalAddress?.Town,r.PostalAddress?.StreetAddress].filter(Boolean).join('')||'未取得公開地址',mealTags,mealEvidence:mealTags.map(meal=>({meal,status:"confirmed",raw:(r.ServiceTimeInfo??text).slice(0,1000),openingHours:r.ServiceTimeInfo??null,sourceUrl:endpoint,evidenceType:"source-meal",verificationStatus:"verified"})),featureTags:[],sourceUrl:url,retrievedAt:data.retrievedAt,osmType:null,osmId:null,osmTags:{},openingHours:r.ServiceTimeInfo||null,website,evidence:[{provider:this.id,sourceId:r.RestaurantID,url:endpoint,retrievedAt:data.retrievedAt,kind:'public-article',description:'官方餐飲開放資料：RestaurantName / PositionLat / PositionLon；來源ID可在下載檔追溯'}],rating:null,reviewCount:null,popularityScore:null,localGemScore:null});
        if(p.success)candidates.push(p.data);else run.invalidCount++;
      }
      run.validCount=candidates.length;return{candidates,run};
    }catch(e){run.status='failed';run.error=serviceError(e);if(run.error.includes('拒絕自動存取'))deniedUntil.set(endpoint,Date.now()+3600000);return{candidates,run};}
    finally{run.requests=meter.requests;run.durationMs=Date.now()-start;}
  }
}
export class TaiwanAttractionProvider implements DiscoveryProvider{
  id='觀光署公開景點資料';role='public-web' as const;
  async search(ctx:ProviderContext):Promise<ProviderResult>{
    const start=Date.now(),meter={requests:0};ctx={...ctx,meter};
    const endpoint=process.env.TAIWAN_ATTRACTION_URL??'https://media.taiwan.net.tw/XMLReleaseAll_public/v2.0/Zh_tw/Attraction-json.zip';
    const run:ProviderRun={provider:this.id,role:this.role,status:'success',round:ctx.round,radiusMeters:ctx.radius,rawCount:0,validCount:0,invalidCount:0,categoryExcluded:0,durationMs:0,requests:0,cached:false,error:null,endpoint,query:'官方景點目錄 → 具名景點與座標 → 範圍及地理項目排除',retrievedAt:null};
    const candidates:PlaceCandidate[]=[];
    if(ctx.mode!=='attraction'||ctx.anchor.country!=='TW'){run.status='skipped';run.error='此來源只涵蓋台灣景點；未發送請求';return{candidates,run};}
    if((deniedUntil.get(endpoint)??0)>Date.now()){run.status='skipped';run.error='最近回傳安全性封鎖；暫停請求，未繞過';return{candidates,run};}
    try{
      const data=await requestJson(endpoint,ctx,v=>z.object({Attractions:z.array(z.unknown())}).parse(v),{},86400000,async response=>{
        if(response.headers.get('content-type')?.includes('text/html'))throw new Error('來源拒絕自動存取；未繞過安全性封鎖');
        const files=unzipSync(new Uint8Array(await response.arrayBuffer()),{filter:f=>f.name.endsWith('AttractionList.json')});const file=Object.values(files)[0];if(!file)throw new Error('ZIP沒有景點資料');return JSON.parse(strFromU8(file));
      });run.cached=data.cached;run.retrievedAt=data.retrievedAt;
      for(const raw of data.data.Attractions){const parsed=Attraction.safeParse(raw);if(!parsed.success){run.invalidCount++;continue;}const r=parsed.data;
        if(distanceMeters(ctx.anchor,{latitude:r.PositionLat,longitude:r.PositionLon})>ctx.radius)continue;run.rawCount++;
        const name=r.AttractionName;
        if((r.ServiceStatus!==undefined&&r.ServiceStatus!==1)||/^[\d\s號]+$/.test(name)||/(?:行政區|里辦公處|區公所|縣政府|市政府|交流道)$/.test(name)||(/(?:街|路|大道)$/.test(name)&&!/(?:老街|步道|古道)/.test(name))){run.categoryExcluded++;continue;}
        const category=/博物館|紀念館|文物館/.test(name)?'博物館':/美術館|展覽|藝廊/.test(name)?'展覽':/公園|植物園|花園/.test(name)?'公園':/廟|寺|宮|祠|文化|劇場|教堂/.test(name)?'文化':/古蹟|古厝|城門|堡|遺址|老街/.test(name)?'古蹟':/動物園|遊樂園|水族館|小人國/.test(name)?'親子':/步道|古道|自行車道/.test(name)?'戶外':/湖|池|瀑布|山|海灘|濕地|森林|自然|溪/.test(name)?'自然':/觀景|眺望/.test(name)?'觀景':'地標';
        const featureTags=['公園','自然','戶外'].includes(category)?['自然','戶外']:category==='古蹟'?['歷史','文化']:['博物館','展覽','文化'].includes(category)?['文化']:category==='親子'?['親子']:category==='觀景'?['拍照','戶外']:['觀光'];
        let website:string|null=null;try{const u=new URL(r.WebsiteURL??'');if(['http:','https:'].includes(u.protocol))website=u.href;}catch{}
        const sourceUrl='https://data.gov.tw/dataset/7777';const p=CandidateSchema.safeParse({id:`tourism:${r.AttractionID}`,name,originalName:name,aliases:r.AlternateNames??[],mode:'attraction',category,latitude:r.PositionLat,longitude:r.PositionLon,address:[r.PostalAddress?.City,r.PostalAddress?.Town,r.PostalAddress?.StreetAddress].filter(Boolean).join('')||'未取得公開地址',mealTags:[],featureTags,sourceUrl,retrievedAt:data.retrievedAt,osmType:null,osmId:null,osmTags:{},openingHours:r.ServiceTimeInfo||null,website,evidence:[{provider:this.id,sourceId:r.AttractionID,url:endpoint,retrievedAt:data.retrievedAt,kind:'public-article',description:'官方旅遊景點目錄名稱與獨立座標；非中心解析資料'}],rating:null,reviewCount:null,popularityScore:null,localGemScore:null});if(p.success)candidates.push(p.data);else run.invalidCount++;
      }run.validCount=candidates.length;return{candidates,run};
    }catch(e){run.status='failed';run.error=serviceError(e);if(run.error.includes('拒絕自動存取'))deniedUntil.set(endpoint,Date.now()+3600000);return{candidates,run};}
    finally{run.requests=meter.requests;run.durationMs=Date.now()-start;}
  }
}
