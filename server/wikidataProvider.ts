import { z } from 'zod';
import { DiscoveryProvider, ProviderContext, ProviderResult } from './providers';
import { fetchPublicText } from './secureWeb';
import { resolvePlaceEntity } from './placeEntityResolver';
import { serviceError } from './http';

/** Authoritative entity aliases/location/type supplement. A failed public endpoint remains a failed run. */
export class WikidataPlaceProvider implements DiscoveryProvider{
 id='Wikidata 地點實體';role='public-web' as const;
 async search(ctx:ProviderContext):Promise<ProviderResult>{
  const start=Date.now(),meter={requests:0},context={...ctx,meter},candidates:ProviderResult['candidates']=[];
  const types=ctx.mode==='food'?['Q11707','Q30022']:['Q33506','Q22698','Q4989906','Q16560'];
  const query=`SELECT DISTINCT ?item ?itemLabel ?itemAltLabel ?coord ?type ?address ?website WHERE { SERVICE wikibase:around { ?item wdt:P625 ?coord. bd:serviceParam wikibase:center "Point(${ctx.anchor.longitude} ${ctx.anchor.latitude})"^^geo:wktLiteral; wikibase:radius "${Math.min(ctx.radius/1000,25)}". } VALUES ?type { ${types.map(t=>'wd:'+t).join(' ')} } ?item wdt:P31/wdt:P279* ?type. FILTER NOT EXISTS {?item wdt:P576 ?dissolution} OPTIONAL {?item wdt:P6375 ?address} OPTIONAL {?item wdt:P856 ?website} SERVICE wikibase:label {bd:serviceParam wikibase:language "zh-hant,en,ja,ko,fr".} } LIMIT 80`;
  const run={provider:this.id,role:this.role,status:'success' as 'success'|'failed'|'partial',round:ctx.round,radiusMeters:ctx.radius,rawCount:0,validCount:0,invalidCount:0,categoryExcluded:0,durationMs:0,requests:0,cached:false,error:null as string|null,endpoint:'https://query.wikidata.org/sparql',query,retrievedAt:null as string|null,webPages:0,parsedPages:0,extractedCandidates:0,verifiedPlaces:0,queries:[query],exclusions:[] as string[],sourceType:'wikidata-entity'};
  try{
   const u=new URL(run.endpoint);u.searchParams.set('query',query);u.searchParams.set('format','json');
   const response=await fetchPublicText(u.href,context,{api:true,ttl:3600000,maxBytes:2000000});
   const v=z.object({value:z.string()});const env=z.object({results:z.object({bindings:z.array(z.object({item:v,itemLabel:v,itemAltLabel:v.optional(),coord:v,type:v,address:v.optional(),website:v.optional()}))})}).parse(JSON.parse(response.data));
   // SPARQL entity records are structured data, not fetched HTML pages.
   run.rawCount=env.results.bindings.length;run.retrievedAt=response.retrievedAt;run.cached=response.cached;
   for(const row of env.results.bindings){
    const match=row.coord.value.match(/^Point\((-?[\d.]+) (-?[\d.]+)\)$/);const id=row.item.value.match(/Q\d+$/)?.[0],type=row.type.value.match(/Q\d+$/)?.[0];if(!match||!id||/^Q\d+$/.test(row.itemLabel.value)){run.invalidCount++;continue;}
    const category=type==='Q30022'?'咖啡廳':type==='Q11707'?'餐廳':type==='Q33506'?'博物館':type==='Q22698'?'公園':type==='Q16560'?'文化':'地標';
    run.extractedCandidates++;
    const verified=await resolvePlaceEntity({name:row.itemLabel.value,aliases:(row.itemAltLabel?.value??'').split(/,\s*/).filter(Boolean),address:row.address?.value??null,latitude:Number(match[2]),longitude:Number(match[1]),mode:ctx.mode,category,sourceUrl:`https://www.wikidata.org/wiki/${id}`,sourceTitle:row.itemLabel.value,siteName:'Wikidata',publishedAt:null,officialUrl:row.website?.value??null,categoryEvidence:`Wikidata P31/P279 ${type}`,locationEvidence:'Wikidata P625 座標',extraction:'encyclopedia',entityId:id},context,response.retrievedAt,this.id);
    if(verified.candidate){candidates.push(verified.candidate);run.verifiedPlaces++;}else{run.invalidCount++;run.exclusions.push(verified.reason??'實體無法驗證');}
   }
   run.validCount=candidates.length;return{candidates,run};
  }catch(e){run.status='failed';run.error=e instanceof Error?e.message:serviceError(e);return{candidates,run};}
  finally{run.durationMs=Date.now()-start;run.requests=meter.requests;}
 }
}
