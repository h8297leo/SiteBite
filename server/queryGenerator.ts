import { Anchor, DiscoveryMode, FilterState } from '../shared/model';
export type DiscoveryQuery={text:string;language:string;scope:'local'|'english'};
const languages:Record<string,string>={TW:'zh',HK:'zh',CN:'zh',JP:'ja',KR:'ko',FR:'fr',DE:'de',ES:'es',IT:'it',PT:'pt',US:'en',GB:'en',AU:'en',CA:'en'};
const generic:Record<string,[string,string]>={zh:['美食 餐廳','景點 博物館 公園'],ja:['レストラン グルメ','観光 博物館 公園'],ko:['음식점 맛집','관광 박물관 공원'],fr:['restaurant cuisine locale','musée monument jardin'],de:['Restaurant lokale Küche','Museum Sehenswürdigkeiten Park'],es:['restaurante comida local','museo monumento parque'],it:['ristorante cucina locale','museo monumento parco'],pt:['restaurante comida local','museu monumento parque'],en:['restaurants local food','tourist attractions museums']};
const foodWords:Record<string,Record<string,string>>={
 '餐廳':{en:'restaurant',ja:'レストラン',ko:'식당',fr:'restaurant'},'小吃':{en:'street food stalls local snacks',ja:'屋台 食べ歩き',ko:'분식 길거리음식',fr:'cuisine de rue'},'咖啡廳':{en:'cafe coffee shop',ja:'喫茶店 カフェ',ko:'카페',fr:'café'},'甜點':{en:'dessert patisserie',ja:'スイーツ 菓子',ko:'디저트',fr:'pâtisserie'},'麵包烘焙':{en:'bakery',ja:'パン屋',ko:'베이커리',fr:'boulangerie'},'飲料茶飲':{en:'tea bubble tea',ja:'お茶 タピオカ',ko:'차 버블티',fr:'salon de thé'},'速食':{en:'fast food',ja:'ファストフード',ko:'패스트푸드',fr:'restauration rapide'},'自助餐':{en:'buffet',ja:'ビュッフェ',ko:'뷔페',fr:'buffet'},'酒吧餐酒館':{en:'bar pub',ja:'バー 居酒屋',ko:'바 주점',fr:'bar bistrot'},
};
const attractionWords:Record<string,string>={'自然景觀':'nature landscape','公園步道':'park hiking trail','歷史古蹟':'historic site','文化藝術':'culture art','博物館':'museum','展覽活動':'exhibition gallery','地標建築':'landmark architecture','拍照景點':'viewpoint photography','親子景點':'family attraction','商圈老街':'historic shopping district market','夜景景點':'night view observation','宗教景點':'temple shrine church','秘境探索':'documented secluded attraction'};
const mealWords:Record<string,string>={'早餐':'breakfast','早午餐':'brunch','午餐':'lunch','下午茶':'afternoon tea','晚餐':'dinner','宵夜':'late night food','24小時':'24 hour'};
export function generateDiscoveryQueries(anchor:Anchor,mode:DiscoveryMode,filters:FilterState):DiscoveryQuery[]{
 const language=languages[anchor.country.toUpperCase()]??'en',context=[anchor.name,anchor.city||anchor.region].filter(Boolean).join(' ');
 const specific=mode==='food'?foodWords[filters.category]:undefined;
 const english=mode==='food'?(specific?.en??generic.en[0]):(attractionWords[filters.category]??generic.en[1]);
 const local=language==='zh'?(mode==='food'?(specific?filters.category:generic.zh[0]):(['全部','全部景點'].includes(filters.category)?generic.zh[1]:filters.category)):(specific?.[language]??(mode==='attraction'&&attractionWords[filters.category]?`${generic[language]?.[1]??''} ${english}`:generic[language]?.[mode==='food'?0:1]??english));
 const meal=filters.meal??'';
 return[{text:`${context} ${local} ${language==='zh'?meal:mealWords[meal]??''}`.trim(),language,scope:'local'},
 {text:`${anchor.englishName??anchor.name} ${english} ${mealWords[meal]??''}`.trim(),language:'en',scope:'english'}];
}
export function encyclopediaQuery(anchor:Anchor,mode:DiscoveryMode,language:string){return `${anchor.name} ${generic[language]?.[mode==='food'?0:1]??generic.en[mode==='food'?0:1]}`;}
