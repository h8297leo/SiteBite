import { load } from 'cheerio';
import { DiscoveryMode, PlaceCandidate } from '../shared/model';
export type ExtractedPlace={name:string;aliases:string[];address:string|null;latitude:number|null;longitude:number|null;mode:DiscoveryMode;category:string;sourceUrl:string;sourceTitle:string;siteName:string;publishedAt:string|null;officialUrl:string|null;categoryEvidence:string;locationEvidence:string;extraction:'json-ld'|'body-list'|'encyclopedia'|'forum-post';entityId?:string|null;officialLocationAuthority?:boolean;venueKind?:PlaceCandidate['venueKind'];openingHours?:string|null};
export function venueKind(name:string,type=''):PlaceCandidate['venueKind']{
 if(/(?:夜市|night market|시장)(?:美食|小吃|攻略|推薦)?$/i.test(name))return 'market';if(/(?:food court|美食街)$/i.test(name))return 'food-court';
 if(/商圈|shopping (?:district|area|mall)/i.test(name))return 'shopping-area';if(/攤$/.test(name)||/攤販|攤位|food stall|屋台|露店/.test(name+' '+type))return 'stall';
 return 'business';
}
export function classifyPlaceText(text:string):{mode:DiscoveryMode;category:string}|null{
 const rules:[RegExp,DiscoveryMode,string][]=[[/小吃|攤販|攤位|street food|food stall|屋台|露店|분식/i,'food','小吃'],[/咖啡廳|咖啡館|coffee ?shop|café|cafe\b|喫茶店|カフェ|카페/i,'food','咖啡廳'],[/麵包|烘焙|bakery|boulangerie|パン屋|베이커리/i,'food','麵包烘焙'],[/甜點|甜品|dessert|patisserie|ice cream|菓子|디저트/i,'food','甜點'],[/飲料店|茶飲|bubble tea|タピオカ|버블티/i,'food','飲料茶飲'],[/自助餐|buffet|뷔페/i,'food','自助餐'],[/速食|fast food|ファストフード|패스트푸드/i,'food','速食'],[/酒吧|餐酒館|\bbar\b|\bpub\b|居酒屋/i,'food','酒吧餐酒館'],[/餐廳|餐館|食堂|restaurant|restaurante|レストラン|식당|음식점/i,'food','餐廳'],[/博物館|博物馆|museum|musée|박물관/i,'attraction','博物館'],[/寺廟|神社|寺院|church|temple|성당|사찰/i,'attraction','宗教景點'],[/公園|公园|步道|\bpark\b|garden|jardin|공원/i,'attraction','公園步道'],[/古蹟|古迹|historic|monument|castle/i,'attraction','歷史古蹟'],[/美術館|美术馆|gallery|exhibition|展覽/i,'attraction','展覽活動'],[/地標|landmark|觀景台|viewpoint|tourist attraction/i,'attraction','地標建築']];
 const theme=/夜景|night view|nighttime view|夜景スポット|야경/i.test(text)?'夜景景點':/秘境|hidden gem|secluded attraction|穴場スポット/i.test(text)?'秘境探索':null;
 for(const [pattern,mode,category]of rules)if(pattern.test(text))return{mode,category:mode==='attraction'&&theme?theme:category};return null;
}
export type ExtractedContent={title:string;siteName:string;url:string;publishedAt:string|null;text:string;places:ExtractedPlace[];exclusions:string[]};
export function classifyStructuredType(types:string[]):{mode:DiscoveryMode;category:string}|null{
 const names=types.map(t=>t.split(/[\/#]/).pop());
 if(names.includes('CafeOrCoffeeShop'))return{mode:'food',category:'咖啡廳'};
 if(names.includes('Bakery'))return{mode:'food',category:'麵包烘焙'};
 if(names.includes('FastFoodRestaurant'))return{mode:'food',category:'速食'};
 if(names.some(t=>['Restaurant','FoodEstablishment'].includes(t??'')))return{mode:'food',category:'餐廳'};
 if(names.some(t=>['BarOrPub','Brewery'].includes(t??'')))return{mode:'food',category:'酒吧餐酒館'};
 const map:Record<string,string>={Museum:'博物館',Park:'公園',TouristAttraction:'地標',LandmarksOrHistoricalBuildings:'古蹟',ArtGallery:'展覽',Zoo:'親子',Aquarium:'親子'};
 for(const type of names)if(type&&map[type])return{mode:'attraction',category:map[type]};return null;
}
function safeUrl(value:unknown,base:string):string|null{try{const u=new URL(String(value),base);return /^https?:$/.test(u.protocol)?u.href:null;}catch{return null;}}
function date(value:unknown):string|null{if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}/.test(value)||!Number.isFinite(Date.parse(value)))return null;return value;}
/** Extracts bounded structured records; never treats an article heading as a venue. */
export function extractWebContent(html:string,url:string):ExtractedContent{
 const $=load(html),title=$('meta[property="og:title"]').attr('content')??$('title').text().trim(),siteName=$('meta[property="og:site_name"]').attr('content')??new URL(url).host;
 const publishedAt=date($('meta[property="article:published_time"]').attr('content')??$('time[datetime]').first().attr('datetime'));
 $('script:not([type="application/ld+json"]),style,nav,footer,iframe,.article-metaline,.article-metaline-right').remove();
 const places:ExtractedPlace[]=[],exclusions:string[]=[];let traversed=0;
 const documents:unknown[]=[],nodes=new Map<string,Record<string,unknown>>();
 const index=(v:unknown,depth=0)=>{if(depth>12||nodes.size>1000||!v||typeof v!=='object')return;if(Array.isArray(v)){for(const row of v)index(row,depth+1);return;}const obj=v as Record<string,unknown>;if(typeof obj['@id']==='string'&&Object.keys(obj).length>1)nodes.set(obj['@id'],obj);for(const child of Object.values(obj))index(child,depth+1);};
 $('script[type="application/ld+json"]').each((_,el)=>{try{const doc=JSON.parse($(el).text());documents.push(doc);index(doc);}catch{exclusions.push('無法解析 JSON-LD');}});
 const resolve=(v:unknown):Record<string,unknown>=>v&&typeof v==='object'&&!Array.isArray(v)?{...(nodes.get(String((v as Record<string,unknown>)['@id']))??{}),...v}:{};
 const visit=(value:unknown,depth=0)=>{
  if(depth>12||traversed++>1000)return;
  if(Array.isArray(value)){for(const v of value)visit(v,depth+1);return;}
  if(!value||typeof value!=='object')return;const obj=value as Record<string,unknown>;
  const types=Array.isArray(obj['@type'])?obj['@type'].map(String):[String(obj['@type']??'')];const classification=classifyStructuredType(types);
  if(classification){
   const name=typeof obj.name==='string'?obj.name.trim():'';
   if(name&&!/\b(top \d+|best restaurants|things to do)\b|十大|必吃推薦/i.test(name)){
    const location=resolve(obj.location),addr=obj.address??location.address;const address=typeof addr==='string'?addr:addr&&typeof addr==='object'?['addressCountry','addressRegion','addressLocality','streetAddress','postalCode'].map(k=>resolve(addr)[k]).filter(v=>typeof v==='string').join(' '):null;
    const geo=resolve(obj.geo??location.geo);const lat=Number(geo.latitude),lon=Number(geo.longitude);
    const located=geo.latitude!==undefined&&geo.latitude!==null&&geo.latitude!==''&&geo.longitude!==undefined&&geo.longitude!==null&&geo.longitude!==''&&Number.isFinite(lat)&&Number.isFinite(lon)&&Math.abs(lat)<=90&&Math.abs(lon)<=180;
    const specs=Array.isArray(obj.openingHoursSpecification)?obj.openingHoursSpecification:[obj.openingHoursSpecification];
    const days:Record<string,string>={Monday:'Mo',Tuesday:'Tu',Wednesday:'We',Thursday:'Th',Friday:'Fr',Saturday:'Sa',Sunday:'Su'};
    const hours=typeof obj.openingHours==='string'?obj.openingHours:Array.isArray(obj.openingHours)?obj.openingHours.filter(v=>typeof v==='string').join('; '):specs.flatMap(raw=>{const v=resolve(raw);if(!('opens'in v&&'closes'in v))return[];if(v.validFrom||v.validThrough)return[JSON.stringify(v)];const selected=(Array.isArray(v.dayOfWeek)?v.dayOfWeek:[v.dayOfWeek]).filter(Boolean).map(d=>days[String(d).split('/').pop()!]??String(d));return[`${selected.length?selected.join(',')+' ':''}${v.opens}-${v.closes}`];}).join('; ');
    places.push({name,aliases:typeof obj.alternateName==='string'?[obj.alternateName]:Array.isArray(obj.alternateName)?obj.alternateName.filter((v):v is string=>typeof v==='string'):[],...classification,address:address||null,latitude:located?lat:null,longitude:located?lon:null,sourceUrl:url,sourceTitle:title,siteName,publishedAt:date(obj.dateModified??obj.datePublished)??publishedAt,officialUrl:safeUrl(obj.url,url),categoryEvidence:`Schema.org ${types.join(', ')}`,locationEvidence:located?'頁面 JSON-LD GeoCoordinates':address?'頁面 JSON-LD PostalAddress':'未取得位置證據',extraction:'json-ld',venueKind:venueKind(name,types.join(' ')),openingHours:hours||null});
   }else exclusions.push('結構化名稱為文章集合或缺少場所名稱');
  }
  for(const [key,v]of Object.entries(obj))if(key!=='geo'&&key!=='address')visit(v,depth+1);
 };
 for(const doc of documents)visit(doc);
 // Explicit body listing elements require a venue name, type and address together.
 $('[itemtype]').each((_,el)=>{const node=$(el),type=node.attr('itemtype')??'',classification=classifyStructuredType([type]);if(!classification)return;const name=node.find('[itemprop="name"]').first().text().trim(),address=node.find('[itemprop="address"]').first().text().trim();if(!name||!address)return;
  if(places.some(p=>p.name===name&&p.address===address))return;
  places.push({name,aliases:[],address,latitude:null,longitude:null,...classification,sourceUrl:url,sourceTitle:title,siteName,publishedAt,officialUrl:null,categoryEvidence:`正文 microdata ${type}`,locationEvidence:'正文標記地址，尚需獨立地理解析',extraction:'body-list'});
 });
 // Conservative non-structured list: named heading plus labelled street address and explicit venue type.
 $('article h2,article h3,main h2,main h3,.entry-content h2,.entry-content h3,#main-content h2,#main-content h3,article li > strong:first-child,main li > strong:first-child').slice(0,60).each((_,el)=>{
  const heading=$(el),name=heading.text().trim().replace(/^\d+[.、)\s]+/,'');
  if(!name||name.length>80||/十大|\d+間|推薦清單|附近美食|地址|營業資訊|交通|聯絡|top \d+|best restaurants|things to do/i.test(name))return;
  const section=(heading.is('strong')?heading.parent().text():heading.nextUntil('h2,h3').slice(0,5).text()).replace(/\s+/g,' ').slice(0,1800);
  const address=section.match(/(?:地址|住所|所在地|Address|Adresse|주소)\s*[:：]\s*([^\n]{8,180}?)(?=電話|營業|營業時間|Tel|Hours|Opening|$)/i)?.[1]?.trim();
  if(!address||!/(?:路|街|號|丁目|番地|Street|St\b|Avenue|Ave\b|Road|Rd\b|Rue|Boulevard|로|길)/i.test(address))return;
  const classification=classifyPlaceText(name)??classifyPlaceText(section);
  if(!classification||places.some(p=>p.name===name))return;
  places.push({name,aliases:[],address,latitude:null,longitude:null,...classification,sourceUrl:url,sourceTitle:title,siteName,publishedAt,officialUrl:null,categoryEvidence:`正文同一場所段落明示${classification.category}；${section.slice(0,160)}`,locationEvidence:'正文標記街道地址，尚需獨立地理解析',extraction:'body-list',venueKind:venueKind(name),openingHours:section.match(/(?:營業時間|営業時間|Opening hours|Hours|영업시간)\s*[:：]\s*([^\n]{4,100})/i)?.[1]?.trim()??null});
 });
 $('br').replaceWith('\n');
 const body=$('#main-content').text()||$('article').text()||$('main').text()||$('body').text();
 const labelled=[...body.matchAll(/(?:^|\n)\s*(?:餐廳名稱|店家名稱|店名|攤位名稱|攤名|店舗名|상호|가게명|Restaurant name|Venue)\s*[:：]\s*([^\n]{2,80})/gmi)];
 for(let i=0;i<labelled.length&&places.length<100;i++){
  const name=labelled[i][1].trim(),start=labelled[i].index!+labelled[i][0].length,end=Math.min(labelled[i+1]?.index??body.length,start+800),section=body.slice(start,end);
  const address=section.match(/(?:地址|住所|所在地|Address|Adresse|주소)\s*[:：]\s*([^\n]{6,160})/i)?.[1]?.trim()??null;
  const classification=classifyPlaceText(name)??classifyPlaceText(section)??(/餐廳名稱/.test(labelled[i][0])?{mode:'food' as const,category:'餐廳'}:null);
  if(!classification||places.some(p=>p.name===name))continue;
  places.push({name,aliases:[],address,latitude:null,longitude:null,...classification,sourceUrl:url,sourceTitle:title,siteName,publishedAt,officialUrl:null,categoryEvidence:`具名場所欄位與同段明示${classification.category}；${section.slice(0,160)}`,locationEvidence:address?'原文地址，待交叉驗證':'僅具名提及，待驗證',extraction:new URL(url).hostname==='www.ptt.cc'?'forum-post':'body-list',venueKind:venueKind(name,section),openingHours:section.match(/(?:營業時間|営業時間|Opening hours|Hours|영업시간)\s*[:：]\s*([^\n]{4,100})/i)?.[1]?.trim()??null});
 }
 $('script').remove();return{title,siteName,url,publishedAt,text:($('article').text()||$('main').text()||$('body').text()).replace(/\s+/g,' ').trim().slice(0,30000),places:places.slice(0,100),exclusions};
}
