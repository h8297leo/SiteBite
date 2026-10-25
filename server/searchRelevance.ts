import { DiscoveryMode, FilterState, PlaceCandidate, categoryOptions, categoryMatches, mealOptions } from '../shared/model';

export function parseDiscoveryInput(raw:string,mode:DiscoveryMode,filters:FilterState){
 let locationQuery=raw.trim(),category=filters.category,meal=filters.meal;const terms:string[]=[];
 const aliases:Record<string,string>={'street food':'小吃',restaurants:'餐廳',cafes:'咖啡廳','coffee shops':'咖啡廳',desserts:'甜點',museums:'博物館',parks:'公園步道','屋台':'小吃','カフェ':'咖啡廳','レストラン':'餐廳','카페':'咖啡廳','식당':'餐廳'};
 const choices=[...categoryOptions[mode],...(mode==='food'?mealOptions:[]),...Object.keys(aliases).filter(k=>categoryOptions[mode].includes(aliases[k])),'附近美食','附近景點','美食','景點','attractions'].filter(v=>!['全部','全部景點'].includes(v)).sort((a,b)=>b.length-a.length);
 for(let pass=0;pass<4;pass++){let found=false;
 for(const term of choices){
  const escaped=term.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const match=locationQuery.match(new RegExp(`^(.*?)(?:\\s+|附近|周邊)${escaped}$`,'i'));
  if(!match?.[1]?.trim())continue;locationQuery=match[1].trim();terms.push(term);
  if(filters.queryIntent!==false&&mealOptions.includes(term)&&meal===null)meal=term;
  else if(filters.queryIntent!==false&&categoryOptions[mode].includes(aliases[term]??term)&&['全部','全部景點'].includes(category))category=aliases[term]??term;
  found=true;break;
 }
 if(!found)break;
 }
 if(filters.queryIntent!==false&&mode==='food'&&['全部','全部景點'].includes(category)&&/夜市|night market/i.test(locationQuery)&&(/美食|小吃|street food/i.test(raw)||terms.length===0))category='小吃';
 return{locationQuery,category,meal,terms,filters:{...filters,category,meal}};
}

export function supportedMeals(p:Pick<PlaceCandidate,'osmTags'|'openingHours'>){
 const found=new Set<string>();const tags=p.osmTags;
 for(const [key,name]of [['breakfast','早餐'],['brunch','早午餐'],['lunch','午餐'],['dinner','晚餐']])if(tags[key]==='yes')found.add(name);
 const hours=p.openingHours??'';
 if(/24\/7|00:00-24:00/.test(hours))for(const m of mealOptions)found.add(m);
 const intervals=[...hours.matchAll(/(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})/g)].flatMap(m=>{
  const a=Number(m[1])*60+Number(m[2]),b=Number(m[3])*60+Number(m[4]);return b<a?[[a,1440],[0,b]]:[[a,b]];
 });
 const windows:Record<string,[number,number]>={'早餐':[360,600],'早午餐':[540,780],'午餐':[660,840],'下午茶':[840,1020],'晚餐':[1020,1260],'宵夜':[1320,1440]};
 for(const [meal,[a,b]]of Object.entries(windows))if(intervals.some(([s,e])=>Math.min(e,b)-Math.max(s,a)>=30))found.add(meal);
 if(intervals.some(([s,e])=>Math.min(e,240)-Math.max(s,0)>=30))found.add('宵夜');
 return [...found];
}

export function relevanceReason(p:PlaceCandidate,mode:DiscoveryMode,filters:FilterState):string|null{
 if(p.mode!==mode)return '美食／景點模式不符';
 if(['administrative','road'].includes(p.venueKind))return '行政區或普通道路不是推薦場所';
 if(mode==='food'&&['market','food-court','shopping-area'].includes(p.venueKind))return '場所集合不是個別店家或攤販';
 if(!categoryMatches(p.category,filters.category))return '店家／景點分類不符';
 if(filters.meal&&!p.mealTags.includes(filters.meal))return '缺少此用餐時段的營業證據';
 if(filters.category==='秘境探索'&&!p.evidence.some(e=>e.categoryEvidence?.includes('秘境')))return '缺少秘境證據';
 return null;
}
