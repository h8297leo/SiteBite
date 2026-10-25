import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
test('simulated malformed resolver response stays recoverable',async({page})=>{
 await page.route('**/api/resolve',route=>route.fulfill({json:{locations:[{latitude:'broken'}]}}));await page.goto('/');await page.getByRole('textbox').fill('測試');await page.getByRole('button',{name:'搜尋',exact:true}).click();await expect(page.getByRole('alert')).toContainText('來源資料格式無效');await expect(page.getByRole('textbox')).toBeVisible();
});
test('simulated no location result and network failure stay recoverable',async({page})=>{
 await page.route('**/api/resolve',route=>route.fulfill({json:{locations:[]}}));await page.goto('/');await page.getByRole('textbox').fill('無結果測試');await page.getByRole('button',{name:'搜尋',exact:true}).click();await expect(page.getByRole('alert')).toBeVisible();await expect(page.getByTestId('place-card')).toHaveCount(0);
 await page.unroute('**/api/resolve');await page.route('**/api/resolve',route=>route.abort());await page.getByRole('button',{name:'搜尋',exact:true}).click();await expect(page.getByRole('alert')).toContainText('網路連線失敗');
});
test('simulated late response cannot overwrite a new mode',async({page})=>{
 let release!:()=>void;const delayed=new Promise<void>(r=>release=r);await page.route('**/api/resolve',async route=>{await delayed;await route.fulfill({json:{locations:[]}}).catch(()=>{});});
 await page.goto('/');await page.getByRole('textbox').fill('延遲測試');await page.getByRole('button',{name:'搜尋',exact:true}).click();await page.getByRole('button',{name:/景點探索/}).click();release();await expect(page.getByRole('button',{name:/景點探索/})).toHaveAttribute('aria-pressed','true');await expect(page.getByRole('alert')).toHaveCount(0);await expect(page.getByTestId('place-card')).toHaveCount(0);
});
test('simulated tile failure preserves recorded actual-source list (mock API)',async({page})=>{
 const response=JSON.parse(readFileSync('tests/fixtures/longtan-food-response.json','utf8'));
 expect(response).toBeDefined();
 await page.route('**/api/resolve',route=>route.fulfill({json:{locations:[response.anchor]}}));
 await page.route('**/api/search',route=>route.fulfill({json:response}));
 await page.route('**://tile.openstreetmap.org/**',route=>route.abort());await page.goto('/');await page.getByRole('button',{name:'龍潭大池',exact:true}).click();await expect(page.getByTestId('place-card').first()).toBeVisible();await expect(page.getByText('部分圖磚無法載入；仍可使用地點列表與導航。')).toBeVisible();
});
