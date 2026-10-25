# SiteBite 開發規劃與實作狀態

更新：2026-10-25。本文件區分可執行程式、需要配置的來源與未完成項目；建置通過不代表即時網站搜尋品質已驗收。

## 核心定位與原則

全球即時公開網路美食與景點探索引擎：輸入國家、城市、地區、地標、地址、經緯度或 GPS，解析搜尋中心及意圖，搜尋當地公開網頁、文章與合法討論，抽取個別場所，驗證位置、分類與去重，依距離顯示於列表及地圖。

1. 不建立永久店家或景點資料庫。
2. 不預先建立城市店家清單。
3. 不寫死特定地點、店家或測試結果。
4. 不要求 Google 或其他商業搜尋 API Key。
5. 搜尋時取得公開網路資訊，地理資料不冒充完整網頁搜尋。
6. 允許有期限及容量上限的短期快取，不轉為永久 POI 資料庫。
7. 美食與景點獨立搜尋、查詢及驗證。
8. 依地區產生當地語言及英文查詢，不捏造翻譯或別名。
9. 最多 50 筆有效場所，每次顯示 10 筆。
10. 預設距離由近到遠，不預設使用者距離上限；後端仍有時間、半徑及請求預算。
11. 保留 SiteBite、Radar、深色介面、模式切換、GPS、地圖、導航、來源證據與手機／電腦版。
12. 不虛構店家、景點、地址、座標、營業時間、評分或評論。
13. 不繞過登入、年齡確認、CAPTCHA、robots、授權或存取限制。
14. 不足 50 筆顯示實際數量，不以假資料補足。
15. 保留現有 GitHub 與 Render 同網域前後端部署，不另建服務。

## Phase 2.1：既有可靠性基礎

保留來源錯誤隔離、超時、429 退避、短期快取、取消、請求預算、候選合併、前端過期回應保護與診斷。這些機制不能單獨解決來源覆蓋率，不等於搜尋核心完成。

## Phase 2.1R：搜尋核心重構（本次優先交付）

### 實際流程

輸入 → 分離位置與分類／餐期意圖 → 地點解析 → 多語言查詢 → 公開文章／論壇與輔助地理來源 → 安全讀取正文 → 多場所抽取 → 暫存候選 → 地理交叉驗證 → 類別／相關性 → 合併來源 → 距離排序 → 最多 50 筆 → 既有列表及地圖。

搜尋中心不直接注入推薦。地址、行政區及道路不是店家；夜市、美食街、商圈是場所集合，不能冒充個別小吃攤。

### 來源能力盤點

| 來源 | 實作狀態及限制 |
| --- | --- |
| GDELT DOC 2.0 | 預設免金鑰近期文章索引 Adapter。使用可靠英文地名查詢英譯新聞，再讀取允許的公開頁面；不是全網搜尋，不保證各地餐飲覆蓋。缺少可靠英文地名明示跳過。 |
| SearXNG | 可執行，但需自架或明確允許自動查詢的實例、JSON 輸出及 SEARXNG_AUTOMATION_ALLOWED=true。403、429、驗證頁及錯誤格式標示失敗，不擅自使用任意公開實例。 |
| PTT | 台灣 Food／Tai-travel 公開 HTML 搜尋與讀取流程已實作；每次依 robots 及存取結果決定是否讀取，不做登入、年齡確認或非公開 API。本次沒有實測即時搜尋可用性，不代表已取得網站授權。 |
| 已配置地方文章 | 保留 WEB_SOURCE_URLS 接口，明確設定公開文章網址及來源權限，抽取後進入共同驗證。沒有預載城市店家清單。 |
| 台灣觀光／紐約餐飲開放資料 | 保留既有 Adapter，依地區及端點條件執行；端點失效如實記錄，不能宣稱全球地方網站已整合。 |
| OSM／Overpass | 保留場所、標籤及位置輔助，不當作文章搜尋。 |
| Wikidata | 保留別名、實體、座標及地理屬性輔助。 |
| Wikipedia／Wikivoyage | 保留知名景點、旅遊文章及部分餐飲輔助，不宣稱為主要美食搜尋。 |
| DuckDuckGo／Google／Bing | 尚未直接整合自動查詢，不使用未確認允許的爬取端點。 |

### 本次已實作的後端能力

