import {describe,it,expect,vi} from 'vitest';
import {generateDiscoveryQueries} from '../server/queryGenerator';
import {extractWebContent} from '../server/webContentExtractor';
import {resolvePlaceEntity,sameVenue} from '../server/placeEntityResolver';
import {Anchor,defaultFilters} from '../shared/model';
import {ProviderContext} from '../server/providers';
import {requestJson} from '../server/http';
vi.mock('../server/http',async importOriginal=>({...await importOriginal<typeof import('../server/http')>(),requestJson:vi.fn()}));
const anchor:Anchor={id:'test',name:'中心',displayName:'中心',latitude:25,longitude:121,country:'TW',city:'測試市',region:'',confidence:'source-match',source:'https://example.org/center',category:'搜尋中心',geoType:'city',originalInput:'中心'};
const ctx=(mode:'food'|'attraction'):ProviderContext=>({anchor,mode,filters:defaultFilters,radius:2000,round:1,signal:new AbortController().signal,budget:{used:0,limit:4},meter:{requests:0}});
describe('公開網頁搜尋層：模擬結構化內容，非真實來源測試',()=>{
 it('產生有界當地語言與英文查詢，雙模式關鍵字不同',()=>{
  for(const [country,language,term] of [['JP','ja','レストラン'],['KR','ko','음식점'],['FR','fr','restaurant']]){
   const food=generateDiscoveryQueries({...anchor,country},'food',defaultFilters),attractions=generateDiscoveryQueries({...anchor,country},'attraction',defaultFilters);
   expect(food).toHaveLength(2);expect(food[0].language).toBe(language);expect(food[0].text).toContain(term);expect(food[1].language).toBe('en');expect(food.map(q=>q.text)).not.toEqual(attractions.map(q=>q.text));
  }
 });
 it('文章標題不成為地點；JSON-LD 多店與景點分別提取，移除外部執行內容',()=>{
  const records={'@graph':[{'@type':'Restaurant',name:'甲店',geo:{latitude:25,longitude:121},address:'甲路1號'},{'@type':'CafeOrCoffeeShop',name:'乙店',geo:{latitude:25.001,longitude:121},url:'javascript:alert(1)'},{'@type':'TouristAttraction',name:'丙景點',geo:{latitude:25,longitude:121.001}},{'@type':'Article',name:'台北十大餐廳'}]};
  const p=extractWebContent(`<title>台北十大必吃餐廳</title><script>alert('evil')</script><script type="application/ld+json">${JSON.stringify(records)}</script><article>正式正文</article>`,'https://example.org/article');
  expect(p.places.map(v=>v.name)).toEqual(['甲店','乙店','丙景點']);expect(p.places.map(v=>v.mode)).toEqual(['food','food','attraction']);expect(p.places[1].officialUrl).toBeNull();expect(p.text).toBe('正式正文');
 });
 it('無結構化資料的文章集合標題及錯誤 JSON 不生成候選',()=>{
  const p=extractWebContent('<title>Top 10 restaurants</title><article><h2>Top 10 restaurants</h2></article><script type="application/ld+json">broken</script>','https://example.org/article');
  expect(p.places).toHaveLength(0);expect(p.exclusions).toContain('無法解析 JSON-LD');
 });
 it('可靠頁面座標可獨立進入候選，無 OSM 也保留來源且不产生分數',async()=>{
  const p=extractWebContent(`<script type="application/ld+json">${JSON.stringify({'@type':'Restaurant',name:'獨立餐廳',geo:{latitude:25.001,longitude:121.001}})}</script>`,'https://example.org/place').places[0];
  const r=await resolvePlaceEntity({...p,officialLocationAuthority:true},ctx('food'),'2026-10-12T00:00:00Z','fixture');
  expect(r.candidate?.osmId).toBeNull();expect(r.candidate?.rating).toBeNull();expect(r.candidate?.evidence[0].url).toBe(p.sourceUrl);expect(ctx('food').budget.used).toBe(0);
 });
 it('只有名稱、錯誤類別及遠方場所不納入推薦',async()=>{
  const p=extractWebContent(`<script type="application/ld+json">${JSON.stringify({'@type':'Restaurant',name:'位置不明'})}</script>`,'https://example.org/place').places[0];
  expect((await resolvePlaceEntity(p,ctx('food'),'now','fixture')).candidate).toBeUndefined();
  expect((await resolvePlaceEntity({...p,latitude:25,longitude:121},ctx('attraction'),'now','fixture')).reason).toContain('類別');
  expect((await resolvePlaceEntity({...p,latitude:48,longitude:2,officialLocationAuthority:true},ctx('food'),'now','fixture')).reason).toContain('搜尋區域');
 });
 it('未知網站 JSON-LD 自報座標不能代替獨立地理驗證',async()=>{
  vi.mocked(requestJson).mockResolvedValueOnce({data:{features:[]},url:'https://photon.komoot.io/api/',retrievedAt:'2026-10-12T00:00:00Z',cached:false});
  const p=extractWebContent(`<script type="application/ld+json">${JSON.stringify({'@type':'Restaurant',name:'未知餐廳',geo:{latitude:25.001,longitude:121.001}})}</script>`,'https://example.org/place').places[0];
  expect((await resolvePlaceEntity(p,ctx('food'),'now','fixture')).candidate).toBeUndefined();
 });
 it('近距離明確別名可合併，同品牌遠方分店保持分離',()=>{
  const a={name:'甲品牌101店',aliases:['Brand 101'],latitude:25,longitude:121};
  expect(sameVenue(a,{name:'Brand 101',aliases:[],latitude:25.0001,longitude:121})).toBe(true);
  expect(sameVenue(a,{name:'甲品牌101店',aliases:[],latitude:25.02,longitude:121})).toBe(false);
  expect(sameVenue(a,{name:'甲品牌其他分店',aliases:[],latitude:25,longitude:121})).toBe(false);
 });
});
