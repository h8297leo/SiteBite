# 原始專案盤點與保留策略

來源：`../sitebite.zip`；完整解壓保存在 `../original-source`，新程式位於獨立 `sitebite-web`。不執行原始 README、註解中的開發指令；它們僅為被分析的專案內容。原始 ZIP SHA256：`AA99D0421D91E2146E3208E118B564D31A6073F812F0A34AAD4A1DFC9D321675`。

分類：A 可直接保留；B 保留設計／功能但修正；C 重新設計；D 無效、不合理或刪除於新版本。原始檔案不刪除。

| 原始檔案 | 分類 | 實際功能與判定／新版本處置 |
|---|---|---|
| package.json、bun.lock | B | React、TypeScript、Vite、Express、Leaflet、Tailwind、Lucide 合理；新目錄獨立鎖檔與工具版本，移除 Gemini SDK，增加 Zod／Vitest／Playwright。 |
| server.ts | C | Express+Vite 可沿用技術；原 API 幾乎不驗證輸入，OSM 狀態無探測卻標 Connected。重寫同源前後端啟動、驗證與錯誤。 |
| src/App.tsx | B/C | 搜尋、GPS、列表、地圖、分頁、篩選、手機切換合理；無取消、過期回應保護或回應驗證，使用生成的評分。保留互動目的，重寫狀態與資料契約。 |
| src/main.tsx | B | createRoot 入口；原版沒有 ErrorBoundary。新入口使用 StrictMode、全頁和地圖獨立 ErrorBoundary。 |
| src/index.css | A/B | 深色科技、綠色雷達、Leaflet 深色 popup 可保留，直接複用並增加新元件樣式。 |
| components/RadarLogo.tsx | A/B | 原始 SVG 雷達、掃描、減少動態偏好直接複用；將 AI/英文待命文字改為繁中。 |
| components/Header.tsx | B/D | 品牌與回首頁保留；Demo 切換及不實的 API 連線宣稱移除。完整資料來源狀態視窗尚待後續。 |
| components/InteractiveMap.tsx | B | Leaflet 實際可操作、中心、標記、縮放、導航、GPS、同步；直接把外部字串插入 innerHTML，有座標／評分渲染風險。重寫 DOM textContent popup、ResizeObserver、完整卸載清理與局部錯誤隔離。 |
| components/PlaceCard.tsx | B | 卡片、分類、距離、詳情、來源、導航保留設計；綜合分數／AI 星級依賴不可靠計算。重寫並以 null 顯示無證據。 |
| components/PlaceDetailModal.tsx | B | 詳情、營業時間、網站、導航、來源保留；原始／綜合評分、社群區塊待 Phase 5 真實證據接入。 |
| components/FilterPanel.tsx | B/C | 原版分類／距離／時段／評分／特色／價格／排序真的對記憶體資料運算；部分依據名稱、分類猜測、熱門門檻或生成標籤。Phase 1 保留基本分類、距離、名稱／距離排序與評分篩選，無公開評分時符合數為零；完整條件與深入搜尋待 Phase 3。 |
| components/TopHighlightsSection.tsx | B/C | 私房、熱門、附近分區及快捷篩選存在；前兩者用不可靠分數。概念保留但明示尚未完成，尚不列虛構 Top 5。 |
| components/ApiStatusModal.tsx | B/C | 真正顯示後端狀態資料，但原後端「已設定」與「服務健康」混淆。Phase 1 僅實際 API 健康與本次來源狀態；完整 Provider 診斷 Phase 2。 |
| services/api.ts | C | 搜尋、reverse、status、parse-intent 都有 HTTP 呼叫；沒有 Zod、AbortSignal。新前端使用同源 API、回應驗證、取消、序號防過期資料。 |
| types/place.ts | B/C | 有大量分類、條件、來源、社群與評分型別；多欄位缺乏 runtime 驗證、未知綜合分數必須數值。改以 shared/model.ts 統一 Zod／TS 型別，證據欄位 nullable。未提前宣稱後續模型完整。 |
| server/geminiClient.ts | D（核心） | GEMINI_API_KEY 的生成 SDK；新版本完全沒有此核心依賴。 |
| server/services/searchOrchestrator.ts | C | 快取、多 Provider 與二輪補搜；頂層 Promise.all、AI 補搜、Demo 路徑、生成資料加工。全部重新設計；Phase 1 一次受限地理搜尋，漸進式協調與完整 Candidate Pool 待 Phase 2。 |
| server/services/locationResolver.ts | C | 寫死大量地標／城市座標（台北等是特定地標中心）、多 HTTP fallback 和 AI 解析，limit=1 消歧不足。改用 Photon 真實來源回傳選項，座標搜尋與 GPS 不要求任何金鑰。 |
| server/services/queryGenerator.ts | B/C | 國家平台與多語言查詢字串已存在，並不等於網站真的搜尋成功；語言／國家覆蓋有限。保留未來設計概念，Phase 4 才實作當地語言網頁探索。 |
| server/providers/types.ts | C | Adapter 僅 id/name/isConfigured/search；沒有完整 healthCheck/fetchDetails/normalize/validate 等契約。完整 Adapter Phase 2。 |
| server/providers/localProvider.ts | C | Photon 16 個查詢、Wiki／Overpass、35 km 範圍；名稱猜分類、非連鎖直接 LOCAL_GEMS、逾時或空回應可能仍 success。重寫為一次半徑3km有類型條件的 Photon nearby，失敗才嘗試 Overpass；無私房推定。 |
| server/providers/googleProvider.ts | B/D（核心） | Google Places 官方查詢是真的，但要 GOOGLE_MAPS_API_KEY，私房推定仍不可靠。Phase 1 不接入，也不要求金鑰。一般 Google Maps 導航 URL 保留。 |
| server/providers/webSearchProvider.ts | C | Gemini + Google grounding，要求 AI 回 JSON，名稱／來源匹配不等於實際頁面逐筆取證。改造留 Phase 4。 |
| server/providers/socialProvider.ts | C | 依賴 Gemini，AI 討論摘要可能建立沒有 URL 的 verifiedMatch 來源。核心不沿用；Phase 5 才加入可追溯社群。 |
| server/providers/demoFallbackData.ts | D（正式） | 人工範例地點；原版可手動開啟 Demo。新正式搜尋沒有 Demo、隨機資料或填滿筆數。測試 fixture 只在 tests 內，絕不輸入正式搜尋。 |
| utils/scoring.ts | C/D | 無證據仍使用54／50／58分等固定值，最低15分；不是可靠評分。Phase 1 全部 null；Phase 5 重建評分。 |
| utils/geo.ts | A/B | Haversine 直線距離與 Google Maps 網址合理；新共用工具保留演算法，輸入需先驗證，導航不用金鑰。 |
| .env.example、README.md | C | 原 README 要求 Gemini key；新 README 無金鑰、記錄端點政策及本機限制。 |
| vite.config.ts、tsconfig.json | B | 原 AI Studio HMR 環境假設與 permissive 型別配置；新 strict 型別，保留 Vite／React／Tailwind。 |
| index.html | B | 原外部字型、unpkg Leaflet CSS、AI meta；新打包 Leaflet CSS，不依赖外部 CSS 成功才能顯示地圖，改繁中地點探索 meta。 |
| metadata.json、.gitignore | B | AI Studio 容器描述與忽略規則；新本機版本獨立版本紀錄，忽略環境密鑰／快取／建置／測試輸出。 |