- 公開搜尋層與獨立論壇流程；搜尋連結／摘要與已讀取正文場所分開保存。
- 美食類型、餐期及景點分類參與後端查詢；當地語言與英文查詢有數量上限。
- JSON-LD、microdata、具名標題與地址段落、明確店名／攤名欄位的多場所抽取。一篇文章可產生多筆候選，料理或榜單標題不直接變成店名。
- 區分店家、攤販、夜市、美食街、商圈；只有類別及位置可驗證的個別場所進入結果。
- 官方座標、既有地理實體、不同網域一致名稱／完整地址／座標、Photon 及受限 Nominatim 地址解析的驗證鏈。沒有 OSM POI 的場所仍可透過其他可靠證據驗證。
- verified／pending／rejected 狀態及理由；沒有位置或分店不明會待驗證，不判定場所不存在。
- 搜尋相關性與人氣分開；類別不符、地址、場所集合及缺少餐期證據不因距離近而入選。
- 公開與地理來源並行隔離；先收集再驗證，不以 50 筆一般 POI 取代公開來源參與。
- 保留三輪漸進搜尋、時間與請求預算、取消、短期快取及既有地理去重。
- 診斷區分查詢、搜尋網頁、可讀文章、抽取候選、已驗證／待驗證／排除、相關性、合併與最終數量；未配置、無文章及來源失敗不同。
- 後端安全擷取：URL、DNS、重新導向、SSRF 防護、robots、速率、大小、超時、取消及格式驗證。受限論壇即使由一般搜尋發現，也只保留連結，除非另有明確合法內容授權。

### 限制與待驗收

- 本次僅做編譯、建置、啟動／健康檢查及相關單元測試。來源流程單元測試使用模擬 HTTP；沒有宣稱真實網站搜尋已驗收。使用者在 Render 測試實際品質。
- 新聞索引覆蓋有限。完整通用搜尋仍需獲准的 SearXNG 等服務；沒有商業金鑰要求，但不保證免配置即可搜尋全球全部網站。
- 正文抽取採保守規則；缺少結構、具名欄位或位置證據的自然語言討論可能無法抽出。不使用 LLM 猜店家。
- 跨語言分店、結構化資料引用圖及複雜地址待深化；不同網域一致是佐證，不是絕對獨立出版者保證。
- 每次搜尋給予可配置、有上限的候選額外地理解析額度，避免大量呼叫公共 Nominatim；其他候選明示待驗證。官方、既有地理參照及一致來源驗證不受這個額度限制。
- 餐期由明示 breakfast 等標籤或可解析營業時間支持，不表示菜單供應或目前營業；不能解析就不補猜。
- 夜景／秘境只接受來源明示描述；秘境描述不等於低人氣或私房指數證據。

## Phase 2.2：美食與景點分類深化

本次已接入分類模型、選單、後端查詢與保守證據篩選；全球分類覆蓋及細緻語意待本階段改善。選單存在不表示每類都有資料。

### 美食雙軸

用餐時段：全部、早餐、早午餐、午餐、下午茶、晚餐、宵夜、24 小時。

店家類型：全部、餐廳、小吃、咖啡廳、甜點、麵包烘焙、飲料茶飲、速食、自助餐、酒吧餐酒館。

可交叉搜尋：早餐＋小吃、下午茶＋咖啡廳、下午茶＋甜點、宵夜＋小吃、晚餐＋餐廳。分類必須驅動後端查詢，前端篩選不能取代搜尋。深化各國餐飲類型對應、營業日、跨午夜時段、菜單與餐期證據；無證據不推定。

### 景點分類

全部景點、自然景觀、公園步道、歷史古蹟、文化藝術、博物館、展覽活動、地標建築、拍照景點、親子景點、商圈老街、夜景景點、宗教景點、秘境探索。

維持獨立搜尋，深化分類、多語言與多標籤證據；沒有證據不標秘境、親子或夜景。

## Phase 2.3：全球論壇與社群整合

共通 Forum Provider 基礎已建立。搜尋、正文、具名場所與驗證共用流程，各來源依合法能力逐步接入；無內容權限時僅保存合法搜尋連結／摘要，不冒充全文。

