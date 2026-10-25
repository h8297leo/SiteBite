import { test, expect, Page } from '@playwright/test';
async function search(page:Page,query:string){
 const resolve=page.waitForResponse(r=>r.url().endsWith('/api/resolve'));
 await page.getByRole('textbox',{name:'搜尋地點'}).fill(query);await page.getByRole('button',{name:'搜尋',exact:true}).click();
 const locations=(await (await resolve).json()).locations;expect(locations).toBeDefined();
 const normalize=(s:string)=>s.replace(/台/g,'臺').replace(/\s/g,'');const exact=locations.filter((a:{name:string})=>normalize(a.name)===normalize(query));
 const city=locations.filter((a:{name:string;geoType:string})=>/city|country|state/.test(a.geoType)&&normalize(a.name).replace(/[市縣都府]$/,'')===normalize(query).replace(/[市縣都府]$/,''));
 if(city.length!==1&&locations.length>1&&(exact.length!==1||city.length>0)){await page.getByRole('heading',{name:'請選擇你要探索的位置'}).waitFor();await page.getByRole('button').filter({hasText:locations[0].displayName}).first().click();}
 await expect(page.getByTestId('result-count')).toBeVisible({timeout:85000});
}
test('actual network: fresh 台北101, independent modes, cards, map and navigation',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/');
 await search(page,'台北 101');await expect(page.getByRole('heading',{level:1})).toContainText(/101/);await expect(page.getByTestId('place-card').first()).toBeVisible();
 const food=await page.getByTestId('place-card').allTextContents();
 await page.getByTestId('place-card').first().getByRole('button',{name:/在地圖查看/}).click();await expect(page.locator('.leaflet-popup')).toBeVisible();await expect(page.getByTestId('place-card').first().getByRole('link',{name:'Google Maps 導航'})).toHaveAttribute('href',/google.com\/maps\/dir\/\?api=1/);
 await expect.poll(async()=>page.locator('.leaflet-tile-loaded').evaluateAll(imgs=>imgs.some(i=>(i as HTMLImageElement).naturalWidth>0))).toBe(true);
 await page.getByRole('button',{name:/景點探索/,exact:false}).click();await expect(page.getByTestId('result-count')).toBeVisible({timeout:85000});await expect(page.getByRole('button',{name:'博物館',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'餐廳',exact:true})).toHaveCount(0);
 const attractions=await page.getByTestId('place-card').allTextContents();expect(attractions).not.toEqual(food);await expect(page.getByTestId('place-card').first()).toBeVisible();
 await page.getByRole('button',{name:/美食探索/}).click();await expect(page.getByRole('button',{name:'餐廳',exact:true})).toBeVisible();expect(await page.getByTestId('place-card').allTextContents()).toEqual(food);
 await page.getByTestId('diagnostics').locator('summary').first().click();await expect(page.getByTestId('diagnostics')).toContainText('Overpass');expect(errors).toEqual([]);
 await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:'docs/core-desktop.png',fullPage:false});
});
test('actual network: address is center only; sequential 龍潭大池 mode/filter/map sync',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/');await search(page,'台北市信義區市府路1號');
 await expect(page.getByTestId('place-card').first()).toBeVisible();const addressCards=await page.getByTestId('place-card').allTextContents();expect(addressCards.some(t=>t.includes('台北市政府')&&t.includes('餐廳'))).toBe(false);
 await search(page,'龍潭大池');const food=await page.getByTestId('place-card').allTextContents();expect(food.some(t=>/龍潭大池公園/.test(t))).toBe(false);
 await page.getByRole('button',{name:/景點探索/}).click();await expect(page.getByTestId('result-count')).toBeVisible({timeout:85000});await expect(page.getByTestId('place-card').first()).toBeVisible();
 await page.getByRole('button',{name:'公園',exact:true}).click();const count=await page.getByTestId('map').locator('.leaflet-marker-icon').count();expect(count).toBeGreaterThanOrEqual(1);
 const cards=await page.getByTestId('place-card').allTextContents();expect(cards.every(t=>t.includes('公園'))).toBe(true);expect(errors).toEqual([]);
});
test('actual network: mobile first search and map survive switching modes',async({page})=>{
 await page.setViewportSize({width:390,height:844});await page.goto('/');await search(page,'龍潭大池');await page.getByRole('button',{name:'探索地圖',exact:true}).click();await expect(page.getByTestId('map')).toBeVisible();
 await page.getByRole('button',{name:/景點探索/}).click();await expect(page.getByTestId('result-count')).toBeVisible({timeout:85000});await page.getByRole('button',{name:'探索地圖',exact:true}).click();await expect(page.getByTestId('map')).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:'docs/core-mobile.png',fullPage:false});
});
test('GPS supplied public landmark coordinate uses actual discovery; refusal shows feedback',async({browser})=>{
 const context=await browser.newContext({geolocation:{latitude:25.0339,longitude:121.5645},permissions:['geolocation']});const page=await context.newPage();await page.goto('/');await page.getByRole('button',{name:'使用目前位置'}).click();await expect(page.getByTestId('place-card').first()).toBeVisible({timeout:85000});await expect(page.getByRole('textbox')).toHaveValue(/25.03390/);await context.close();
 const denied=await browser.newContext();const p=await denied.newPage();await p.addInitScript(()=>{navigator.geolocation.getCurrentPosition=(_ok,fail)=>fail?.({code:1,message:'simulated denial',PERMISSION_DENIED:1,POSITION_UNAVAILABLE:2,TIMEOUT:3});});await p.goto('/');await p.getByRole('button',{name:'使用目前位置'}).click();await expect(p.getByRole('alert')).toContainText('定位權限被拒絕');await denied.close();
});
