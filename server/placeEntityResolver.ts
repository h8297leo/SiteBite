import { createHash } from 'node:crypto';
import { z } from 'zod';
import { CandidateSchema, PlaceCandidate, coords, distanceMeters } from '../shared/model';
import type { ProviderContext } from './providers';
import { requestJson } from './http';
import { fetchPublicText } from './secureWeb';
import { ExtractedPlace, venueKind } from './webContentExtractor';
import { collectMealEvidence } from '../shared/meals';
export type EntityVerification={candidate?:PlaceCandidate;reason?:string;status:'verified'|'pending'|'rejected'};
const normalize=(s:string)=>s.normalize('NFKC').replace(/台/g,'臺').toLowerCase().replace(/[\s\p{Punctuation}]/gu,'');
export const entityKey=(p:ExtractedPlace)=>`${p.mode}|${normalize(p.name)}|${normalize(p.address??'')}|${p.address?'':`${p.latitude},${p.longitude}`}`;
export function completeAddress(address:string|null){return Boolean(address&&address.length>=6&&/[0-9０-９]/.test(address)&&/路|街|號|丁目|番|street|\bst\b|road|\brd\b|avenue|\bave\b|rue|boulevard|straße|strasse|로|길/i.test(address));}
export function prioritizeDrafts(places:ExtractedPlace[]){
 const groups=new Map<string,ExtractedPlace[]>();for(const p of places){const key=entityKey(p);groups.set(key,[...(groups.get(key)??[]),p]);}
 const score=(items:ExtractedPlace[])=>Math.max(...items.map(p=>(p.officialLocationAuthority?100:0)+(p.latitude!==null&&p.longitude!==null?40:0)+(completeAddress(p.address)?30:0)))+Math.min(20,new Set(items.map(p=>new URL(p.sourceUrl).hostname)).size*5);
 return [...groups.values()].sort((a,b)=>score(b)-score(a)).map(items=>items.sort((a,b)=>Number(Boolean(b.officialLocationAuthority))-Number(Boolean(a.officialLocationAuthority))||Number(b.latitude!==null)-Number(a.latitude!==null)));
}
export function sameVenue(a:Pick<PlaceCandidate,'name'|'aliases'|'latitude'|'longitude'>,b:Pick<PlaceCandidate,'name'|'aliases'|'latitude'|'longitude'>){return distanceMeters(a,b)<80&&[b.name,...b.aliases].some(n=>[a.name,...a.aliases].map(normalize).includes(normalize(n)));}
const pending=(reason:string):EntityVerification=>({status:'pending',reason});
const rejected=(reason:string):EntityVerification=>({status:'rejected',reason});
export async function resolvePlaceEntity(place:ExtractedPlace,ctx:ProviderContext,at:string,provider:string):Promise<EntityVerification>{
 ctx.signal.throwIfAborted();
 if(place.mode!==ctx.mode)return rejected('類別不符合目前探索模式');
 if(!place.name.trim()||/^[\d\s號]+$/.test(place.name)||/^.+(?:路|街)\d+號$/.test(place.name))return rejected('場所名稱為地址或無法辨識');
 const kind=place.venueKind??venueKind(place.name);
 if(ctx.mode==='food'&&['market','food-court','shopping-area'].includes(kind))return rejected('夜市／美食街是場所集合，不是個別店家');
 let latitude=place.latitude,longitude=place.longitude,locationEvidence=place.locationEvidence;
 const declared=latitude!==null&&longitude!==null?{latitude,longitude}:null;
 if(declared&&(!coords.latitude.safeParse(declared.latitude).success||!coords.longitude.safeParse(declared.longitude).success))return rejected('來源座標無效');
 if(declared&&distanceMeters(ctx.anchor,declared)>ctx.radius)return rejected('超出本輪搜尋區域');
 const names=[place.name,...place.aliases].map(normalize);
 const peers=(ctx.validationPeers??[]).filter(p=>p!==place&&names.includes(normalize(p.name))&&p.address&&place.address&&normalize(p.address)===normalize(place.address));
 if(declared&&peers.some(p=>p.latitude!==null&&p.longitude!==null&&distanceMeters(declared,{latitude:p.latitude,longitude:p.longitude})>200))return pending('同名同址來源座標互相矛盾，需確認分店位置');
 const references=(ctx.referenceCandidates??[]).filter(p=>p.mode===place.mode&&[p.name,p.originalName,...p.aliases].some(n=>names.includes(normalize(n)))&&distanceMeters(ctx.anchor,p)<=ctx.radius&&(!declared||distanceMeters(declared,p)<=120)&&(!completeAddress(place.address)||!completeAddress(p.address)||normalize(place.address!)===normalize(p.address)));
 // A matching brand at several locations is not a verified branch.
 const ref=references.length===1?references[0]:undefined;
 let reliable=place.extraction==='encyclopedia'||place.officialLocationAuthority===true;
 if(ref){latitude=ref.latitude;longitude=ref.longitude;reliable=true;locationEvidence+=`；獨立場所識別 ${ref.id}／名稱／地理範圍比對`;}
 if(!reliable&&declared&&place.address){
  const peer=(ctx.validationPeers??[]).find(p=>p!==place&&new URL(p.sourceUrl).hostname!==new URL(place.sourceUrl).hostname&&names.includes(normalize(p.name))&&p.address&&normalize(p.address)===normalize(place.address!)&&p.latitude!==null&&p.longitude!==null&&distanceMeters(declared,{latitude:p.latitude,longitude:p.longitude})<80);
  if(peer){reliable=true;locationEvidence+=`；不同來源網域 ${new URL(peer.sourceUrl).hostname} 同名、完整地址及座標一致`;}
 }
 if(!declared&&!ref&&!place.address)return pending('已提及具名場所，但沒有足以定位的地址或座標');
 if(!reliable||latitude===null||longitude===null){
  const key=entityKey(place);if(ctx.geocodeBudget?.attempted?.has(key))return pending('此候選本次已查詢地理來源而未確認；保留待驗證，避免重複請求');
  if(!declared&&!completeAddress(place.address))return pending('地址不完整，尚不足以確認個別場所位置');
  if(ctx.geocodeBudget&&ctx.geocodeBudget.remaining<=0)return pending('本次地理驗證請求預算已用完');
  if(ctx.geocodeBudget){ctx.geocodeBudget.remaining--;ctx.geocodeBudget.attempted?.add(key);}
  const u=new URL('/api/',process.env.PHOTON_URL??'https://photon.komoot.io');u.searchParams.set('q',`${place.name} ${place.address??ctx.anchor.city}`);u.searchParams.set('limit','3');u.searchParams.set('lat',String(ctx.anchor.latitude));u.searchParams.set('lon',String(ctx.anchor.longitude));
  const schema=z.object({features:z.array(z.object({geometry:z.object({coordinates:z.tuple([coords.longitude,coords.latitude])}),properties:z.object({name:z.string().optional(),street:z.string().optional(),housenumber:z.string().optional(),countrycode:z.string().optional(),osm_key:z.string().optional()})}))});
  let matched=false;
  try{
   const r=await requestJson(u.href,{...ctx,signal:AbortSignal.any([ctx.signal,AbortSignal.timeout(4500)])},v=>schema.parse(v),{},86400000);
   const matches=r.data.features.filter(f=>{
    const p=f.properties;if(['place','boundary','highway'].includes(p.osm_key??''))return false;
    const named=p.name&&names.includes(normalize(p.name));const street=p.street&&place.address&&normalize(place.address).includes(normalize(p.street));
    const number=p.housenumber&&place.address&&new RegExp(`(?:^|[^0-9])${p.housenumber.normalize('NFKC').replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}(?:$|[^0-9])`).test(place.address.normalize('NFKC'));
    const point={longitude:f.geometry.coordinates[0],latitude:f.geometry.coordinates[1]};
    return (!p.countrycode||ctx.anchor.country.length!==2||p.countrycode.toUpperCase()===ctx.anchor.country.toUpperCase())&&(named||Boolean(street&&number))&&distanceMeters(ctx.anchor,point)<=ctx.radius&&(!declared||distanceMeters(declared,point)<=200);
   });
   if(matches.length===1){[longitude,latitude]=matches[0].geometry.coordinates;matched=true;locationEvidence+='；Photon具名場所／完整門牌交叉驗證';}
  }catch{ctx.signal.throwIfAborted();}
  if(!matched&&place.address){
   // User-triggered, bounded address verification only; no autocomplete or bulk city geocoding.
   const n=new URL('/search',process.env.NOMINATIM_URL??'https://nominatim.openstreetmap.org');n.searchParams.set('q',`${place.name} ${place.address}`);n.searchParams.set('format','jsonv2');n.searchParams.set('addressdetails','1');n.searchParams.set('namedetails','1');n.searchParams.set('limit','3');
   if(n.hostname==='nominatim.openstreetmap.org'&&ctx.geocodeBudget){if((ctx.geocodeBudget.nominatimRemaining??2)<=0)return pending('公共 Nominatim 本次少量地址驗證額度已用完');ctx.geocodeBudget.nominatimRemaining=(ctx.geocodeBudget.nominatimRemaining??2)-1;}
   if(/^[A-Z]{2}$/.test(ctx.anchor.country))n.searchParams.set('countrycodes',ctx.anchor.country.toLowerCase());
   try{
    const r=await fetchPublicText(n.href,{...ctx,signal:AbortSignal.any([ctx.signal,AbortSignal.timeout(4500)])},{api:true,ttl:86400000});
    const rows=z.array(z.object({lat:z.coerce.number(),lon:z.coerce.number(),name:z.string().optional(),display_name:z.string(),category:z.string().optional(),type:z.string().optional(),address:z.record(z.string()).optional(),namedetails:z.record(z.string()).optional()})).parse(JSON.parse(r.data));
    const matches=rows.filter(p=>{
     if(['boundary','highway'].includes(p.category??'')||['city','town','village','administrative'].includes(p.type??''))return false;
     const exact=[p.name,...Object.values(p.namedetails??{})].some(s=>s&&names.includes(normalize(s)));
     const a=p.address??{};if(a.country_code&&ctx.anchor.country.length===2&&a.country_code.toUpperCase()!==ctx.anchor.country.toUpperCase())return false;
     const full=a.house_number&&[a.road,a.pedestrian,a.street].some(st=>st&&normalize(place.address!).includes(normalize(st)))&&new RegExp(`(?:^|[^0-9])${a.house_number.normalize('NFKC').replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}(?:$|[^0-9])`).test(place.address!.normalize('NFKC'));
     const point={latitude:p.lat,longitude:p.lon};return (exact||full)&&distanceMeters(ctx.anchor,point)<=ctx.radius&&(!declared||distanceMeters(declared,point)<=200);
    });
    if(matches.length===1){latitude=matches[0].lat;longitude=matches[0].lon;matched=true;locationEvidence+='；Nominatim獨立名稱／完整門牌驗證';}
   }catch{ctx.signal.throwIfAborted();}
  }
  if(!matched)return pending('地理來源尚無法確認個別分店的位置；未判定場所不存在');
 }
 const lat=coords.latitude.safeParse(latitude),lon=coords.longitude.safeParse(longitude);if(!lat.success||!lon.success)return rejected('座標格式或範圍無效');
 if(distanceMeters(ctx.anchor,{latitude:lat.data,longitude:lon.data})>ctx.radius)return rejected('超出本輪搜尋區域');
 let website:string|null=null;try{if(place.officialUrl){const u=new URL(place.officialUrl);if(['http:','https:'].includes(u.protocol))website=u.href;}}catch{}
 const evidence=[{provider,sourceId:place.sourceUrl,url:place.sourceUrl,retrievedAt:at,kind:'public-article' as const,description:`${place.categoryEvidence}；${locationEvidence}；無評分證據`,sourceType:place.extraction,providerName:provider,sourceUrl:place.sourceUrl,sourceTitle:place.sourceTitle,publishedAt:place.publishedAt,evidenceType:'place-location-category',extractedPlaceName:place.name,locationEvidence,categoryEvidence:place.categoryEvidence},...(ref?.evidence??[])];
 const parsed=CandidateSchema.safeParse({id:`web:${createHash('sha256').update(place.sourceUrl+'|'+place.name+'|'+latitude+'|'+longitude).digest('hex').slice(0,24)}`,name:place.name,originalName:place.name,aliases:place.aliases,entityId:place.entityId??ref?.entityId??null,mode:place.mode,category:place.category,venueKind:kind,verificationStatus:'verified',latitude:lat.data,longitude:lon.data,address:place.address??ref?.address??'來源未提供可查證地址',sourceUrl:place.sourceUrl,retrievedAt:at,osmType:null,osmId:null,osmTags:{},mealTags:[...(ref?.mealTags??[])],mealEvidence:[...collectMealEvidence({osmTags:{},openingHours:place.openingHours??null,sourceUrl:place.sourceUrl}),...collectMealEvidence({osmTags:ref?.osmTags??{},mealTags:ref?.mealTags??[],openingHours:ref?.openingHours??null,sourceUrl:ref?.sourceUrl??place.sourceUrl,mealEvidence:ref?.mealEvidence})],featureTags:ref?.featureTags??[],openingHours:place.openingHours??ref?.openingHours??null,website,evidence,rating:null,reviewCount:null,popularityScore:null,localGemScore:null});
 return parsed.success?{candidate:parsed.data,status:'verified'}:rejected('標準化場所格式驗證失敗');
}
