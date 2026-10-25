import { Anchor, DiscoveryMode, FilterState } from '../shared/model';

export type DiscoveryQuery={text:string;language:string;scope:'local'|'english';};
const terms:Record<string,{language:string;food:string;attraction:string}>={
 TW:{language:'zh',food:'餐廳 咖啡 美食',attraction:'景點 博物館 公園'},
 JP:{language:'ja',food:'レストラン 喫茶店',attraction:'観光 博物館 公園'},
 KR:{language:'ko',food:'음식점 카페',attraction:'관광 박물관 공원'},
 FR:{language:'fr',food:'restaurant café',attraction:'musée monument jardin'},
 DE:{language:'de',food:'Restaurant Café',attraction:'Museum Sehenswürdigkeit Park'},
 ES:{language:'es',food:'restaurante cafetería',attraction:'museo monumento parque'},
 IT:{language:'it',food:'ristorante caffè',attraction:'museo monumento parco'},
 US:{language:'en',food:'restaurant cafe',attraction:'museum landmark park'},
 GB:{language:'en',food:'restaurant cafe',attraction:'museum landmark park'},
};
/** Limited language-aware keywords; no named-place coordinates or results embedded. */
export function generateDiscoveryQueries(anchor:Anchor,mode:DiscoveryMode,filters:FilterState):DiscoveryQuery[]{
 const config=terms[anchor.country.toUpperCase()]??{language:'en',food:'restaurant cafe',attraction:'museum landmark park'};
 const context=anchor.city||anchor.region||anchor.name;
 const localSubject=mode==='food'?(filters.meal==='下午茶'?{ja:'喫茶店',ko:'카페',fr:'café',zh:'咖啡廳'}[config.language]??'cafe':config.food):config.attraction;
 return [{text:`${anchor.name} ${context} ${localSubject}`.trim(),language:config.language,scope:'local'},
 {text:`${context} ${mode==='food'?'restaurants cafes':'tourist attractions museums'}`,language:'en',scope:'english'}];
}
/** Wikipedia fulltext syntax is a separate scoped keyword source, not a general search engine. */
export function encyclopediaQuery(anchor:Anchor,mode:DiscoveryMode,language:string):string{
 const location=(anchor.city||anchor.region||anchor.name).replace(/["|]/g,' ').replace(/臺/g,'台');
 const words:Record<string,string[]>={zh:mode==='food'?['餐廳','咖啡']:['博物館','公園','古蹟'],ja:mode==='food'?['レストラン','喫茶店']:['博物館','公園','観光'],ko:mode==='food'?['음식점','카페']:['박물관','공원','관광'],fr:mode==='food'?['restaurant','café']:['musée','parc','monument'],en:mode==='food'?['restaurant','cafe','coffeehouse']:['museum','park','landmark']};
 return `${location} ${ (words[language]??words.en).join(' OR ')}`;
}
