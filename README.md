# SiteBite Web — Phase 2 公開網頁發現

版本 `0.3.0-public-web`。在 P1.5 擴充，保留雙搜尋引擎、雷達、地圖、GPS、導航、篩選、取消及過期回應保護。

## Render 正式環境

使用 **Node Web Service**，Repository `h8297leo/SiteBite`、Branch `main`、Root Directory 留空（Repository 根目錄就是應用程式）。

| 設定 | 值 |
| --- | --- |
| Build Command | `npm ci --include=dev && npm run build` |
| Start Command | `npm run start` |
| Health Check Path | `/api/health` |
| Environment | `NODE_ENV=production` |
| Node.js | `package.json` 限定 `>=22.12.0 <25`，建議24.x；本機測試24.22.0 |
| PORT | 由Render提供，不必手動設定 |

Build 明確包含 TypeScript、Vite 等開發依賴；執行期 `tsx` 位於正式依賴。保留 `--production` 模式，由 Express 在 `0.0.0.0:$PORT` 提供 `dist/` 與 `/api/*`，前後端使用同一個網域。開發模式維持 `127.0.0.1`；兩種模式的預設PORT均為3000。

Render終止外部HTTPS，再將請求轉送至Express HTTP埠，無須在應用程式新增憑證或另建前端服務。這是部署相容性修正，尚未建立或驗證實際Render公開網址；建立服務後，請檢查首頁與 `/api/health`，並操作搜尋。

部署測試：`npm run test:deployment` 驗證正式啟動、首頁／JS、健康JSON與API驗證；`npm run test:deployment -- --dev` 驗證本機模式；`npm run test:deployment -- --live` 會額外向公開來源實際解析台北101並搜尋美食／景點。測試使用13001／13002埠，結束時只停止自己建立的程序。外部來源可能逾時或限流，不將0筆結果當成找到地點。

正式與開發依賴皆可透過 `npm ci --include=dev` 安裝；若只要執行已建置版本，可使用 `npm ci --omit=dev` 再 `npm run start`。本機驗收結果見 [Render部署修正紀錄](docs/RENDER-COMPATIBILITY.md)。

平台設定依據：[Render Web Services](https://render.com/docs/web-services)、[Health Checks](https://render.com/docs/health-checks)、[Node.js版本](https://render.com/docs/node-version)。

## 啟動

在本目錄執行 `npm install`、`npm run dev`（亦支援 pnpm）。單一程序啟動 Express 後端及 Vite 前端，網址 **http://localhost:3000/**，只供本機使用，不是公開部署。此電腦亦可使用 `./start-local.ps1`。核心搜尋不需要 API Key。

檢查：`npm run build`、`npm test`、`npm run test:e2e`。Playwright 使用已安裝的 Edge，執行前須啟動網站。

## 搜尋架構

中心解析 → 美食／景點獨立引擎 → 同輪 Provider 隔離執行 → 場所／類別／位置驗證 → 候選池去重／來源合併 → 距離排序 → 最多50筆、每次顯示10筆。新來源不會因 OSM 先填滿50筆而被跳過。

保留 Overpass、Wikipedia 附近文章、Wikivoyage 附近文章。新增 Wikipedia／Wikivoyage 全文關鍵字搜尋、Wikidata 實體、NYC 官方餐廳資料；選配 SearXNG 與地方文章擷取。百科查詢明確標示其範圍，不冒充通用網頁搜尋。

新模組：`queryGenerator.ts`、`publicWeb.ts`、`webContentExtractor.ts`、`placeEntityResolver.ts`、`wikidataProvider.ts`、`localWebSources.ts`、`secureWeb.ts`。JSON-LD、microdata、具名正文分節可以提取多個場所。普通文章自行宣告座標須獨立驗證；可靠官方位置資料／百科實體可以不依賴 OSM POI。來源保存名稱、網址、時間、定位及類別證據，不計算任何評分。

每輪來源最多23秒，探索62秒／30次HTTP／最多3輪。新擷取2MB上限，既有API／ZIP10MB；快取、間隔、退避、取消、robots與Crawl-delay皆受控。DNS所有IP須公開，固定驗證IP，逐次檢查轉址，拒絕內網與雲端中繼資料。前端不渲染外部HTML。403／429／驗證頁面不繞過。

## 選配與限制

SearXNG僅接受自架或明確允許自動查詢的公開HTTPS實例，設定 `SEARXNG_URL` 及 `SEARXNG_AUTOMATION_ALLOWED=true`；JSON必須可用，內網實例仍受SSRF禁止。未設定時如實標示未執行。DuckDuckGo未整合獲准的通用搜尋介面。

地方文章在確認條款後設定 `WEB_SOURCE_URLS`，格式見 `.env.example`。`officialLocationAuthority=true`僅適用官方發布者的位置權威資料。網站清單不代表完成整合；未設定或未測試的各國部落格、餐飲及旅遊網站仍屬部分完成。

臺北旅遊網 API 實測遇到Cloudflare驗證，觀光署ZIP拒絕自動存取，不繞過。Google及社群／論壇僅預留合法搜尋連結／摘要證據介面，未完整擷取內容。未實作星級、評論、熱度、私房或推薦分數。

參考官方文件：[SearXNG API](https://docs.searxng.org/dev/search_api.html)、[MediaWiki](https://www.mediawiki.org/wiki/API:Main_page)、[NYC資料API](https://dev.socrata.com/foundry/data.cityofnewyork.us/43nn-pn8j)。

## 測試與保留版本

原始專案在 `../original-source`，修改前來源在 `../versions/sitebite-web-0.2.0-before-phase2.zip`。版本紀錄見 `VERSION.json`，來源檔雜湊見 `SOURCE-MANIFEST.json`。

[Phase 2 交付及真實HTTP比較報告](docs/PHASE2-DELIVERY.md)與 `docs/PHASE2-BASELINE.json`、`docs/PHASE2-AFTER.json`、`docs/PHASE2-COMPARISON.json` 分開記錄實際資料與單元模擬。結果受外部服務、快取及中心座標差異影響；不以50筆證明改善。Vitest使用mock／fixtures；瀏覽器真人資料測試及故障模擬分檔。GPS使用公開地標座標與模擬瀏覽器權限，不是使用者真實GPS。

驗收八地點雙模式，展開卡片「可查證來源」與「搜尋診斷」，檢查網頁→提取→驗證→候選池／最終新增。Wikidata實體筆數不當成網頁數。完成後等待驗收，不自動進入Phase3。

## GitHub 原始碼範圍

Repository 保留完整 `src/`、`server/`、`shared/`、必要測試、驗證腳本、套件鎖定檔與說明文件。圖磚故障測試所需的單一歷史回應保存在 `tests/fixtures/`，僅供測試使用。

`node_modules/`、`.env*`（安全範本 `.env.example` 除外）、金鑰檔、快取、建置產物、測試報告、歷史搜尋 JSON、截圖、探索用 probe、生成的來源雜湊清單與 ZIP 備份不納入 Git，仍保留於本機。因此上述歷史報告引用的原始 JSON、圖片、`SOURCE-MANIFEST.json` 及 `../versions/` 並不隨 Repository 發布；Markdown 報告保留其原始測試日期與限制，不代表本次重新驗證了外部搜尋服務。

