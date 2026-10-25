import { load } from 'cheerio';
import { DiscoveryMode } from '../shared/model';
export type ExtractedPlace={name:string;aliases:string[];address:string|null;latitude:number|null;longitude:number|null;mode:DiscoveryMode;category:string;sourceUrl:string;sourceTitle:string;siteName:string;publishedAt:string|null;officialUrl:string|null;categoryEvidence:string;locationEvidence:string;extraction:'json-ld'|'body-list'|'encyclopedia';entityId?:string|null;officialLocationAuthority?:boolean};
export type ExtractedContent={title:string;siteName:string;url:string;publishedAt:string|null;text:string;places:ExtractedPlace[];exclusions:string[]};
export function classifyStructuredType(types:string[]):{mode:DiscoveryMode;category:string}|null{
 const names=types.map(t=>t.split(/[\/#]/).pop());
 if(names.includes('CafeOrCoffeeShop'))return{mode:'food',category:'咖啡廳'};
 if(names.includes('Bakery'))return{mode:'food',category:'甜點'};
 if(names.some(t=>['Restaurant','FoodEstablishment','FastFoodRestaurant'].includes(t??'')))return{mode:'food',category:'餐廳'};
 if(names.some(t=>['BarOrPub','Brewery'].includes(t??'')))return{mode:'food',category:'酒吧'};
 const map:Record<string,string>={Museum:'博物館',Park:'公園',TouristAttraction:'地標',LandmarksOrHistoricalBuildings:'古蹟',ArtGallery:'展覽',Zoo:'親子',Aquarium:'親子'};
 for(const type of names)if(type&&map[type])return{mode:'attraction',category:map[type]};return null;
}
function safeUrl(value:unknown,base:string):string|null{try{const u=new URL(String(value),base);return /^https?:$/.test(u.protocol)?u.href:null;}catch{return null;}}
function date(value:unknown):string|null{if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}/.test(value)||!Number.isFinite(Date.parse(value)))return null;return value;}
/** Extracts bounded structured records; never treats an article heading as a venue. */
export function extractWebContent(html:string,url:string):ExtractedContent{
 const $=load(html),title=$('meta[property="og:title"]').attr('content')??$('title').text().trim(),siteName=$('meta[property="og:site_name"]').attr('content')??new URL(url).host;
 const publishedAt=date($('meta[property="article:published_time"]').attr('content')??$('time[datetime]').first().attr('datetime'));
 $('script:not([type="application/ld+json"]),style,nav,footer,iframe').remove();
 const places:ExtractedPlace[]=[],exclusions:string[]=[];let traversed=0;
 const visit=(value:unknown,depth=0)=>{
  if(depth>12||traversed++>1000)return;
  if(Array.isArray(value)){for(const v of value)visit(v,depth+1);return;}
  if(!value||typeof value!=='object')return;const obj=value as Record<string,unknown>;
  const types=Array.isArray(obj['@type'])?obj['@type'].map(String):[String(obj['@type']??'')];const classification=classifyStructuredType(types);
  if(classification){
   const name=typeof obj.name==='string'?obj.name.trim():'';
   if(name&&!/\b(top \d+|best restaurants|things to do)\b|十大|必吃推薦/i.test(name)){
    const addr=obj.address;const address=typeof addr==='string'?addr:addr&&typeof addr==='object'?['addressCountry','addressRegion','addressLocality','streetAddress','postalCode'].map(k=>(addr as Record<string,unknown>)[k]).filter(v=>typeof v==='string').join(' '):null;
    const geo=obj.geo&&typeof obj.geo==='object'?obj.geo as Record<string,unknown>:{};const lat=Number(geo.latitude),lon=Number(geo.longitude);
    const located=geo.latitude!==undefined&&geo.longitude!==undefined&&Number.isFinite(lat)&&Number.isFinite(lon)&&Math.abs(lat)<=90&&Math.abs(lon)<=180;
    places.push({name,aliases:typeof obj.alternateName==='string'?[obj.alternateName]:[],...classification,address:address||null,latitude:located?lat:null,longitude:located?lon:null,sourceUrl:url,sourceTitle:title,siteName,publishedAt:date(obj.dateModified??obj.datePublished)??publishedAt,officialUrl:safeUrl(obj.url,url),categoryEvidence:`Schema.org ${types.join(', ')}`,locationEvidence:located?'頁面 JSON-LD GeoCoordinates':address?'頁面 JSON-LD PostalAddress':'未取得位置證據',extraction:'json-ld'});
   }else exclusions.push('結構化名稱為文章集合或缺少場所名稱');
  }
  for(const [key,v]of Object.entries(obj))if(key!=='geo'&&key!=='address')visit(v,depth+1);
 };
 $('script[type="application/ld+json"]').each((_,el)=>{try{visit(JSON.parse($(el).text()));}catch{exclusions.push('無法解析 JSON-LD');}});
 // Explicit body listing elements require a venue name, type and address together.
 $('[itemtype]').each((_,el)=>{const node=$(el),type=node.attr('itemtype')??'',classification=classifyStructuredType([type]);if(!classification)return;const name=node.find('[itemprop="name"]').first().text().trim(),address=node.find('[itemprop="address"]').first().text().trim();if(!name||!address)return;
  if(places.some(p=>p.name===name&&p.address===address))return;
  places.push({name,aliases:[],address,latitude:null,longitude:null,...classification,sourceUrl:url,sourceTitle:title,siteName,publishedAt,officialUrl:null,categoryEvidence:`正文 microdata ${type}`,locationEvidence:'正文標記地址，尚需獨立地理解析',extraction:'body-list'});
 });
 // Conservative non-structured list: named heading plus labelled street address and explicit venue type.
 $('article h2,article h3,main h2,main h3').slice(0,60).each((_,el)=>{
  const heading=$(el),name=heading.text().trim().replace(/^\d+[.、)\s]+/,'');
  if(!name||name.length>80||/十大|推薦|附近美食|必吃|地址|營業資訊|交通|聯絡|top \d+|best restaurants|things to do/i.test(name))return;
  const section=heading.nextUntil('h2,h3').slice(0,5).text().replace(/\s+/g,' ');
  const address=section.match(/(?:地址|住所|所在地|Address|Adresse|주소)\s*[:：]\s*([^\n]{8,180}?)(?=電話|營業|營業時間|Tel|Hours|Opening|$)/i)?.[1]?.trim();
  if(!address||!/(?:路|街|號|丁目|番地|Street|St\b|Avenue|Ave\b|Road|Rd\b|Rue|Boulevard|로|길)/i.test(address))return;
  const text=name+' '+section;let classification:{mode:DiscoveryMode;category:string}|null=null;
  if(/咖啡廳|咖啡館|coffee ?shop|café|喫茶店|카페/i.test(text))classification={mode:'food',category:'咖啡廳'};
  else if(/餐廳|餐館|restaurant|レストラン|식당/i.test(text))classification={mode:'food',category:'餐廳'};
  else if(/博物館|museum|musée|박물관/i.test(text))classification={mode:'attraction',category:'博物館'};
  else if(/公園|park|jardin|공원/i.test(text))classification={mode:'attraction',category:'公園'};
  if(!classification||places.some(p=>p.name===name))return;
  places.push({name,aliases:[],address,latitude:null,longitude:null,...classification,sourceUrl:url,sourceTitle:title,siteName,publishedAt,officialUrl:null,categoryEvidence:'正文同一場所段落的明確餐飲／景點類型',locationEvidence:'正文標記街道地址，尚需獨立地理解析',extraction:'body-list'});
 });
 $('script').remove();return{title,siteName,url,publishedAt,text:($('article').text()||$('main').text()||$('body').text()).replace(/\s+/g,' ').trim().slice(0,30000),places:places.slice(0,100),exclusions};
}