| 來源 | 目前狀態與後續 |
| --- | --- |
| PTT | 條件式公開 HTML 流程，待實際搜尋與版型驗收。 |
| Dcard | 可由已配置 SearXNG 發現連結；未實作內容 API，需合法授權。 |
| 5ちゃんねる | 尚未整合自動內容擷取，先確認政策及合法接口。 |
| 食べログ | 僅搜尋連結，未抓星級或評論；內容需授權。 |
| 日本地方部落格與旅遊站 | 共通公開頁面解析可執行，未逐站整合，需逐站確認政策／版型。 |
| Naver Blog／Cafe | 搜尋連結架構，未整合授權內容 API，不登入討論。 |
| LIHKG／香港地方論壇 | 內容需授權，未使用未授權 API；地方餐飲旅遊來源逐步評估。 |
| Reddit | 合法搜尋連結，未實作授權 Data API。 |
| Tripadvisor | 僅合法搜尋連結，不擷取受限評論。 |
| Lonely Planet | 僅連結；未宣稱舊論壇仍可取得，需確認現存內容與權限。 |
| Threads／Instagram／Facebook | 保留連結發現接口，內容需授權，不繞過登入或反自動化。 |

未配置合法 SearXNG 時，多數上述連結發現不會執行；診斷明示跳過。設定網域不等於取得授權。其他國家地方網站、旅遊網站、地方論壇及合法公開社群逐步擴充，未完成的不標完成。

## Phase 2.4：搜尋品質優化

- 多來源名稱與別名比對、跨語言名稱、同名不同店、不同分店辨識。
- 地址、門牌、樓層及矛盾位置證據驗證。
- 全球多語言查詢及用餐時段證據。
- 論壇自由文字中的具體店家與料理／城市提及區分。
- 文章清單、結構化資料、場所段落抽取準確性。
- 搜尋效能、相關性、來源覆蓋率與可靠性。
- 依診斷持續改善，不以固定城市名單或永久資料庫替代即時探索。

## Phase 3：推薦與私房景點（暫不開發）

核心穩定後再開發公開評論整合、跨平台評分、討論熱度、熱門程度、在地特色、私房景點與推薦可信度。原始評分、評論、討論及來源證據分開保存；沒有證據不得產生分數。

## 官方技術參考與部署約束

