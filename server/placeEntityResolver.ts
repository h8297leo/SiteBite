import { createHash } from 'node:crypto';
import { z } from 'zod';
import { CandidateSchema, PlaceCandidate, coords, distanceMeters } from '../shared/model';
import { ProviderContext } from './providers';
import { requestJson } from './http';
import { ExtractedPlace } from './webContentExtractor';

export type EntityVerification={candidate?:PlaceCandidate;reason?:string};
function normalize(s:string){return s.normalize('NFKC').replace(/台/g,'臺').toLowerCase().replace(/[\s\p{Punctuation}]/gu,'');}
export function sameVenue(a:Pick<PlaceCandidate,'name'|'aliases'|'latitude'|'longitude'>,b:Pick<PlaceCandidate,'name'|'aliases'|'latitude'|'longitude'>):boolean{
 const names=new Set([a.name,...a.aliases].map(normalize));return distanceMeters(a,b)<80&&[b.name,...b.aliases].some(n=>names.has(normalize(n)));
}
/** No search center injection. Address geocoding is candidate-specific, bounded and name/location checked. */
export async function resolvePlaceEntity(place:ExtractedPlace,ctx:ProviderContext,at:string,provider:string):Promise<EntityVerification>{
 if(place.mode!==ctx.mode)return{reason:'類別不符合目前探索模式'};
 if(!place.name.trim()||/^[\d\s號]+$/.test(place.name)||/^.+(?:路|街)\d+號$/.test(place.name))return{reason:'場所名稱為地址或無法辨識'};
 let latitude=place.latitude,longitude=place.longitude,locationEvidence=place.locationEvidence;
 const declared=latitude!==null&&longitude!==null?{latitude,longitude}:null;
 const reliableLocation=place.extraction==='encyclopedia'||place.officialLocationAuthority===true;
 if(!declared||!reliableLocation){
  if(!place.address&&!declared)return{reason:'只有名稱，缺少地址或座標'};
  const u=new URL('/api/','https://photon.komoot.io');u.searchParams.set('q',`${place.name} ${place.address??ctx.anchor.city}`);u.searchParams.set('limit','3');u.searchParams.set('lat',String(ctx.anchor.latitude));u.searchParams.set('lon',String(ctx.anchor.longitude));
  const env=z.object({features:z.array(z.object({geometry:z.object({coordinates:z.tuple([coords.longitude,coords.latitude])}),properties:z.object({name:z.string().optional(),street:z.string().optional(),housenumber:z.string().optional(),countrycode:z.string().optional()})}))});
  try{const response=await requestJson(u.href,ctx,raw=>env.parse(raw),{},86400000);const match=response.data.features.find(f=>{
   if(f.properties.countrycode&&ctx.anchor.country.length===2&&f.properties.countrycode.toUpperCase()!==ctx.anchor.country.toUpperCase())return false;
   const named=f.properties.name&&[place.name,...place.aliases].map(normalize).includes(normalize(f.properties.name));
   const street=f.properties.street&&place.address&&normalize(place.address).includes(normalize(f.properties.street));
   const house=f.properties.housenumber?.normalize('NFKC').trim();
   const number=house&&place.address&&new RegExp(`(?:^|[^0-9])${house.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}(?:$|[^0-9])`).test(place.address.normalize('NFKC'));
   const agrees=!declared||distanceMeters(declared,{longitude:f.geometry.coordinates[0],latitude:f.geometry.coordinates[1]})<=200;
   return agrees&&(named||Boolean(street&&number));
  });if(!match)return{reason:'地址解析未能確認名稱或完整門牌'};[longitude,latitude]=match.geometry.coordinates;locationEvidence+=`；獨立 Photon 名稱／地址匹配（${response.retrievedAt}）`;
  }catch{return{reason:'獨立地理交叉驗證失敗，未將網頁自行宣告的位置直接納入'};}
 }
 const geo=coords.latitude.safeParse(latitude),lng=coords.longitude.safeParse(longitude);if(!geo.success||!lng.success)return{reason:'座標格式或範圍無效'};
 if(distanceMeters(ctx.anchor,{latitude:geo.data,longitude:lng.data})>ctx.radius)return{reason:'超出本輪搜尋區域'};
 let website:string|null=null;try{if(place.officialUrl){const u=new URL(place.officialUrl);if(['http:','https:'].includes(u.protocol))website=u.href;}}catch{/* optional invalid link does not invalidate the place */}
 const result=CandidateSchema.safeParse({id:`web:${createHash('sha256').update(place.sourceUrl+'|'+place.name+'|'+latitude+'|'+longitude).digest('hex').slice(0,24)}`,name:place.name,originalName:place.name,aliases:place.aliases,entityId:place.entityId??null,mode:place.mode,category:place.category,latitude:geo.data,longitude:lng.data,address:place.address??'來源未提供可查證地址',sourceUrl:place.sourceUrl,retrievedAt:at,osmType:null,osmId:null,osmTags:{},mealTags:place.mode==='food'?(place.category==='咖啡廳'||place.category==='甜點'?['下午茶']:['午餐','晚餐']):[],featureTags:place.mode==='attraction'?(place.category==='公園'?['自然','戶外']:place.category==='博物館'||place.category==='展覽'?['文化']:['觀光']):[],openingHours:null,website,evidence:[{provider,sourceId:place.sourceUrl,url:place.sourceUrl,retrievedAt:at,kind:'public-article',description:`${place.categoryEvidence}；${locationEvidence}；無評分證據`,sourceType:place.extraction,providerName:provider,sourceUrl:place.sourceUrl,sourceTitle:place.sourceTitle,publishedAt:place.publishedAt,evidenceType:'place-location-category',extractedPlaceName:place.name,locationEvidence,categoryEvidence:place.categoryEvidence}],rating:null,reviewCount:null,popularityScore:null,localGemScore:null,ratingEvidence:[],socialEvidence:[]});
 if(result.success){result.data.website=website;return{candidate:result.data};}return{reason:'標準化候選格式驗證失敗'};
}
