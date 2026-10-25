# 瀏覽器故障測試 fixture

`longtan-food-response.json` 是 2026-10-12 實際公開來源測試中，龍潭大池美食模式的一份完整 API 回應，從本機 `docs/PHASE2-BASELINE.json` 抽出，未修改其地點或證據。

僅由 `tests/e2e/core-simulated.spec.ts` 模擬 API／圖磚失敗時使用，不會載入正式搜尋或作為備援資料。其餘大量歷史搜尋回應、探測紀錄與截圖留在本機，不納入 Git。
