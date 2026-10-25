import { DiscoveryMode, FilterState, PlaceCandidate } from '../shared/model';
import { supportedMeals } from './searchRelevance';
export type Classification={mode:DiscoveryMode;category:string;mealTags:string[];featureTags:string[];venueKind:PlaceCandidate['venueKind']};
export const foodTags:Record<string,string[]>={amenity:['restaurant','cafe','fast_food','food_court','ice_cream','bar','pub','food_stall'],shop:['bakery','pastry','confectionery','ice_cream']};
export const attractionTags:Record<string,string[]>={tourism:['attraction','museum','gallery','viewpoint','artwork','theme_park','zoo','aquarium'],leisure:['park','garden','nature_reserve','playground'],historic:['monument','memorial','castle','ruins','archaeological_site','fort','manor','city_gate'],natural:['water','peak','beach','cave_entrance','waterfall'],amenity:['arts_centre','theatre','place_of_worship','marketplace'],shop:['mall'],route:['hiking','foot']};
export function classifyOsm(t:Record<string,string>):Classification|null{
 if(t.disused==='yes'||t.abandoned==='yes'||t.demolished==='yes'||t.access==='private')return null;
 let category:string|null=null;
 if(t.amenity==='cafe')category=/bubble_tea|tea/i.test(t.cuisine??'')?'飲料茶飲':'咖啡廳';
 else if(t.shop==='bakery')category='麵包烘焙';
 else if(t.amenity==='ice_cream'||['pastry','confectionery','ice_cream'].includes(t.shop))category='甜點';
 else if(t.amenity==='food_stall'||t.street_vendor==='yes'||/street_food|snack/.test(t.cuisine??''))category='小吃';
 else if(['restaurant','food_court'].includes(t.amenity))category=t.restaurant==='buffet'?'自助餐':'餐廳';
 else if(t.amenity==='fast_food')category='速食';
 else if(['bar','pub'].includes(t.amenity))category='酒吧餐酒館';
 if(category)return{mode:'food',category,mealTags:supportedMeals({osmTags:t,openingHours:t.opening_hours??null}),featureTags:[],venueKind:t.amenity==='food_court'?'food-court':t.amenity==='food_stall'||t.street_vendor==='yes'?'stall':'business'};
 if(t.tourism==='museum')category='博物館';
 else if(t.tourism==='gallery'||t.amenity==='arts_centre')category='展覽活動';
 else if(t.amenity==='theatre'||t.tourism==='artwork')category='文化藝術';
 else if(['zoo','aquarium','theme_park'].includes(t.tourism)||t.leisure==='playground')category='親子景點';
 else if(['park','garden'].includes(t.leisure)||['hiking','foot'].includes(t.route))category='公園步道';
 else if(t.leisure==='nature_reserve'||attractionTags.natural.includes(t.natural))category='自然景觀';
 else if(attractionTags.historic.includes(t.historic))category='歷史古蹟';
 else if(t.amenity==='place_of_worship')category='宗教景點';
 else if(t.amenity==='marketplace'||t.shop==='mall')category='商圈老街';
 else if(t.tourism==='viewpoint')category='拍照景點';
 else if(t.tourism==='attraction')category='地標建築';
 if(!category)return null;
 const featureTags=['自然景觀','公園步道'].includes(category)?['自然','戶外']:category==='歷史古蹟'?['歷史','文化']:['博物館','展覽活動','文化藝術','宗教景點'].includes(category)?['文化']:category==='親子景點'?['親子']:category==='拍照景點'?['拍照','戶外']:['觀光'];
 return{mode:'attraction',category,mealTags:[],featureTags,venueKind:t.amenity==='marketplace'?'market':t.shop==='mall'?'shopping-area':'attraction'};
}
export function overpassQuery(mode:DiscoveryMode,latitude:number,longitude:number,radius:number,filters:FilterState):string{
 let tags=mode==='food'?foodTags:attractionTags;
 const specific:Record<string,Record<string,string[]>>={'餐廳':{amenity:['restaurant']},'小吃':{amenity:['food_stall','fast_food','restaurant']},'咖啡廳':{amenity:['cafe']},'甜點':{amenity:['ice_cream'],shop:['pastry','confectionery','ice_cream']},'麵包烘焙':{shop:['bakery']},'飲料茶飲':{amenity:['cafe','fast_food']},'速食':{amenity:['fast_food']},'自助餐':{amenity:['restaurant']},'酒吧餐酒館':{amenity:['bar','pub']},'酒吧':{amenity:['bar','pub']},'博物館':{tourism:['museum']},'自然景觀':{natural:attractionTags.natural,leisure:['nature_reserve']},'公園步道':{leisure:['park','garden'],route:['hiking','foot']},'歷史古蹟':{historic:attractionTags.historic},'文化藝術':{tourism:['artwork'],amenity:['arts_centre','theatre']},'展覽活動':{tourism:['gallery'],amenity:['arts_centre']},'親子景點':{tourism:['zoo','aquarium','theme_park'],leisure:['playground']},'地標建築':{tourism:['attraction']},'拍照景點':{tourism:['viewpoint']},'宗教景點':{amenity:['place_of_worship']},'商圈老街':{amenity:['marketplace'],shop:['mall']},'夜景景點':{tourism:['viewpoint','attraction']},'秘境探索':{tourism:['attraction']}};
 if(specific[filters.category])tags=specific[filters.category];
 else if(mode==='food'&&filters.meal==='下午茶')tags={amenity:['cafe','ice_cream'],shop:['bakery','pastry','confectionery','ice_cream']};
 const around=`(around:${radius},${latitude},${longitude})`;
 const clauses=Object.entries(tags).map(([key,values])=>`nwr["${key}"~"^(${values.join('|' )})$"]${around};`).join('');
 return`[out:json][timeout:8][maxsize:8388608];(${clauses});out center;`;
}
export interface DiscoveryEngine {mode:DiscoveryMode;label:string;initialRadius:number;maximumRadius:number;query:(lat:number,lon:number,radius:number,filters:FilterState)=>string}
export const FoodDiscoveryEngine:DiscoveryEngine={mode:'food',label:'美食探索',initialRadius:1200,maximumRadius:16000,query:(lat,lon,r,f)=>overpassQuery('food',lat,lon,r,f)};
export const AttractionDiscoveryEngine:DiscoveryEngine={mode:'attraction',label:'景點探索',initialRadius:2000,maximumRadius:25000,query:(lat,lon,r,f)=>overpassQuery('attraction',lat,lon,r,f)};
