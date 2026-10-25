import { collectMealEvidence, mealAssessment } from '../shared/meals';
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

export function supportedMeals(p:Pick<PlaceCandidate,'osmTags'|'openingHours'>){return collectMealEvidence(p).filter(e=>e.status==='confirmed').map(e=>e.meal).filter((m,i,a)=>a.indexOf(m)===i);}

export function relevanceReason(p:PlaceCandidate,mode:DiscoveryMode,filters:FilterState):string|null{
 if(p.mode!==mode)return '美食／景點模式不符';
 if(['administrative','road'].includes(p.venueKind))return '行政區或普通道路不是推薦場所';
 if(mode==='food'&&['market','food-court','shopping-area'].includes(p.venueKind))return '場所集合不是個別店家或攤販';
 if(!categoryMatches(p.category,filters.category))return '店家／景點分類不符';
 if(filters.meal&&mealAssessment(p,filters.meal).status==='excluded')return '來源證據確認不符合此用餐時段';
 if(filters.category==='秘境探索'&&!p.evidence.some(e=>e.categoryEvidence?.includes('秘境')))return '缺少秘境證據';
 return null;
}