- [SearXNG](https://github.com/searxng/searxng)：搜尋聚合，使用可選 HTTP Adapter；未隨網站部署搜尋服務。
- [Crawl4AI](https://github.com/unclecode/crawl4ai)：網頁擷取，僅架構參考；未整合 Python／瀏覽器服務，避免增加 Render Free 資源需求。
- [Trafilatura](https://github.com/adbar/trafilatura)：正文抽取，僅職責參考；目前使用既有 TypeScript／Cheerio，未宣稱安裝此套件。
- [Nominatim](https://github.com/osm-search/Nominatim)／[公開服務政策](https://operations.osmfoundation.org/policies/nominatim/)：少量使用者觸發驗證，識別 User-Agent、快取、全站速率控制；不作城市批次地理編碼。
- [Overpass](https://wiki.openstreetmap.org/wiki/Overpass_API)：OSM 查詢及地理輔助，不是文章擷取器。
- [GDELT DOC 2.0](https://blog.gdeltproject.org/gdelt-doc-2-0-api-debuts/)：近期英譯新聞索引，非全網搜尋。

新增可選設定詳見 .env.example：GDELT_ENABLED、PTT_PUBLIC_SEARCH_ENABLED 可關閉來源；NOMINATIM_URL 可換成合規公開或自架端點；FORUM_AUTHORIZED_DOMAINS 僅填已獲內容擷取許可的精確網域，仍遵守 robots、登入及 HTTP 限制。SearXNG 另需獲准實例，現有 Render 不內建；不強制商業 API Key。

保留既有 GitHub main、Node／Express --production、Render PORT／0.0.0.0、Express dist 靜態檔及同網域 API。不另建服務，不提交 .env、金鑰、快取或搜尋紀錄。

## 最低驗證與交付

只做 TypeScript、npm run build、npm run start、/api/health 及修改核心的必要單元測試；不大量呼叫公開來源、不建立測試資料庫、不跑大型跨國或瀏覽器 E2E。實際功能由使用者在 Render 測試；沒有部署證據不宣稱 Render 已成功更新。

## Phase 2.1R-P0：搜尋核心修復（本次實作）

本節合併於原規劃，針對餐期未知、Overpass 故障及驗證額度修正；取代前文「缺少餐期證據便排除」及固定兩個額外驗證機會的舊行為。沒有覆蓋既有後續規劃。

| 工作 | 實際修改及狀態 | 可驗收標準 |
| --- | --- | --- |
| P0-1 餐飲查詢 | 已實作。Overpass 只依地理範圍及餐飲類別查詢，不要求 opening_hours 或 breakfast/lunch/dinner 標籤。 | Mock OSM 有／無營業時間皆取得；錯誤類別不混入。 |
| P0-2 餐期三態 | 已實作 shared/meals.ts。confirmed、unknown、excluded；未知或衝突保留，只有明確不符才排除，仍依距離排序。 | 確認、未知、不符、跨午夜、複雜時段未知、來源衝突及候選合併保留證據。 |
| P0-3 Overpass 故障 | 已實作 POST form body、獨立端點嘗試、可辨識錯誤、Retry-After／冷卻、下一公開端點備援。POST 不保證能解決外部故障。 | Mock 主端點成功、備援成功、雙端點失敗、403／429、超時、JSON／schema、語法、預算及取消。 |
| P0-4 地理驗證 | 已實作驗證前按名稱／地址去重、官方及座標／完整地址／多網域優先、小批次驗證、同候選不重複呼叫。額度可配置。 | 多場所文章、同店多來源、不同分店、可靠座標、不完整地址、座標衝突及額度不足均有明確狀態。 |
| P0-5 協調器 | 已實作探索／驗證請求預留、穩定文章結果重用、故障冷卻跳過、優先待驗證佇列、無新增資料提前停止。 | Mock 單來源／全來源故障、文章無位置、慢文章與 50 POI 並行、時間耗盡、取消及無新增結果。 |
| P0-6 診斷 | 已實作來源端點錯誤分類、實際加入池、驗證前去重、逐候選待驗證／排除原因與餐期不符。 | 六個文章場所變成零個結果時，可看到每個名稱及具體原因，而非只顯示格式錯誤。 |

### 餐期證據與限制

每個場所保留原始 mealTags、OSM 標籤、營業時間；mealEvidence 另存餐期狀態、原文、來源 URL、證據類型與驗證狀態。合併來源時不覆蓋彼此時段；正反證據衝突時為 unknown，顯示「餐期來源資訊衝突，尚待確認」。未知顯示「用餐時段未確認」。移除百科、旅遊及餐飲目錄中依場所類別自動產生午餐／晚餐／下午茶的舊假設。

只保守解析簡單週時段、明示 meal=yes/no 及來源原始餐期資訊；複雜節假日、季節、日期或文字規則保持未知。這不是完整 OSM opening_hours evaluator，也不是菜單供應或目前營業保證。

### 搜尋內資源

- HTTP 總額度維持 30，探索來源最多使用前 22 次，剩餘資源留給地理驗證；快取命中不消耗 HTTP 次數。
- GEOCODE_CANDIDATE_LIMIT 預設 6，上限 12；是不同候選的額外驗證機會，不是無限制 API 請求。0 可關閉額外地理解析。
- 公共 Nominatim 每次搜尋最多兩次備援地址查詢，仍使用既有全站單程序限速、識別 User-Agent、短期快取及目的地檢查。不做批次城市地理編碼。多實例部署前必須有跨實例限速或使用合規自架服務。
- WEB_PAGE_LIMIT 預設 8，上限 16，作為各公開來源共用的正文額度；會依允許讀取、官方網域優先、剩餘時間／請求資源提前停止，不再固定前三篇。
- SEARCH_TIME_BUDGET_MS 預設及上限 62000，最低 1000；保留 Provider timeout、取消、三輪上限及無增益停止。這些選項不包含金鑰或固定場所資料。
- 備援是其他合規公開來源，不使用代理輪換、改身分或繞過 403／驗證／robots。

## Phase 2.1R-P1：公開網頁搜尋升級（技術準備及部分實作）

### 正式環境來源能力盤點

本次沒有執行第三方真實搜尋或讀取 Render 私密設定。以下區分程式能力與正式環境可用性；部署後應以 Render 搜尋診斷確認當時狀態，不把 Adapter 或 Mock 通過當成網站已可存取。

| 來源層級 | 狀態 | 對品質的限制 |
| --- | --- | --- |
| 通用網頁：SearXNG | 已實作，但需要獲准 HTTPS 實例、JSON 輸出及明確啟用。Render 是否配置未確認。 | 未配置就沒有通用網頁搜尋；不得用百科補上後宣稱已完成。 |
| 新聞：GDELT | 已實作免金鑰輔助索引，未做本次真實搜尋驗收。 | 近期新聞及可靠英文地名限制，不代表全球美食網站覆蓋。 |
| 論壇：PTT | 公開 HTML 流程已實作；Food／Tai-travel 依模式，先中心關鍵字，空結果才以城市＋分類補充，最多兩個查詢。 | robots、封鎖、年齡／登入限制、看板覆蓋與關鍵字品質仍需實際驗收，不繞過。 |
| Dcard／Reddit／Naver／LIHKG 等 | 只有合法搜尋連結發現基礎，全文需授權，未完成內容整合。 | 未配置獲准搜尋服務時連結發現也不執行；加上授權網域設定不等於取得授權。 |
| 地方公開文章 | 共通安全擷取及抽取已實作；需配置合法文章／來源。 | 未逐國逐站完成整合，不能宣稱全球地方餐飲來源已接入。 |
| 地理：OSM／Overpass | 既有真實 POI／位置輔助保留；使用者已回報端點連線與超時故障，修正後仍待驗收。 | 外部故障可能仍使結果不足；不能保證 POST 或備援必然成功。 |
| 百科／旅遊：Wikipedia／Wikidata／Wikivoyage | 保留分類、座標、別名及部分具名列表。 | 不是完整美食搜尋，不以增加查詢次數充當通用搜尋完成。 |
| 官方餐飲／觀光開放資料 | 保留既有地區 Adapter，依實際 HTTP 與格式呈現成功／失敗。 | 端點拒絕或資料涵蓋不足仍存在，不建立永久店家庫補足。 |

### 已實作與待完成

已實作：跨來源共用正文額度與安全擷取、Schema.org @graph 的 address／geo 引用、location 內的結構化位置、營業日資訊保留、HTML 清單的具名店家＋地址抽取、多場所段落、共通論壇介面。沒有增加 Python、瀏覽器爬蟲或大型 DOM 依賴。

部分完成：正文抽取仍為 Cheerio 保守規則，未引入完整 Mozilla Readability／Trafilatura，不能保證自由文字討論的抽取率。SearXNG 服務部署、授權論壇全文及各國網站專屬解析尚未完成；本次不另建 Render 服務。

可驗收標準：Mock 搜尋結果超過三篇時，依資源處理更多允許的正文；來源受限時如實保留連結；同篇文章可抽取多場所；結構化位置與地址經地理驗證後才入選；未配置來源明示未配置。真正公開搜尋覆蓋率與 PTT 即時可用性由使用者在 Render 驗收。

## 成熟開源技術對照（機制 → 對應程式 → 驗證）

以下是機制借鑑與既有 HTTP 介面使用，不表示安裝了對應函式庫；本次沒有新增套件。

| 參考及官方文件 | 實際機制 | SiteBite 對應位置 | 狀態／限制及驗證 |
| --- | --- | --- | --- |
| [Overpass API](https://wiki.openstreetmap.org/wiki/Overpass_API) | POST 將 QL 置於 data form body；類別與 around 查詢 | engines.ts、providers.ts | 已實作；Mock 確認 POST、無餐期門檻、類別隔離；外部端點品質待驗收。 |
| [OSM opening_hours](https://wiki.openstreetmap.org/wiki/Key:opening_hours) | 保留原始時段、週選擇器及跨午夜區間；缺失不是否定 | shared/meals.ts、searchRelevance.ts、shared/model.ts | 部分實作保守解析；未支援完整節假日／日期語法，保持未知。 |
| [got retry](https://github.com/sindresorhus/got/blob/main/documentation/7-retry.md)／[Cockatiel](https://github.com/connor4312/cockatiel) | 可重試故障分類、Retry-After、冷卻後再探測、獨立 fallback、取消與時限 | http.ts、providers.ts、searchOrchestrator.ts | 已實作相應有限控制；未安裝套件、不是完整自適應熔斷庫；Mock 覆蓋 DNS、HTTP、格式、取消及備援。 |
| [Photon](https://github.com/komoot/photon) | 地點查詢、中心偏向、國家／名稱／地址／候選匹配 | locationResolver.ts、placeEntityResolver.ts | 保留並改善候選前處理；相同品牌多分店不憑中心距離直接認定。 |
| [Nominatim](https://github.com/osm-search/Nominatim)／[使用政策](https://operations.osmfoundation.org/policies/nominatim/) | 名稱／門牌／道路比對、國家約束、限速、識別、快取、可換端點 | placeEntityResolver.ts、secureWeb.ts | 已實作少量備援；公共服務每次最多兩次，仍需遵守全站政策；Mock 驗證，未做真實批量查詢。 |
| [OpenRefine clustering](https://openrefine.org/docs/technical-reference/clustering-in-depth) | 正規化後分組，分組不等於實體已驗證 | placeEntityResolver.ts、searchOrchestrator.ts | 部分借鑑 NFKC／標點／台臺正規化及名稱＋地址群組；不是 OpenRefine 完整 fingerprint 演算法或服務。 |
| [Pelias](https://github.com/pelias/pelias) | 多來源地理候選與結構化地址匹配 | placeEntityResolver.ts 後續規劃 | 尚未部署／整合 Pelias；現有多來源佐證不宣稱使用其引擎。 |
| [SearXNG API](https://docs.searxng.org/dev/search_api.html) | q／language／format=json、明確啟用與格式錯誤隔離 | queryGenerator.ts、webDiscovery.ts | HTTP Adapter 已實作，需額外配置合法服務；JSON 可能被禁用，未配置不可標成功。 |
| [Scrapy RetryMiddleware](https://docs.scrapy.org/en/latest/topics/downloader-middleware.html#module-scrapy.downloadermiddlewares.retry) | 將下載故障控制與正文處理分離，限制重試與請求資源 | http.ts、secureWeb.ts、webDiscovery.ts、forumDiscovery.ts | 部分機制借鑑，使用既有 TypeScript；沒有安裝 Scrapy、沒有大型爬蟲排程。 |
| [Mozilla Readability](https://github.com/mozilla/readability) | 正文／metadata 分離、可讀性門檻、輸出不等於可信場所 | webContentExtractor.ts、webDiscovery.ts | 部分借鑑，使用 Cheerio；未安裝 Readability，未處理完整語意正文評分，外部 HTML 不直接渲染。 |
| [Schema.org Restaurant](https://schema.org/Restaurant) | 個別 Restaurant、PostalAddress、GeoCoordinates、openingHoursSpecification 與圖譜引用 | webContentExtractor.ts、placeEntityResolver.ts | 已實作保守抽取及驗證；Mock 多場所、地址／座標 @id 引用，複雜 graph 仍有限制。 |
| [Trafilatura](https://github.com/adbar/trafilatura)／[Crawl4AI](https://github.com/unclecode/crawl4ai) | 正文抽取與下載／瀏覽器執行職責分離 | P1 正文後續評估 | 尚未引入，不宣稱整合；Render Free 資源與額外服務尚需評估。 |

## 後續階段的技術依據與驗收補充

| 階段 | 保留的工作 | 技術依據 | 可驗收標準 |
| --- | --- | --- | --- |
| Phase 2.2 分類深化 | 雙軸餐飲、景點、全球詞彙與營業日／餐期證據 | OSM 標籤、opening_hours、Schema.org FoodEstablishment／OpeningHoursSpecification | 類別影響後端查詢；未知可辨識，營業日／時段不憑空推定，兩模式不混合。 |
| Phase 2.3 全球論壇與社群 | PTT、Dcard、Reddit、日本、韓國、香港及旅遊討論 | SearXNG API、Scrapy 下載隔離原理及各站官方授權文件 | 每站提供合法能力狀態；連結／摘要／全文分開；可讀內容抽出具名場所並完成驗證，不宣稱未授權全文。 |
| Phase 2.4 搜尋品質與效能 | 分店、別名、地址、正文精度、相關性、資源與可靠性 | Photon／Nominatim、OpenRefine clustering、Pelias 多來源候選、Readability 正文概念 | 同名不同分店不誤併；跨來源證據保留；無位置不入選；資源有界並有逐候選診斷。 |
| Phase 3 評分／熱門／私房 | 核心穩定後才處理評分、熱度及推薦 | Schema.org Review／AggregateRating 的來源與原始尺度；依各平台官方接口及條款 | 無可靠原始來源不得產生分數；來源、時間、尺度、店家身份可追溯；不得以來源數直接冒充熱門。 |

以上是規劃及驗收標準，不代表後續功能已實作。本次不新增評分、人氣或私房功能。
