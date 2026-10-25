import { DiscoveryMode, FilterState } from '../shared/model';
export type Classification={mode:DiscoveryMode;category:string;mealTags:string[];featureTags:string[]};
export const foodTags:Record<string,string[]>={amenity:['restaurant','cafe','fast_food','food_court','ice_cream','bar','pub'],shop:['bakery','pastry','confectionery','ice_cream']};
export const attractionTags:Record<string,string[]>={tourism:['attraction','museum','gallery','viewpoint','artwork','theme_park','zoo','aquarium'],leisure:['park','garden','nature_reserve'],historic:['monument','memorial','castle','ruins','archaeological_site','fort','manor','city_gate'],natural:['water','peak','beach','cave_entrance','waterfall'],amenity:['arts_centre','theatre']};
export function classifyOsm(t:Record<string,string>):Classification|null{
  if(t.disused==='yes'||t.abandoned==='yes'||t.demolished==='yes'||t['access']==='private')return null;
  let category:string|null=null;
  if(t.amenity==='cafe')category='咖啡廳';
  else if(t.amenity==='ice_cream'||['bakery','pastry','confectionery','ice_cream'].includes(t.shop))category='甜點';
  else if(['restaurant','food_court'].includes(t.amenity))category='餐廳';
  else if(t.amenity==='fast_food')category='小吃';
  else if(['bar','pub'].includes(t.amenity))category='酒吧';
  if(category){
    const mealTags=['餐廳','小吃'].includes(category)?['午餐','晚餐']:['咖啡廳','甜點'].includes(category)?['下午茶']:['晚餐'];
    if(t.breakfast==='yes'||/breakfast|brunch/.test(t.cuisine??''))mealTags.push('早餐');
    if(/24\/7|(?:2[0-3]:\d\d|[0-1]\d:\d\d)-(?:0[0-4]:\d\d)/.test(t.opening_hours??''))mealTags.push('宵夜');
    return{mode:'food',category,mealTags,featureTags:[]};
  }
  if(['museum'].includes(t.tourism))category='博物館';
  else if(t.tourism==='gallery'||t.amenity==='arts_centre')category='展覽';
  else if(t.amenity==='theatre')category='文化';
  else if(['zoo','aquarium','theme_park'].includes(t.tourism))category='親子';
  else if(['park','garden'].includes(t.leisure))category='公園';
  else if(t.leisure==='nature_reserve'||attractionTags.natural.includes(t.natural))category='自然';
  else if(attractionTags.historic.includes(t.historic))category='古蹟';
  else if(t.tourism==='viewpoint')category='觀景';
  else if(t.tourism==='artwork')category='文化';
  else if(t.tourism==='attraction')category='地標';
  if(!category)return null;
  const featureTags=category==='自然'||category==='公園'?['自然','戶外']:category==='古蹟'?['歷史','文化']:['博物館','展覽','文化'].includes(category)?['文化']:category==='親子'?['親子']:category==='觀景'?['拍照','戶外']:['觀光'];
  return{mode:'attraction',category,mealTags:[],featureTags};
}
export function overpassQuery(mode:DiscoveryMode,latitude:number,longitude:number,radius:number,filters:FilterState):string{
  let tags=mode==='food'?foodTags:attractionTags;
  if(mode==='food'&&filters.meal==='下午茶')tags={amenity:['cafe','ice_cream'],shop:['bakery','pastry','confectionery','ice_cream']};
  const around=`(around:${radius},${latitude},${longitude})`;
  const clauses=Object.entries(tags).map(([key,values])=>`nwr["${key}"~"^(${values.join('|')})$"]${around};`).join('');
  return`[out:json][timeout:8][maxsize:8388608];(${clauses});out center;`;
}
export interface DiscoveryEngine {mode:DiscoveryMode;label:string;initialRadius:number;maximumRadius:number;query:(lat:number,lon:number,radius:number,filters:FilterState)=>string}
export const FoodDiscoveryEngine:DiscoveryEngine={mode:'food',label:'美食探索',initialRadius:1200,maximumRadius:16000,query:(lat,lon,r,f)=>overpassQuery('food',lat,lon,r,f)};
export const AttractionDiscoveryEngine:DiscoveryEngine={mode:'attraction',label:'景點探索',initialRadius:2000,maximumRadius:25000,query:(lat,lon,r,f)=>overpassQuery('attraction',lat,lon,r,f)};
