# SiteBite Phase 2 交付紀錄

版本 `0.3.0-public-web`，2026-10-12，僅公開網頁搜尋擴充。Express後端及Vite前端已啟動於 **http://localhost:3000/**，只供這台電腦操作，不是公開網址。未使用API Key。完成後等待使用者驗收，未進入Phase3。

## 已完成

- 直接檢查既有 Location Resolver、雙探索引擎、Overpass、Wikipedia、Wikivoyage、候選池與協調器後擴充，保留原始專案與P1.5功能。
- 實際可用的Wikipedia／Wikivoyage全文關鍵字搜尋、文章場所提取、Wikidata類別／位置／別名，以及NYC官方餐廳資料。
- 多語言、有界查詢；標準化、類別／座標／地區驗證；未知網頁自行宣告的位置須獨立比對；官方位置證據可不依賴OSM。
- JSON-LD多場所、microdata、具名正文分節及地址提取。文章標題不能直接成為推薦。
- 同輪來源隔離與候選合併；來源較慢不會因另一來源已滿50筆而被跳過。保留距離排序、10筆分頁、地圖同步、導航與取消。
- 卡片／詳情可展開多來源證據；診斷區分網頁、提取、驗證、候選池新增、最終新增、OSM合併及證據補充。Wikidata實體不當成網頁數。
- SSRF及DNS重新綁定防護、固定IP、逐次轉址、robots與Crawl-delay、逾時、限流、大小限制、快取與退避。無外部HTML直接渲染。
- 改善繁中海外複合地名的可追溯解析與消歧；衝突百科座標有獨立地理來源檢查。文章維護標記清理、已歇業場所排除、夜市餐飲分類，以及Overpass備援時間分配。

## 部分完成與限制

SearXNG通用搜尋介面已建立，但未配置自架或明確允許自動查詢的公開實例，因此沒有宣稱完成通用全網搜尋。DuckDuckGo未整合獲准介面。各國地方文章具擷取介面與來源清單，任意地方餐飲／旅遊網站仍需逐站確認政策、配置及測試，未宣稱已整合。

臺北旅遊網API遇Cloudflare驗證，觀光署ZIP拒絕自動存取，不繞過。Overpass實測會逾時／429／冷卻；來源失效時網站仍可操作，但公開餐飲來源較少的地區可能為0筆。Wikipedia及Wikidata的分類／座標是可追溯證據，並非營業或評價保證。

Google／社群／論壇只預留合法搜尋連結與摘要證據介面，不擷取評論、不計算任何分數。未實作星級、情緒、熱度、私房、跨平台評分或AI排名。

## 檢查與實際測試

- TypeScript及正式建置通過；Vitest **34項**通過，合成fixtures／mock HTTP，與真實資料分開。
- 固定版瀏覽器完整測試9項中8項通過；圖磚故障案例因當時龍潭美食實際0筆而無卡片，不能將此視為圖磚造成列表遺失。該案例改用已保存的真實HTTP回應、模擬API與圖磚失敗，針對性重測通過。共9個不同瀏覽器案例已驗證，沒有宣稱一次完整9/9。
- 真實瀏覽器涵蓋首次台北101搜尋、雙模式／卡片／來源／導航、地圖、一般地址、龍潭連續切換、手機、GPS供給公開座標及拒絕權限；模擬涵蓋錯誤格式、連線失敗、延遲回應與圖磚故障。
- 開發期間修改檔案曾觸發頁面重載而中斷兩項測試；監看範圍調整後重測通過，未將先前失敗算成通過。
- 八地區每地雙模式共16個真實HTTP案例，原始輸入在修改後均取得預期國家。所有模式、距離排序、非中心注入及無分數檢查通過；結果數不足另列限制，不宣稱每例50筆。
- 直接公開來源HTTP探測與完整原始回應保存在 `PUBLIC-KEYWORD-PROBE.json`、`NYC-PROBE.json`、`PHASE2-BASELINE.json`、`PHASE2-AFTER.json`。最終文章品質與備援修正後的針對性真實重測另存 `PHASE2-RETRY.json`，不取代原始16例。

## 量化改善

[逐地區表格、失敗率、前後耗時及來源限制](PHASE2-SEARCH-REPORT.md)；機器可讀比較在 `PHASE2-COMPARISON.json`。

16次搜尋的新來源累計候選池新增1,141筆，最終列表貢獻357筆，既有地點補充315筆證據。跨搜尋可能重複，不是全球獨立場所總數。NYC本次驗證662筆、與OSM合併156筆、新增候選池581筆、最終新增2筆，補充158筆證據，證明新來源不只是增添網頁連結。

最終針對性重測：龍潭大池美食50筆，Overpass成功驗證52筆；台北101美食50筆，Overpass驗證857筆，同輪新公開來源仍參與，驗證5筆、合併2筆OSM、新增1個獨立候選並進入最終列表。兩例皆無文章維護標記名稱及虛構分數。原始16例中龍潭0筆仍保留，不能以重測成功掩蓋公開服務失效時的限制。

修改前／後不是同步A/B：外部來源狀態、快取與中心修正影響差異；不能直接將結果數或耗時變化全歸因於新來源。修改前OSM數量只保有最終可見數及各輪提供者有效數，不能捏造未截取的獨立OSM池數量。新增到本次池也不代表該場所絕對不存在於OSM全球資料庫。

## 修改模組及版本

新增 `server/queryGenerator.ts`、`publicWeb.ts`、`webContentExtractor.ts`、`placeEntityResolver.ts`、`wikidataProvider.ts`、`localWebSources.ts`、`secureWeb.ts`、`src/components/SourceEvidence.tsx`；擴充 `server/searchOrchestrator.ts`、`locationResolver.ts`、`providers.ts`、`http.ts`、`index.ts`、`shared/model.ts`、`src/App.tsx`、`SearchDiagnostics.tsx`、Vite／Tailwind監看配置。新增來源、安全、協調器與瀏覽器測試及HTTP探測腳本。

原始來源 `../original-source` 未覆蓋。修改前 `../versions/sitebite-web-0.2.0-before-phase2.zip`，SHA256 `BDDEF62D98E3299FC70A4A27FD1BC747B36496C5F8B7CBA8475BCFC6A5F32DD6`。本目錄沒有Git提交，以 `VERSION.json`、保存版本及 `SOURCE-MANIFEST.json` 檔案雜湊提供版本紀錄。

## 使用者驗收方式

1. 開啟 http://localhost:3000/，先搜尋台北101或龍潭大池。位置有多個候選時確認國家及座標後選擇。
2. 切換「美食探索」／「景點探索」，確認卡片與地圖同步；使用距離／類別篩選與「顯示更多」。
3. 展開卡片「可查證來源」，檢查原文場所、定位／類別證據及外部連結；點擊Google Maps導航。
4. 展開搜尋診斷，查看新來源的實際查詢與四階段計數；SearXNG未配置、受阻或逾時來源應如實顯示。
5. 海外可搜尋東京新宿、大阪難波、首爾明洞、巴黎艾菲爾鐵塔、紐約時代廣場，分別驗收雙模式。

網站程序停止後，在本目錄使用 `npm run dev` 或 `./start-local.ps1` 重啟。等待使用者驗收後再討論後續階段。

