import { z } from 'zod';

export const mealNames=['早餐','早午餐','午餐','下午茶','晚餐','宵夜','24小時'];
export const MealEvidenceSchema=z.object({
 meal:z.string(),status:z.enum(['confirmed','unknown','excluded']),raw:z.string(),openingHours:z.string().nullable(),
 sourceUrl:z.string().url(),evidenceType:z.enum(['osm-tag','opening-hours','source-meal']),verificationStatus:z.enum(['verified','unverified']),
});
export type MealEvidence=z.infer<typeof MealEvidenceSchema>;
type MealSource={mealTags?:string[];osmTags:Record<string,string>;openingHours:string|null;sourceUrl?:string;mealEvidence?:MealEvidence[]};
const keys:Record<string,string>={breakfast:'早餐',brunch:'早午餐',lunch:'午餐',dinner:'晚餐'};
const windows:Record<string,[number,number][]>={'早餐':[[360,600]],'早午餐':[[540,780]],'午餐':[[660,840]],'下午茶':[[840,1020]],'晚餐':[[1020,1260]],'宵夜':[[1320,1440],[0,240]]};

/** Conservative weekly support, never a claim of menu availability or open-now. */
export function collectMealEvidence(p:MealSource):MealEvidence[]{
 const all=[...(p.mealEvidence??[])],sourceUrl=p.sourceUrl??'https://www.openstreetmap.org/';
 const add=(meal:string,status:MealEvidence['status'],raw:string,evidenceType:MealEvidence['evidenceType'],verified=true)=>all.push({meal,status,raw,openingHours:p.openingHours,sourceUrl,evidenceType,verificationStatus:verified?'verified':'unverified'});
 for(const [key,meal]of Object.entries(keys))if(['yes','no'].includes(p.osmTags[key]))add(meal,p.osmTags[key]==='yes'?'confirmed':'excluded',`${key}=${p.osmTags[key]}`,'osm-tag');
 // These are source-supplied tags; providers must not invent tags from a venue category.
 for(const meal of p.mealTags??[])if(!all.some(e=>e.meal===meal&&e.status==='confirmed'))add(meal,'confirmed',meal,'source-meal');
 const hours=p.openingHours?.trim();
 if(hours){
  // shortcut: complex OSM rules/comments remain unknown; use a full evaluator before supporting holidays/date exceptions.
  const simple=/^(?:(?:(?:Mo|Tu|We|Th|Fr|Sa|Su)(?:-(?:Mo|Tu|We|Th|Fr|Sa|Su))?(?:,(?:Mo|Tu|We|Th|Fr|Sa|Su))*\s+)?(?:\d{1,2}:\d{2}\s*-\s*\d{1,2}:\d{2}(?:\s*,\s*\d{1,2}:\d{2}\s*-\s*\d{1,2}:\d{2})*|off)(?:\s*;\s*|$))+$/;
  const parts=[...hours.matchAll(/(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})/g)];
  const valid=parts.every(m=>Number(m[1])<24&&Number(m[2])<60&&Number(m[3])<=24&&Number(m[4])<60&&(Number(m[3])!==24||Number(m[4])===0)&&(m[1]!==m[3]||m[2]!==m[4]));
  const complete=hours==='24/7'||(simple.test(hours)&&valid&&(parts.length>0||hours==='off'));
  const intervals=parts.flatMap(m=>{const a=Number(m[1])*60+Number(m[2]),b=Number(m[3])*60+Number(m[4]);return b<a?[[a,1440],[0,b]]:[[a,b]];});
  for(const meal of mealNames){
   const overlap=hours==='24/7'||(meal==='24小時'?false:(windows[meal]??[]).some(([a,b])=>intervals.some(([s,e])=>Math.min(e,b)-Math.max(s,a)>=30)));
   add(meal,!complete?'unknown':overlap?'confirmed':'excluded',hours,'opening-hours',complete);
  }
 }
 return [...new Map(all.map(e=>[JSON.stringify(e),e])).values()];
}
export function mealAssessment(p:MealSource,meal:string){
 const evidence=collectMealEvidence(p).filter(e=>e.meal===meal&&e.verificationStatus==='verified');
 const yes=evidence.some(e=>e.status==='confirmed'),no=evidence.some(e=>e.status==='excluded');
 return{status:yes&&no?'unknown' as const:yes?'confirmed' as const:no?'excluded' as const:'unknown' as const,conflict:yes&&no};
}