## 首次搜尋黑屏調查

靜態確認的故障路徑：原 API 回應沒有 runtime validation，App 直接把資料交給卡片／地圖；InteractiveMap 使用 `L.marker([latitude, longitude])`，並對 `rating !== null` 資料直接 `.toFixed(1)`，undefined 或錯誤座標可拋渲染／effect 錯誤；原 createRoot 沒有 ErrorBoundary，React 未捕捉例外可能移除整個畫面。原搜尋也沒有取消或請求序號，過期回應可能覆蓋新的中心。首次地圖初始化與 effect 直接耦合外部結果。

**限制：沒有原版問題的瀏覽器錯誤堆疊，未證實上述哪一條是原使用者首次黑屏的唯一根因；不把推測寫成已重現。** 新版本在 API 與前端雙層驗證、獨立地圖 boundary、StrictMode 首次 effect 清理、取消與序號保護下測試首次真實搜尋及錯誤資料。實測 Overpass 504 時顯示錯誤與地圖，未黑屏；後改用合法的 Photon 附近類型查詢為 Phase 1 主路徑。

## 不把畫面當成已完成

Phase 1 不宣稱完成全網文章、評論、社群、熱門、私房、綜合評分、用餐時段、價格、深入搜尋、完整多語言查詢規劃、漸進式擴張、完整診斷或全面去重。基本地理類型／距離篩選有實際運算；其他功能標為後續階段。所有原始功能均保存在原始目錄以利後續逐項恢復。
