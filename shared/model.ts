import { z } from 'zod';

export const coords = { latitude: z.number().finite().min(-90).max(90), longitude: z.number().finite().min(-180).max(180) };
const PublicLink=z.string().url().refine(value=>['https:','http:'].includes(new URL(value).protocol),'來源連結只能使用 HTTP 或 HTTPS');
export const ModeSchema = z.enum(['food', 'attraction']);
export type DiscoveryMode = z.infer<typeof ModeSchema>;
export const modeLabels = { food: '美食探索', attraction: '景點探索' };
export const categoryOptions = {
  food: ['全部','餐廳','小吃','咖啡廳','甜點','麵包烘焙','飲料茶飲','速食','自助餐','酒吧餐酒館'],
  attraction: ['全部景點','自然景觀','公園步道','歷史古蹟','文化藝術','博物館','展覽活動','地標建築','拍照景點','親子景點','商圈老街','夜景景點','宗教景點','秘境探索'],
};
export const mealOptions=['早餐','早午餐','午餐','下午茶','晚餐','宵夜','24小時'];
const categoryAliases:Record<string,string[]>={'自然景觀':['自然'],'公園步道':['公園','戶外'],'歷史古蹟':['古蹟'],'文化藝術':['文化'],'展覽活動':['展覽'],'地標建築':['地標'],'拍照景點':['觀景'],'親子景點':['親子'],'酒吧餐酒館':['酒吧']};
export function categoryMatches(actual:string,wanted:string){return ['全部','全部景點'].includes(wanted)||actual===wanted||(categoryAliases[wanted]??[]).includes(actual);}
export const AnchorSchema = z.object({
  ...coords, id:z.string(), displayName:z.string(), name:z.string(), country:z.string(), region:z.string(), city:z.string(),
  confidence:z.enum(['source-match','user-coordinate']), source:z.string().url(), category:z.string(),
  geoType:z.string().default('unknown'), originalInput:z.string().default(''),
  englishName:z.string().optional(),
});
export type Anchor = z.infer<typeof AnchorSchema>;
export const EvidenceSchema = z.object({provider:z.string(),sourceId:z.string(),url:PublicLink,retrievedAt:z.string(),kind:z.enum(['osm-tags','public-article']),description:z.string(),
 sourceType:z.string().optional(),providerName:z.string().optional(),sourceUrl:z.string().url().optional(),sourceTitle:z.string().optional(),publishedAt:z.string().nullable().optional(),evidenceType:z.string().optional(),extractedPlaceName:z.string().optional(),locationEvidence:z.string().optional(),categoryEvidence:z.string().optional(),
});
export const RatingEvidenceSchema=z.object({platform:z.string(),rating:z.number(),ratingScale:z.number().positive(),reviewCount:z.number().int().nonnegative().nullable(),sourceUrl:z.string().url(),retrievedAt:z.string(),verificationStatus:z.enum(['unverified','verified','rejected'])});
export const SocialEvidenceSchema=z.object({platform:z.string(),sourceUrl:z.string().url(),retrievedAt:z.string(),summary:z.string(),verificationStatus:z.enum(['unverified','verified','rejected'])});
export const CandidateSchema = z.object({
  ...coords, id:z.string(), name:z.string().trim().min(1), originalName:z.string(), aliases:z.array(z.string()).default([]),entityId:z.string().nullable().default(null),mode:ModeSchema, category:z.string(),
  address:z.string().default('未取得公開地址'), sourceUrl:PublicLink, retrievedAt:z.string(),
  osmType:z.enum(['node','way','relation']).nullable(), osmId:z.number().nullable(), osmTags:z.record(z.string()),
  mealTags:z.array(z.string()), featureTags:z.array(z.string()), openingHours:z.string().nullable(), website:PublicLink.nullable(),
  evidence:z.array(EvidenceSchema).min(1), rating:z.number().nullable(), reviewCount:z.number().nullable(),
  popularityScore:z.number().nullable(), localGemScore:z.number().nullable(),
  ratingEvidence:z.array(RatingEvidenceSchema).default([]), socialEvidence:z.array(SocialEvidenceSchema).default([]),
  venueKind:z.enum(['business','stall','market','food-court','shopping-area','attraction','landmark','administrative','road','unknown']).default('unknown'),
  verificationStatus:z.literal('verified').default('verified'),
});
export type PlaceCandidate = z.infer<typeof CandidateSchema>;
export const PlaceSchema = CandidateSchema.extend({distance:z.number().finite().nonnegative()});
export type Place = z.infer<typeof PlaceSchema>;
export const FilterSchema = z.object({
  queryIntent:z.boolean().default(true),
  category:z.string().default('全部'),meal:z.string().nullable().default(null),feature:z.string().nullable().default(null),
  maxDistance:z.number().positive().max(50000).nullable().default(null),minRating:z.number().min(0).max(5).nullable().default(null),sort:z.enum(['distance','name']).default('distance'),
});
export type FilterState = z.infer<typeof FilterSchema>;
export const defaultFilters:FilterState={category:'全部',meal:null,feature:null,maxDistance:null,minRating:null,sort:'distance',queryIntent:true};
export const SearchIntentSchema=z.object({
  query:z.string().trim().min(1).max(200).optional(),latitude:coords.latitude.optional(),longitude:coords.longitude.optional(),
  anchor:AnchorSchema.optional(),mode:ModeSchema.default('food'),filters:FilterSchema.default(defaultFilters),
}).refine(v=>v.query||v.anchor||(v.latitude!==undefined&&v.longitude!==undefined),'請輸入地點或有效座標');
export const ProviderRunSchema=z.object({
  provider:z.string(),role:z.enum(['geographic','public-web']),status:z.enum(['success','partial','failed','skipped']),
  round:z.number(),radiusMeters:z.number(),rawCount:z.number(),validCount:z.number(),invalidCount:z.number(),categoryExcluded:z.number(),
  durationMs:z.number(),requests:z.number(),cached:z.boolean(),error:z.string().nullable(),endpoint:z.string(),query:z.string(),retrievedAt:z.string().nullable(),
  webPages:z.number().optional(),parsedPages:z.number().optional(),extractedCandidates:z.number().optional(),verifiedPlaces:z.number().optional(),queries:z.array(z.string()).optional(),exclusions:z.array(z.string()).optional(),sourceType:z.string().optional(),
  pendingPlaces:z.number().optional(),rejectedPlaces:z.number().optional(),relevanceExcluded:z.number().optional(),
  links:z.array(z.object({url:z.string().url(),title:z.string(),level:z.enum(['link-only','search-snippet']),snippet:z.string().optional()})).optional(),
  verificationSamples:z.array(z.object({name:z.string(),status:z.enum(['verified','pending','rejected']),reason:z.string(),sourceUrl:z.string().url()})).optional(),
});
export type ProviderRun=z.infer<typeof ProviderRunSchema>;
export const ResponseSchema=z.object({
  anchor:AnchorSchema,mode:ModeSchema,filters:FilterSchema,places:z.array(PlaceSchema).max(50),warnings:z.array(z.string()),
  diagnostics:z.object({
    originalInput:z.string(),mode:ModeSchema,providers:z.array(ProviderRunSchema),rounds:z.number(),
    roundResults:z.array(z.object({round:z.number(),radiusMeters:z.number(),rawCandidates:z.number(),validPool:z.number()})),
    candidates:z.number(),categoryExcluded:z.number(),invalidExcluded:z.number(),geographyExcluded:z.number(),duplicateExcluded:z.number(),
    finalCount:z.number(),validPool:z.number(),durationMs:z.number(),radiusMeters:z.number(),requestCount:z.number(),requestBudget:z.number(),stopReason:z.string(),incompleteReasons:z.array(z.string()),
    webDiscovery:z.object({pages:z.number(),parsedPages:z.number(),extracted:z.number(),verified:z.number(),osmDuplicates:z.number(),addedToPool:z.number(),addedToFinal:z.number(),additionalEvidence:z.number()}).optional(),
    osmPool:z.number().optional(),
    intent:z.object({locationQuery:z.string(),category:z.string(),meal:z.string().nullable(),terms:z.array(z.string())}).optional(),
    relevanceExcluded:z.number().optional(),
    sourceCapabilities:z.array(z.object({name:z.string(),status:z.string(),detail:z.string()})).optional(),
  }),
});
export type SearchResponse=z.infer<typeof ResponseSchema>;
export function distanceMeters(a:{latitude:number;longitude:number},b:{latitude:number;longitude:number}){
  const rad=(v:number)=>v*Math.PI/180;
  const h=Math.sin(rad(b.latitude-a.latitude)/2)**2+Math.cos(rad(a.latitude))*Math.cos(rad(b.latitude))*Math.sin(rad(b.longitude-a.longitude)/2)**2;
  return 6371000*2*Math.atan2(Math.sqrt(h),Math.sqrt(Math.max(0,1-h)));
}
export function matchesFilters(p:PlaceCandidate&{distance:number},f:FilterState){
  return categoryMatches(p.category,f.category)&&(!f.meal||p.mealTags.includes(f.meal))&&(!f.feature||p.featureTags.includes(f.feature))&&
    (f.maxDistance===null||p.distance<=f.maxDistance)&&(f.minRating===null||(p.rating!==null&&p.rating>=f.minRating));
}
export function filterPlaces(places:Place[],filters:FilterState){return places.filter(p=>matchesFilters(p,filters)).sort((a,b)=>filters.sort==='name'?a.name.localeCompare(b.name,'zh-TW'):a.distance-b.distance);}
export function navigationUrl(p:Place,origin?:{latitude:number;longitude:number}|null){const u=new URL('https://www.google.com/maps/dir/');u.searchParams.set('api','1');u.searchParams.set('destination',`${p.latitude},${p.longitude}`);if(origin)u.searchParams.set('origin',`${origin.latitude},${origin.longitude}`);return u.href;}
