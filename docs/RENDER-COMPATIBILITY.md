# Render 部署相容性修正

測試日期：2026-10-25。基準提交 `fdc7137acb86a70833b0d2dac3bbf40eacaffdef`，版本維持 `v0.3.0-public-web`／Phase 2。只修改啟動與依賴設定，搜尋演算法、Provider、共用模型、React UI均未修改。

## 變更

- `server/index.ts` 保留 `--production`、Express提供 `dist/` 與SPA首頁回退；正式模式監聽 `0.0.0.0`，開發模式維持 `127.0.0.1`。兩者使用 `process.env.PORT`，未設定時為3000。
- Vite改在開發分支內動態載入，正式程序不需要安裝Vite。
- `tsx@4.21.0` 從開發依賴移至正式依賴，支援 `npm ci --omit=dev` 後啟動；套件版本不變。
- 新增npm鎖定檔以使用 `npm ci`；同步原有pnpm鎖定檔的tsx分類，保留pnpm使用方式。Node支援範圍明確設定為 `>=22.12.0 <25`。
- 新增 `npm run test:deployment` 驗證實際npm啟動程序，未建立另一套測試版伺服器；沒有新增產品功能。

## 測試結果

環境：Windows、Node.js `v24.22.0`。本機測試不等於Render Linux及公開HTTPS已完成部署。

| 檢查 | 結果 |
| --- | --- |
| TypeScript `tsc --noEmit` | 通過（由 `npm run build` 執行） |
| `npm run build` | 通過，Vite產生 `dist/index.html` 及JS／CSS |
| `npm test` | 4個檔案、34項既有單元測試通過 |
| `npm run test:deployment -- --dev` | 通過，實際 `npm run dev` 使用 `127.0.0.1:13002` |
| `npm ci --omit=dev` | 通過；確認tsx存在，Vite與TypeScript無法解析，確實未安裝 |
| `npm run test:deployment -- --live` | 通過，實際 `npm run start` 使用 `0.0.0.0:13001` |
| 正式socket位址 | `Get-NetTCPConnection` 確認 `0.0.0.0:13001` |
| `GET /api/health` | HTTP200，精確比對JSON版本、Phase2、雙引擎及免金鑰狀態 |
| 正式首頁／前端JS | HTML及同源JavaScript皆HTTP200，未注入Vite開發client |
| `/api/resolve`、`/api/search` 驗證 | 無效輸入HTTP400／JSON；不存在的API仍404／JSON，未被SPA回退吞掉 |
| 真實 `POST /api/resolve` | 台北101解析至TW公開來源座標 |
| 真實 `POST /api/search` 美食 | HTTP200、34筆；全部美食、距離排序、最多50筆、無虛構評分 |
| 真實 `POST /api/search` 景點 | HTTP200、50筆；全部景點、距離排序、最多50筆、無虛構評分 |
| Linux套件鎖定項目 | npm鎖定檔包含Rollup、Lightning CSS及兩版本esbuild的Linux x64選配套件，未以此冒充Linux執行驗證 |

健康回應：

```json
{"ok":true,"version":"0.3.0-public-web","phase":2,"apiKeysRequired":false,"engines":["food","attraction"]}
```

真實HTTP與單元模擬分開：本次Overpass及部分臺灣官方來源失敗／受阻，Wikipedia、Wikivoyage及Wikidata等來源繼續返回結果；SearXNG與地方文章未配置時仍為skipped。沒有調整來源、重試、搜尋半徑或評分邏輯來配合部署測試，也不保證每次固定34／50筆。

## Render設定

| 欄位 | 值 |
| --- | --- |
| Service Type | Web Service |
| Runtime | Node |
| Repository | `https://github.com/h8297leo/SiteBite.git` |
| Branch | `main` |
| Root Directory | 留空；Repository根目錄即應用程式 |
| Build Command | `npm ci --include=dev && npm run build` |
| Start Command | `npm run start` |
| Health Check Path | `/api/health` |
| Environment | `NODE_ENV=production` |
| Node版本 | 建議24.x；由package.json限制支援範圍。若另設NODE_VERSION，應符合該範圍 |
| PORT | 使用Render自動提供的值，無須自行固定3000 |

不要省略建置時的 `--include=dev`：正式環境也需要先使用TypeScript與Vite完成建置；執行時才可以僅保留正式依賴。前端 `fetch('/api/...')` 與Express靜態檔共用同一網域，不需建立獨立前端服務或新增CORS。

Render於邊緣處理HTTPS，轉送HTTP至應用程式的PORT；不需在Express放入TLS私鑰。使用者將自行建立Render Web Service，再提供公開網址驗證。本次未建立Render服務、未宣稱外部HTTPS已上線。

`.gitignore` 已實測排除 `.env`、`.env.production`、金鑰、credentials、快取、node_modules、dist與測試產物；保留不含秘密的 `.env.example`。

官方設定依據：[Web Services](https://render.com/docs/web-services)、[Health Checks](https://render.com/docs/health-checks)、[Node.js版本](https://render.com/docs/node-version)。Markdown端點不受目前瀏覽工具支援，已改讀取官方HTML內容。
