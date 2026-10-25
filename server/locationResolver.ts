import { z } from 'zod';
import { Anchor, coords, distanceMeters } from '../shared/model';
import { HttpContext, requestJson } from './http';
const Properties=z.object({osm_id:z.number().int().positive(),osm_type:z.enum(['N','W','R']),name:z.string().optional(),country:z.string().optional(),countrycode:z.string().optional(),state:z.string().optional(),city:z.string().optional(),district:z.string().optional(),street:z.string().optional(),housenumber:z.string().optional(),osm_key:z.string().optional(),osm_value:z.string().optional()}).passthrough();
const Feature=z.object({geometry:z.object({type:z.literal('Point'),coordinates:z.tuple([coords.longitude,coords.latitude])}),properties:Properties});
const Envelope=z.object({features:z.array(z.unknown())});
function asAnchor(f:z.infer<typeof Feature>,input:string):Anchor{
  const p=f.properties,type={N:'node',W:'way',R:'relation'}[p.osm_type];
  const name=p.name??[p.street,p.housenumber].filter(Boolean).join(' ')??'';
  return{id:`${type}/${p.osm_id}`,name:name||p.city||'搜尋位置',displayName:[name,p.district,p.city,p.state,p.country].filter((v,i,a)=>v&&a.indexOf(v)===i).join('，'),latitude:f.geometry.coordinates[1],longitude:f.geometry.coordinates[0],country:p.countrycode?.toUpperCase()??p.country??'',region:p.state??p.district??'',city:p.city??'',confidence:'source-match',source:`https://www.openstreetmap.org/${type}/${p.osm_id}`,category:'搜尋中心',geoType:`${p.osm_key??'unknown'}:${p.osm_value??'unknown'}`,originalInput:input};
}
export async function resolveLocation(query:string,ctx:HttpContext,context?:{latitude:number;longitude:number}):Promise<Anchor[]>{
  const url=new URL('/api/',process.env.PHOTON_URL??'https://photon.komoot.io');url.searchParams.set('q',query);url.searchParams.set('limit','8');
  if(context){url.searchParams.set('lat',String(context.latitude));url.searchParams.set('lon',String(context.longitude));}
  let anchors:Anchor[]=[];
  try{const response=await requestJson(url.href,{...ctx,signal:AbortSignal.any([ctx.signal,AbortSignal.timeout(10000)])},v=>Envelope.parse(v),{},86400000);
    anchors=response.data.features.flatMap(v=>{const parsed=Feature.safeParse(v);return parsed.success?[asAnchor(parsed.data,query)]:[];});
  }catch{ctx.signal.throwIfAborted();} // Leave time for the existing independent encyclopedia resolver.
  // Generic Taiwanese address decomposition; no named landmark or coordinate exceptions.
  const address=query.normalize('NFKC').match(/^(.*?[市縣])(?:.*?[區鄉鎮])?(.*?(?:路|街|大道))([\d之-]+)號/);
  if(!anchors.length&&address){
    const addressQuery=`${address[2]} ${address[3]} ${address[1].replace(/台/g,'臺')}`;
    const retry=new URL('/api/',process.env.PHOTON_URL??'https://photon.komoot.io');retry.searchParams.set('q',addressQuery);retry.searchParams.set('limit','8');
    try{const found=await requestJson(retry.href,{...ctx,signal:AbortSignal.any([ctx.signal,AbortSignal.timeout(10000)])},v=>Envelope.parse(v),{},86400000);
      anchors=found.data.features.flatMap(v=>{const f=Feature.safeParse(v);return f.success?[asAnchor(f.data,query)]:[];});
    }catch{ctx.signal.throwIfAborted();}
  }
  if(!address&&query.length<=60&&!/^\d+$/.test(query)){
    try{anchors=[...await wikiCenters(query.replace(/(?:市中心|市區中心|城市中心)$/,'市'),ctx),...anchors];}catch{/* independent resolver evidence source; Photon choices still usable */}
  }
  const unique=new Map<string,Anchor>();for(const a of anchors)if(!unique.has(a.id))unique.set(a.id,a);anchors=[...unique.values()];
  const norm=(s:string)=>s.replace(/台/g,'臺').replace(/[\s市縣都府]/g,'').toLowerCase();
  // A compound place title may carry an erroneous article coordinate. Exact Photon names
  // agreeing in a tight cluster corroborate position independently; never override coordinates.
  const exactGeo=anchors.filter(a=>!a.id.startsWith('wiki-center:')&&norm(a.name)===norm(query));
  const corroborated=exactGeo.filter(a=>exactGeo.some(b=>a.id!==b.id&&distanceMeters(a,b)<1000));
  if(corroborated.length>=2)anchors=anchors.filter(a=>!a.id.startsWith('wiki-center:')||/city|country|adm|state/.test(a.geoType)||corroborated.some(b=>distanceMeters(a,b)<5000));
  anchors=anchors.map(a=>({...a,originalInput:query}));
  anchors.sort((a,b)=>Number(/city|town|country|state/.test(b.geoType)&&norm(b.name)===norm(query))-Number(/city|town|country|state/.test(a.geoType)&&norm(a.name)===norm(query)));
  if(!anchors.length)throw new Error('無法確認地點；請加上城市、國家或完整地址。');return anchors;
}
async function wikiCenters(query:string,ctx:HttpContext):Promise<Anchor[]>{
  const base=/[\p{Script=Han}]/u.test(query)?'https://zh.wikipedia.org':'https://en.wikipedia.org';
  const u=new URL('/w/api.php',base);const normalized=query.replace(/台/g,'臺');
  const titles=[normalized];if(/^[\p{Script=Han}]{2,6}$/u.test(query))titles.push(normalized+'市');
  for(const[k,v]of Object.entries({action:'query',titles:titles.join('|'),redirects:'1',converttitles:'1',prop:'coordinates|info|langlinks',inprop:'url',coprop:'type|country|region',colimit:'max',lllang:'en',lllimit:'1',format:'json',variant:'zh-tw',maxlag:'5'}))u.searchParams.set(k,v);
  const pageSchema=z.object({pageid:z.number(),title:z.string(),fullurl:z.string().url(),coordinates:z.array(z.object({lat:coords.latitude,lon:coords.longitude,type:z.string().optional(),country:z.string().optional(),region:z.string().optional()})).optional(),langlinks:z.array(z.object({'*':z.string()})).optional()});
  const r=await requestJson(u.href,ctx,v=>z.object({query:z.object({pages:z.record(z.unknown())})}).parse(v),{},86400000);const list:Anchor[]=[];
  let pages=Object.values(r.data.query.pages);
  if(!pages.some(raw=>{const p=pageSchema.safeParse(raw);return p.success&&(p.data.coordinates?.length||p.data.langlinks?.length);})){ 
    // Fulltext discovers source titles for compound multilingual place inputs; no landmark aliases hardcoded.
    const find=new URL('/w/api.php',base);for(const[k,v]of Object.entries({action:'query',generator:'search',gsrsearch:normalized,gsrlimit:'5',prop:'coordinates|info|langlinks',inprop:'url',coprop:'type|country|region',colimit:'max',lllang:'en',lllimit:'1',format:'json',maxlag:'5'}))find.searchParams.set(k,v);
    const found=await requestJson(find.href,ctx,v=>z.object({query:z.object({pages:z.record(z.unknown())}).optional()}).parse(v),{},86400000);pages=Object.values(found.data.query?.pages??{});
  }
  for(const raw of pages){
    const parsed=pageSchema.safeParse(raw);if(!parsed.success)continue;let p=parsed.data;
    if(!p.coordinates?.length&&base.includes('zh.')&&p.langlinks?.[0]){
      const alternate=new URL('/w/api.php','https://en.wikipedia.org');for(const[k,v]of Object.entries({action:'query',titles:p.langlinks[0]['*'],redirects:'1',prop:'coordinates|info',coprop:'type|country|region',colimit:'max',inprop:'url',format:'json',maxlag:'5'}))alternate.searchParams.set(k,v);
      const translated=await requestJson(alternate.href,ctx,v=>z.object({query:z.object({pages:z.record(z.unknown())})}).parse(v),{},86400000);
      const alt=pageSchema.safeParse(Object.values(translated.data.query.pages)[0]);if(alt.success)p=alt.data;
    }
    const c=p.coordinates?.find(c=>/^(city|country|adm1st|adm2nd|state|landmark|mountain|waterbody|building|isle|river|edu|event|airport)$/.test(c.type??''))??p.coordinates?.[0];if(!c)continue;
    const similar=Array.from(normalized).filter(v=>parsed.data.title.includes(v)).length/Math.max(1,parsed.data.title.length);
    if(similar<0.5)continue;
    list.push({id:`wiki-center:${p.fullurl}`,name:parsed.data.title,displayName:`${parsed.data.title}${c.country?` · ${c.country}`:''}（維基百科地名座標）`,country:c.country??'',city:/city|adm/.test(c.type??'')?parsed.data.title:'',region:c.region??'',latitude:c.lat,longitude:c.lon,confidence:'source-match',source:p.fullurl,category:'搜尋中心',geoType:`wiki:${c.type??'coordinate'}`,originalInput:query});
  }return list;
}
export async function coordinateAnchor(latitude:number,longitude:number,ctx:HttpContext):Promise<Anchor>{
  const name=`座標 (${latitude.toFixed(5)}, ${longitude.toFixed(5)})`;
  const base:Anchor={id:`gps:${latitude},${longitude}`,name,displayName:name,latitude,longitude,country:'',city:'',region:'',confidence:'user-coordinate',source:`https://www.openstreetmap.org/?mlat=${latitude}&mlon=${longitude}`,category:'搜尋中心',geoType:'coordinate',originalInput:`${latitude}, ${longitude}`};
  try{
    const u=new URL('/reverse',process.env.PHOTON_URL??'https://photon.komoot.io');u.searchParams.set('lat',String(latitude));u.searchParams.set('lon',String(longitude));u.searchParams.set('limit','1');
    const r=await requestJson(u.href,{...ctx,signal:AbortSignal.any([ctx.signal,AbortSignal.timeout(10000)])},v=>Envelope.parse(v),{},86400000);const f=Feature.safeParse(r.data.features[0]);if(f.success){const a=asAnchor(f.data,base.originalInput);return{...base,country:a.country,city:a.city,region:a.region,displayName:`${name} · ${a.displayName}`};}
  }catch{ctx.signal.throwIfAborted();}return base;
}
