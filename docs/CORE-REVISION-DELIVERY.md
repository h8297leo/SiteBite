# 搜尋核心修正交付紀錄

版本：`0.2.0-core`。日期：2026-10-12，Asia/Taipei。本次是現有Phase 1搜尋核心修正，沒有開發國際評分、社群聲量或私房演算法。完成後等待使用者驗收。

## 保留及版本

原始程式保存在 `../original-source`，未修改；第一版修改前原始碼、設定、測試、文件完整封存於 `../versions/sitebite-web-0.1.0-before-core-revision.zip`，SHA256 `419339E463BC595AB5FDA6E20EF47D4A93DBC16AD369452F278E6FA9DB085D0F`。根目錄現有 `SiteBite_P1.zip` 亦未修改。採獨立目錄與版本紀錄，沒有Git commit；VERSION與SOURCE-MANIFEST保存本次檔案SHA256。

## 修正模組及根因

| 模組 | 修正 |
|---|---|
| server/locationResolver.ts | 從舊混合模組分離；只輸出中心及地理類型／原始輸入／可信度／來源。通用地址拆解重新排列查詢詞；以Wikipedia地名座標與country/type消歧，避免同名店家或高鐵站優先於城市。數字簡稱與不明地點由使用者選擇，沒有101、漢堡王或固定城市座標特例。 |
| server/engines.ts | Food與Attraction獨立OSM查詢、分類、起始範圍／上限，午晚餐／下午茶類型與有證據的早餐／宵夜。修正shop=coffee／tea只是零售、不等於咖啡廳。 |
| server/providers.ts | Overpass主地理來源；Wikipedia實際文章內容／座標／分類；Wikivoyage實際HTML的具名列表、獨立座標與typed標記。修正只靠文章heading會將藝術村／中山堂誤當餐飲的問題。Provider HTTP成功仍必須解析與驗證，失敗隔離。 |
| server/taiwanOpenData.ts | 真實官方餐飲／景點ZIP Adapter與來源ID。實测遭安全性封鎖，顯示failed／skipped，暫停重試，未繞過；不把手動取得的檔案注入正式搜尋冒充即時Provider。 |
| server/http.ts | 共用HTTP、識別應用程式、每主機串行／節流、驗證後快取、請求預算及取消、限流冷卻。 |
| server/searchOrchestrator.ts | Promise.allSettled隔離Provider與格式解析；獨立模式CandidatePool，必要欄位／模式／地理驗證、識別碼及近距離別名去重、來源證據合併；最多3輪、密度調整半徑、50個符合條件才提早停止。中心不自動加入池。 |
| server/index.ts | API接收mode和共用filters；只接受伺服器解析過的中心；GPS已知座標不因反向解析逾時失效。 |
| shared/model.ts | Anchor與PlaceCandidate徹底分離；原始OSM tags／ID、公開文章Evidence、mode、meal／feature、nullable rating等；未來rating／social Evidence的Zod型別預留，無生成內容。 |
| src/App.tsx | 明確模式切換、分開分類／條件／各中心結果快取；切換或新搜尋清除過期資料，請求取消及序號保護；地圖、列表、数量同一份篩選結果；每次10筆，補充搜尋會送完整條件給後端。 |
| src/components/InteractiveMap.tsx | 實際測試捕捉模式切換後 `Cannot read properties of undefined (reading '_leaflet_pos')`。根因是Leaflet卸載時仍有動畫／resize後續工作；取消縮放／fade動畫，清理時stop、closePopup、remove，observer檢查實例。修正後無pageerror。 |
| src/components/SearchDiagnostics.tsx | 原始輸入、中心、模式、座標、條件、各Provider實際狀態／HTTP／快取／候選／排除、每輪池、去重、排序後結果、時間預算、停止／未完成原因及實際查詢。 |

原 `server/discovery.ts` 的Photon nearby主查詢與Anchor直接注入已移除，舊版本可在修改前ZIP還原。Brand／原SVG雷達／深色CSS／Leaflet／GPS／導航／卡片／詳情／手機與桌面操作保留。

## 可操作預覽

交付時React前端與Node後端在 http://localhost:3000 同源運行，僅本機127.0.0.1；已打开Codex預覽，不提供虛構公開網址。啟動時清空GEMINI_API_KEY／GOOGLE_MAPS_API_KEY／GOOGLE_SEARCH_API_KEY／GOOGLE_SEARCH_CX，程式沒有核心金鑰依賴。健康API回報version=0.2.0-core，engines=[food,attraction]，apiKeysRequired=false。

停止程序後，在sitebite-web執行 `npm install`、`npm run dev`，或此電腦 `./start-local.ps1`。建置、測試及完整技術說明見README。

## 真實公開HTTP驗收（最後核心版本）

`scripts/verify-live.mjs` 對7個輸入分別執行雙模式，逐筆保存中心、候選樣本、原始tags、來源、各輪／Provider狀態。**這是實際來源資料，部分請求使用應用程式合法快取，並非每次都重新下載。** 所有14次回應的country、mode以及距離升冪检查均正確。

