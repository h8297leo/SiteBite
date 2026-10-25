import { z } from 'zod';
import { load } from 'cheerio';
import { Anchor, CandidateSchema, DiscoveryMode, FilterState, PlaceCandidate, ProviderRun, coords } from '../shared/model';
import { HttpContext, requestJson, serviceError } from './http';
import { classifyOsm, overpassQuery } from './engines';

export type ProviderContext=HttpContext&{anchor:Anchor;mode:DiscoveryMode;filters:FilterState;radius:number;round:number};
export type ProviderResult={candidates:PlaceCandidate[];run:ProviderRun};
export interface DiscoveryProvider {id:string;role:'geographic'|'public-web';search:(ctx:ProviderContext)=>Promise<ProviderResult>}
function emptyRun(provider:DiscoveryProvider,ctx:ProviderContext,endpoint:string,query:string):ProviderRun{
  return{provider:provider.id,role:provider.role,status:'success',round:ctx.round,radiusMeters:ctx.radius,rawCount:0,validCount:0,invalidCount:0,categoryExcluded:0,durationMs:0,requests:0,cached:false,error:null,endpoint,query,retrievedAt:null};
}
const Element=z.object({type:z.enum(['node','way','relation']),id:z.number().int().positive(),lat:z.number().optional(),lon:z.number().optional(),center:z.object({lat:z.number(),lon:z.number()}).optional(),tags:z.record(z.string()).optional()});
export function normalizeOsm(raw:unknown,mode:DiscoveryMode,at:string):{candidate?:PlaceCandidate;reason?:'invalid'|'category'}{
  const parsed=Element.safeParse(raw);if(!parsed.success)return{reason:'invalid'};
  const e=parsed.data,t=e.tags??{},name=t['name:zh-Hant']??t['name:zh']??t.name;
  if(!name?.trim())return{reason:'invalid'};
  if(/^[\d\s號]+$/.test(name)||/^.+(?:路|街|大道)\s*[\d之-]+號(?:[\d樓室\s]*)$/.test(name))return{reason:'category'};
  const classification=classifyOsm(t);if(!classification||classification.mode!==mode)return{reason:'category'};
  const latitude=e.lat??e.center?.lat,longitude=e.lon??e.center?.lon;
  let website:string|null=null;try{const u=new URL(t.website??t['contact:website']);if(['http:','https:'].includes(u.protocol))website=u.href;}catch{}
  const sourceUrl=`https://www.openstreetmap.org/${e.type}/${e.id}`;
  const candidate=CandidateSchema.safeParse({
    id:`osm:${e.type}/${e.id}`,name,originalName:t.name??name,aliases:[t.name,t['name:en'],t['name:zh'],t['name:zh-Hant']].filter((v):v is string=>Boolean(v)),entityId:t.wikidata??null,...classification,latitude,longitude,
    address:[t['addr:city'],t['addr:suburb'],t['addr:street'],t['addr:housenumber']].filter(Boolean).join('')||'未取得公開地址',
    sourceUrl,retrievedAt:at,osmType:e.type,osmId:e.id,osmTags:t,openingHours:t.opening_hours??null,website,
    evidence:[{provider:'Overpass',sourceId:`${e.type}/${e.id}`,url:sourceUrl,retrievedAt:at,kind:'osm-tags',description:'獨立 POI 查詢取得的原始 OSM 類別標籤'}],
    rating:null,reviewCount:null,popularityScore:null,localGemScore:null,ratingEvidence:[],socialEvidence:[],
  });return candidate.success?{candidate:candidate.data}:{reason:'invalid'};
}
const brokenUntil=new Map<string,number>();
export class OverpassProvider implements DiscoveryProvider{
  id='Overpass OSM';role='geographic' as const;
  async search(ctx:ProviderContext):Promise<ProviderResult>{
    const start=Date.now(),used=ctx.budget.used;
    const query=overpassQuery(ctx.mode,ctx.anchor.latitude,ctx.anchor.longitude,ctx.radius,ctx.filters);
    const endpoints=process.env.OVERPASS_URL?[process.env.OVERPASS_URL]:['https://overpass-api.de/api/interpreter','https://overpass.private.coffee/api/interpreter'];
    const run=emptyRun(this,ctx,endpoints.join(' → '),query),candidates:PlaceCandidate[]=[];const errors:string[]=[];
    try{
      for(const endpoint of endpoints){
        if((brokenUntil.get(endpoint)??0)>Date.now()){errors.push(`${new URL(endpoint).host}：最近失敗，冷卻中`);continue;}
        try{
          const u=new URL(endpoint);u.searchParams.set('data',query);
          // Reserve time for the alternate endpoint inside the 23-second provider budget.
          const r=await requestJson(u.href,{...ctx,signal:AbortSignal.any([ctx.signal,AbortSignal.timeout(endpoints.length>1?10000:18000)])},v=>z.object({elements:z.array(z.unknown()),remark:z.string().optional()}).parse(v));
          run.endpoint=endpoint;run.cached=r.cached;run.retrievedAt=r.retrievedAt;run.rawCount=r.data.elements.length;
          for(const raw of r.data.elements){const result=normalizeOsm(raw,ctx.mode,r.retrievedAt);if(result.candidate)candidates.push(result.candidate);else if(result.reason==='category')run.categoryExcluded++;else run.invalidCount++;}
          if(r.data.remark){run.status='partial';errors.push(r.data.remark);if(!candidates.length){brokenUntil.set(endpoint,Date.now()+60000);continue;}}else if(errors.length)run.status='partial';
          run.validCount=candidates.length;run.error=errors.length?errors.join('；'):null;return{candidates,run};
        }catch(e){errors.push(`${new URL(endpoint).host}：${serviceError(e)}`);if(!ctx.signal.aborted&&!serviceError(e).includes('預算'))brokenUntil.set(endpoint,Date.now()+60000);ctx.signal.throwIfAborted();}
      }
      run.status='failed';run.error=errors.join('；');return{candidates,run};
    }catch(e){run.status='failed';run.error=[...errors,serviceError(e)].join('；');return{candidates,run};}
    finally{run.durationMs=Date.now()-start;run.requests=ctx.budget.used-used;}
  }
}
function wikiApi(host:string,params:Record<string,string>){const u=new URL('/w/api.php',host);u.searchParams.set('format','json');u.searchParams.set('maxlag','5');for(const[k,v]of Object.entries(params))u.searchParams.set(k,v);return u.href;}
const GeoEnvelope=z.object({query:z.object({geosearch:z.array(z.object({pageid:z.number().int(),title:z.string(),lat:z.number(),lon:z.number()}))})});
const WikiPage=z.object({pageid:z.number(),title:z.string(),fullurl:z.string().url(),extract:z.string().optional(),coordinates:z.array(z.object({lat:coords.latitude,lon:coords.longitude,primary:z.string().optional(),type:z.string().optional()})).optional(),categories:z.array(z.object({title:z.string()})).optional(),pageprops:z.record(z.unknown()).optional()});
export function classifyArticle(categories:string[],mode:DiscoveryMode):{category:string;mealTags:string[];featureTags:string[]}|null{
  const text=categories.join(' ').toLowerCase();
  if(/restaurant chains|companies|disambiguation|districts of|neighbou?rhoods|streets in|roads in|cities in|villages in|communes|railway stations|industrial parks|science parks|business parks|office parks/.test(text))return null;
  if(mode==='food'){
    if(/coffeehouses|cafés|cafes|tea houses/.test(text))return{category:'咖啡廳',mealTags:['下午茶'],featureTags:[]};
    if(/restaurants in|restaurants established/.test(text))return{category:'餐廳',mealTags:['午餐','晚餐'],featureTags:[]};return null;
  }
  if(/museums|museum buildings/.test(text))return{category:'博物館',mealTags:[],featureTags:['文化']};
  if(/art galleries|exhibition/.test(text))return{category:'展覽',mealTags:[],featureTags:['文化']};
  if(/parks in|gardens in|botanical gardens/.test(text))return{category:'公園',mealTags:[],featureTags:['自然','戶外']};
  if(/mountains|lakes|beaches|waterfalls|nature reserves|caves/.test(text))return{category:'自然',mealTags:[],featureTags:['自然','戶外']};
  if(/historic sites|monuments|memorials|castles|archaeological sites|forts/.test(text))return{category:'古蹟',mealTags:[],featureTags:['歷史','文化']};
  if(/temples|shrines|churches|cathedrals|theatres|theaters|cultural centers/.test(text))return{category:'文化',mealTags:[],featureTags:['文化']};
  if(/zoos|aquariums|amusement parks|theme parks/.test(text))return{category:'親子',mealTags:[],featureTags:['親子']};
  if(/observation towers|observation decks|tourist attractions|landmarks/.test(text))return{category:'地標',mealTags:[],featureTags:['觀光']};
  return null;
}
export class WikipediaProvider implements DiscoveryProvider{
  id='Wikipedia 公開文章';role='public-web' as const;
  async search(ctx:ProviderContext):Promise<ProviderResult>{
    const start=Date.now(),used=ctx.budget.used,host=process.env.WIKIPEDIA_URL??'https://en.wikipedia.org';
    const run=emptyRun(this,ctx,host,'附近文章 → 實際文章內容、座標、分類驗證');const candidates:PlaceCandidate[]=[];
    try{
      const r=await requestJson(wikiApi(host,{action:'query',list:'geosearch',gscoord:`${ctx.anchor.latitude}|${ctx.anchor.longitude}`,gsradius:String(Math.min(ctx.radius,10000)),gslimit:'50',gsnamespace:'0'}),ctx,v=>GeoEnvelope.parse(v),{},3600000);
      run.rawCount=r.data.query.geosearch.length;run.cached=r.cached;
      if(!run.rawCount)return{candidates,run};
      const ids=r.data.query.geosearch.map(p=>p.pageid).join('|');
      const details=await requestJson(wikiApi(host,{action:'query',pageids:ids,prop:'info|coordinates|categories|extracts|pageprops',inprop:'url',coprop:'type|country',colimit:'max',cllimit:'50',exintro:'1',explaintext:'1',exlimit:'max'}),ctx,v=>z.object({query:z.object({pages:z.record(z.unknown())})}).parse(v),{},3600000);
      run.cached=run.cached&&details.cached;run.retrievedAt=details.retrievedAt;
      for(const raw of Object.values(details.data.query.pages)){
        const p=WikiPage.safeParse(raw);if(!p.success||!p.data.coordinates?.length||!p.data.extract?.trim()||p.data.pageprops?.disambiguation!==undefined){run.invalidCount++;continue;}
        const page=p.data;const classification=classifyArticle(page.categories?.map(c=>c.title)??[],ctx.mode);if(!classification){run.categoryExcluded++;continue;}
        const coord=page.coordinates!.find(c=>c.primary!==undefined)??page.coordinates![0];
        const candidate=CandidateSchema.safeParse({id:`wiki:${page.pageid}`,name:page.title,originalName:page.title,entityId:typeof page.pageprops?.wikibase_item==='string'?page.pageprops.wikibase_item:null,mode:ctx.mode,...classification,latitude:coord.lat,longitude:coord.lon,address:'文章未提供可驗證地址',sourceUrl:page.fullurl,retrievedAt:details.retrievedAt,osmType:null,osmId:null,osmTags:{},openingHours:null,website:null,evidence:[{provider:this.id,sourceId:String(page.pageid),url:page.fullurl,retrievedAt:details.retrievedAt,kind:'public-article',description:'已讀取文章內容、地理座標與文章分類；無星級評論證據'}],rating:null,reviewCount:null,popularityScore:null,localGemScore:null});
        if(candidate.success)candidates.push(candidate.data);else run.invalidCount++;
      }
      run.validCount=candidates.length;return{candidates,run};
    }catch(e){run.status='failed';run.error=serviceError(e);return{candidates,run};}
    finally{run.durationMs=Date.now()-start;run.requests=ctx.budget.used-used;}
  }
}
export function parseTravelListings(html:string,pageUrl:string,mode:DiscoveryMode,at:string):{candidates:PlaceCandidate[];invalid:number;categoryExcluded:number;rawCount:number}{
  const $=load(html);const candidates:PlaceCandidate[]=[];let invalid=0,categoryExcluded=0;
  const nodes=$('.vcard').filter((_,el)=>$(el).find('.listing-name').length>0);let section='';
  nodes.each((_,el)=>{
    const card=$(el),nameNode=card.find('.listing-name').first(),cleanName=nameNode.clone();cleanName.find('sup,.noprint,.deadlink,.mw-editsection').remove();
    const name=cleanName.text().replace(/\[(?:formerly )?dead link\]/gi,'').trim();
    if(/(?:\b(?:street|avenue|road|boulevard|lane)\b|[路街])$/i.test(name)&&!/museum|park|garden|temple|shrine|church|gallery|restaurant|cafe|café/i.test(name)){categoryExcluded++;return;}
    if(/\b(districts?|neighbou?rhoods?|boroughs?|arrondissements?|wards?)\b/i.test(name)&&!/museum|park|garden|temple|shrine|church|gallery/i.test(name)){categoryExcluded++;return;}
    // Listing marker colour is the template's typed group; article headings alone are insufficient.
    const colour=(card.find('a.mw-kartographer-maplink').first().attr('style')??'').match(/background-color:\s*(#[a-f0-9]+)/i)?.[1]?.toLowerCase();
    const groups:Record<string,string>={'#b75b1a':'eat','#000000':'drink','#3f75a2':'see'};
    const all=$('h2,h3,h4,.vcard').toArray();const position=all.indexOf(el);
    section='';for(let i=position-1;i>=0;i--){const item=$(all[i]);if(item.is('h2,h3,h4')){const heading=item.text().trim().toLowerCase();if(/^(eat|drink|see|do|buy|sleep|get in|get around)\b/.test(heading)){section=heading;break;}}}
    if(colour){if(!groups[colour]){categoryExcluded++;return;}section=groups[colour];}
    const description=card.find('.listing-content').text().trim();
    if(/permanently closed|no longer open|永久關閉|已歇業|폐업|définitivement fermé/i.test(description)){categoryExcluded++;return;}
    let category:string|null=null,mealTags:string[]=[],featureTags:string[]=[];
    if(mode==='food'&&/eat|drink/.test(section)&&!(/sleep|buy|get in|get around/.test(section))){category=/night market|夜市/i.test(name)?'小吃':/coffee|café|cafe|tea house/i.test(`${name} ${description}`)?'咖啡廳':/bakery|dessert|ice cream/i.test(`${name} ${description}`)?'甜點':/drink/.test(section)?'酒吧':'餐廳';mealTags=['咖啡廳','甜點'].includes(category)?['下午茶']:['午餐','晚餐'];}
    if(mode==='attraction'&&/see|do/.test(section)&&!(/buy|sleep|get in|get around/.test(section))){const text=`${name} ${description}`;category=/museum/i.test(text)?'博物館':/park|garden/i.test(text)?'公園':/temple|shrine|church|theatre|theater/i.test(text)?'文化':/mountain|lake|beach|waterfall/i.test(text)?'自然':/zoo|aquarium|theme park/i.test(text)?'親子':/gallery|exhibition/i.test(text)?'展覽':'地標';featureTags=['博物館','文化','展覽'].includes(category)?['文化']:['公園','自然'].includes(category)?['自然','戶外']:category==='親子'?['親子']:['觀光'];}
    if(!category){categoryExcluded++;return;}
    const lat=Number(card.find('.latitude').first().text()),lon=Number(card.find('.longitude').first().text());
    if(!card.find('.latitude').length||!card.find('.longitude').length||!name){invalid++;return;}
    const sourceUrl=pageUrl+'#'+encodeURIComponent(nameNode.attr('id')??name.replaceAll(' ','_'));
    const aliases=card.find('.listing-alt').text().replace(/[()（）]/g,'').trim().split(/[,，;；]/).filter(Boolean);
    const p=CandidateSchema.safeParse({id:`voyage:${sourceUrl}`,name,originalName:name,aliases,mode,category,latitude:lat,longitude:lon,address:card.find('.listing-address').text().trim()||'文章未提供地址',mealTags,featureTags,sourceUrl,retrievedAt:at,osmType:null,osmId:null,osmTags:{},openingHours:card.find('.listing-hours').text().trim()||null,website:null,evidence:[{provider:'Wikivoyage 公開旅遊文章',sourceId:sourceUrl,url:sourceUrl,retrievedAt:at,kind:'public-article',description:`文章 ${section} 分節中的具名列表及獨立經緯度；不使用文章標題作 POI`}],rating:null,reviewCount:null,popularityScore:null,localGemScore:null});
    if(p.success)candidates.push(p.data);else invalid++;
  });return{candidates,invalid,categoryExcluded,rawCount:nodes.length};
}
export class WikivoyageProvider implements DiscoveryProvider{
  id='Wikivoyage 公開旅遊文章';role='public-web' as const;
  async search(ctx:ProviderContext):Promise<ProviderResult>{
    const start=Date.now(),used=ctx.budget.used,host=process.env.WIKIVOYAGE_URL??'https://en.wikivoyage.org';
    const run=emptyRun(this,ctx,host,'附近旅遊文章 → 餐飲／景點分節 → 具名列表與獨立座標');const candidates:PlaceCandidate[]=[];
    try{
      const near=await requestJson(wikiApi(host,{action:'query',list:'geosearch',gscoord:`${ctx.anchor.latitude}|${ctx.anchor.longitude}`,gsradius:'10000',gslimit:'3',gsnamespace:'0'}),ctx,v=>GeoEnvelope.parse(v),{},3600000);
      run.cached=near.cached;const errors:string[]=[];
      for(const p of near.data.query.geosearch){
        try{const article=await requestJson(wikiApi(host,{action:'parse',pageid:String(p.pageid),prop:'text',disableeditsection:'1'}),ctx,v=>z.object({parse:z.object({title:z.string(),text:z.object({'*':z.string()})})}).parse(v),{},3600000);
          const pageUrl=`${host}/wiki/${encodeURIComponent(article.data.parse.title.replaceAll(' ','_'))}`;
          const parsed=parseTravelListings(article.data.parse.text['*'],pageUrl,ctx.mode,article.retrievedAt);
          candidates.push(...parsed.candidates);run.rawCount+=parsed.rawCount;run.invalidCount+=parsed.invalid;run.categoryExcluded+=parsed.categoryExcluded;run.cached=run.cached&&article.cached;run.retrievedAt=article.retrievedAt;
        }catch(e){errors.push(serviceError(e));ctx.signal.throwIfAborted();}
      }
      run.validCount=candidates.length;if(errors.length){run.status=candidates.length?'partial':'failed';run.error=errors.join('；');}return{candidates,run};
    }catch(e){run.status=candidates.length?'partial':'failed';run.error=serviceError(e);run.validCount=candidates.length;return{candidates,run};}
    finally{run.durationMs=Date.now()-start;run.requests=ctx.budget.used-used;}
  }
}
