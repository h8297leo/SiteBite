import { test, expect } from '@playwright/test';
test('actual HTTP: Phase 2 public discovery stages and multi-source evidence are usable',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/');
 await page.getByRole('button',{name:/景點探索/}).click();
 const resolution=page.waitForResponse(r=>r.url().endsWith('/api/resolve'));
 await page.getByRole('textbox',{name:'搜尋地點'}).fill('台北101');
 const response=page.waitForResponse(r=>r.url().endsWith('/api/search'),{timeout:90000});
 await page.getByRole('button',{name:'搜尋',exact:true}).click();
 const a=(await (await resolution).json()).locations;
 const norm=(s:string)=>s.normalize('NFKC').replace(/台/g,'臺').replace(/\s/g,'');
 const exact=a.filter((v:{name:string})=>norm(v.name)===norm('台北101'));
 if(a.length>1&&exact.length!==1){await page.getByRole('heading',{name:'請選擇你要探索的位置'}).waitFor();await page.getByRole('button').filter({hasText:a[0].displayName}).first().click();}
 const data=await (await response).json();expect(data.mode).toBe('attraction');
 expect(data.diagnostics.providers.some((r:{sourceType?:string;verifiedPlaces?:number})=>r.sourceType&&(r.verifiedPlaces??0)>0)).toBe(true);
 expect(data.places.every((p:{mode:string;rating:null})=>p.mode==='attraction'&&p.rating===null)).toBe(true);
 await expect(page.getByTestId('place-card').first()).toBeVisible();
 await page.getByTestId('source-evidence').first().locator('summary').click();await expect(page.getByTestId('source-evidence').first().getByRole('link').first()).toHaveAttribute('href',/^https?:\/\//);
 await page.getByTestId('diagnostics').locator('summary').first().click();await expect(page.getByTestId('web-discovery')).toContainText('解析');await expect(page.getByTestId('diagnostics')).toContainText('SearXNG');
 expect(errors).toEqual([]);await page.screenshot({path:'docs/phase2-desktop.png',fullPage:false});
});