| 輸入 | 國家／中心 | 美食 | 景點 | 說明 |
|---|---|---:|---:|---|
| 台北 101 | TW／台北101、信義區 | 50 | 50 | 主Overpass餐飲885候選；不是一間漢堡王即停止。中心及POI分離，台北101在景點模式來自獨立查詢。 |
| 台北市信義區市府路1號 | TW／臺北市政府、信義區 | 50 | 50 | 地址只作中心；餐飲包含独立查詢的市政大樓餐廳／ENJOY等，景點包含附近展館／公園。未把中心當餐廳。 |
| 龍潭大池 | TW／桃園龍潭 | 50 | 50 | 美食是餐飲；景點2km不足，扩至4km第2輪。湖泊經獨立來源驗證才在景點池。Longtan Lake與中文同一實體合併。 |
| 台北 | TW／臺北市代表點 | 50 | 50 | 不使用普通地址／道路當POI。 |
| 台南 | TW／臺南市公開地名座標 | 50 | 50 | 修正原先誤選台南高鐵站問題。 |
| 東京 | JP／東京城市代表點 | 50 | 11 | 景點Overpass部分／失敗，3輪保留文章來源的11筆，不補假資料。 |
| 巴黎 | FR／巴黎城市座標 | 15 | 43 | 修正原先同名台灣店家問題；Overpass失敗，3輪取得實際文章候選。 |

東京和巴黎結果不足50是實測來源可用性限制，未宣稱全面50筆能力。完整原始紀錄 `LIVE-RESULTS.json`；第一輪的地址失敗／錯城市／混入文章地理項目紀錄保留在 `LIVE-RESULTS-initial.json`，不把舊錯誤當成最終結果。

額外實際無結果：`scripts/verify-empty.mjs` 在無人海域座標0,0執行美食探索，HTTP200、3輪、0筆，無假資料補入；记录 `NO-RESULTS-LIVE.json`。該次Overpass失敗，公開文章取得的內容經類別與距離驗證後沒有有效美食。這證明現有其他來源下正確返回空結果，不宣稱Overpass成功搜索該區。

## 自動驗收與模擬區分

- TypeScript strict + production build通過。
- Vitest核心測試：13項（含最後新增GPS反向解析逾時防護）。fixtures與mock HTTP只在tests內，測試地址／道路排除、模式查詢、可選欄位、非法座標、來源證據、近距離去重／分店、文章類型、餐飲零售tag、距離／未知評分、Provider逾時隔離、HTTP200錯誤格式、75候選池再驗證取50、GPS反向解析失敗保留座標。
- Playwright完整核心套件7項通過（1.3分鐘）：3項真實網路場景（首次台北101及雙模式、地址接龍潭並同步、390×844手機）＋4項模擬故障（格式錯誤、空地名／斷網、延遲回應切換模式、圖磚失敗）。初次捕捉Leaflet例外與地址失敗，已修正并重測。
- 額外GPS瀏覽器驗收通過（33.8秒）：測試提供台北101的公開座標，以真實後端／來源搜尋；另模擬權限拒絕顯示提示。此項單獨執行，不是讀取使用者的實際GPS位置。共8項不同瀏覽器測試已通過，執行方式為完整7項＋新增GPS一項，沒有宣稱最後一次指令同時執行了全部8項。
- 真實Provider故障：Overpass實際忙碌／逾時／部分資料、官方ZIP實際安全性拒絕，其他來源持續返回結果。人工模擬Timeout與資料格式錯誤不當作實際站點成功紀錄。

## 外部及尚未解決限制

1. Overpass最佳努力服務，實測可成功數百候選也可能忙碌／逾時／部分回應。故障時不能保證50筆；UI能顯示來源與實際不足原因。
2. 觀光署ZIP對Node自動請求回傳Request Rejected，Adapter已建立但不能稱為可用來源。已暂停、不繞過，也沒有寄送任何回報郵件。
3. 公開網頁發現目前是Wikipedia與Wikivoyage，並非通用全網搜尋；未接入DDG／SearXNG／Google／Bing或受限社群。至少兩條實際文章流程已運作，不以OSM冒充網頁搜尋。
4. Wikivoyage只讀附近最多3篇文章、可信列表類型與座標；未支援的列表型別／沒有座標者會排除。Wikipedia分類不夠明確者也排除；這會減少数量，但不猜測POI。
5. 城市來源代表點不等同遍歷整個行政範圍；最大3輪、距離與時間預算会停止。未限制使用者端距離，不代表无限地理查询。
6. 早餐／宵夜常缺可靠tags；空結果就如實顯示。用餐類型不保證開門，未解析所有國際營業時間規則。平台評分／評論數／社群熱門／私房／綜合分數仍null，本次不實作。
7. 原名可能英文／日文／來源中文字，不編造翻譯；多來源實體合併採保守識別與近距離別名，不宣稱全世界每一筆分店都已人工核對。
8. 地圖源可能失敗，列表仍保留；導航驗證是Google Maps一般網址及目標座標，不宣稱實際完成導航行程。

## 使用者驗收步驟

1. 開啟本機預覽，輸入「台北 101」，確認信義區中心及餐飲結果。
2. 切「景點探索」，確認分類／卡片／數量／標記變化，再切回美食。
3. 搜尋一般地址，再搜尋龍潭大池，確認沒有地址卡片／大池餐廳。
4. 測試台北、台南、東京、巴黎；有選項時先確認國家與座標。
5. 展開搜尋診斷，查看是否真正執行來源、擴張紀錄、失敗原因；不足50筆不能讀成未嘗試搜尋。
6. 點卡片定位、Google Maps導航、顯示更多、手機地圖切換與GPS（需瀏覽器權限）。

完成即停止；等待你确认本次搜尋核心修正。若回報問題，優先修正這個版本，不進入評論／社群階段。
