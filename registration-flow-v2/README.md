# 報名流程 V2：隔離候選與 50／100／150 筆模擬

狀態：**候選；未部署、未啟用，不能直接發布正式環境。**

前端基準：`d35d960e08d207a9b06a088d5de990a2f8201a1f`。
個人／家庭規則使用 #730 中 2026-11-05 擷取的正式來源；此候選用共用資料庫租約與操作紀錄取代程序內排程，保留 handler 的帳號、資格、截止、容量、配置確認與原操作憑證。`tests/captured-family-source.json` 內每個來源逐一核對 SHA-256。

取消／自動遞補測試使用儲存庫的 `qr-checkin/backend/overlays/roster-service.js`；**這不是重新讀取的當前正式 roster 來源**。本輪不能據此宣稱所有正式寫入入口已完成整合。

## 行為

1. 同時送入的報名先各自寫入私有操作文件；受理不代表取得名額，也不預扣名額。
2. 每個房間共用資料庫租約；五個獨立 service 物件只能有一個有效處理者。
3. 原規則在實際分配時重新執行。房間、帳號、截止時間、容量等保護沒有刪除。
4. 報名資料、正備取計數與完成標記在同一筆交易提交。租約換手會使舊處理者失去寫入資格。
5. 同一使用者／房間／operationId 重送共用同一份紀錄；改變原內容明確拒絕。
6. 工作者中斷由文件觸發器與定期 sweep 接手。受理時間與穩定文件排序決定處理順序；**不保證不同手機點擊先後的全域 FIFO**。
7. 前端僅在明確房間 allowlist 啟用 V2。本人的正／備取期望取自已讀取的畫面資料，後端仍拒絕配置變動；多位孩子保留預查。未定義 allowlist 時沿用舊服務。
8. 查詢逾時重用尚未結束的網路請求，避免疊加。65 秒後可離開提示並保留原操作；查詢為空不宣告失敗。
9. 私有操作狀態包括 queued、running、completed、rejected、attention。只有明確業務拒絕標成 rejected；未知錯誤停止無限自動重試並保留 attention。
10. 玩家 V2 API 接受本人／家庭報名，以及玩家取消線上報名的請求。取消交易核對本人或監護人身分，並依既有設定自動遞補。玩家 API 不接受管理員取消、手動遞補或設定變更。取消前端目前仍走既有服務，待接入操作結果恢復後才可切換。

## 測試與證據

`evidence/waves.json`：50、100、150 筆同時開始受理，各跑兩輪；每輪分名額足夠及名額不足，共 12 波、1,200 筆。每波核對私有／公開計數、有效報名文件、唯一性、操作完成與拒絕。

`evidence/frontend-waves.json`：另以三種人數執行實際前端 `joinTournamentAsPlayer`、本人選擇器、`familyRegistration` 路由和進度控制器，再接真 Firestore Emulator 與擷取的後端 handler，共 300 筆。這些是無 DOM 的獨立 JS context，**不是實體瀏覽器或手機測試**。前端結果經讀回目前有效報名確認，並稽核本地待確認紀錄清空。

工作者模擬是同一 Node 程序中的五個獨立 service 物件，共用真正的本機 Firestore Emulator；不是五台實體 Cloud Run。測試使用合成 Auth，沒有驗證正式 Auth／App Check、行動網路、跨區延遲或正式觸發器／排程器交付。

前端模擬完成交易後會主動讀回，將測試時鐘前移 4 秒以越過手動查詢限頻；報告時間是這個隔離測試的實際牆鐘時間，不代表正式站自動輪詢的延遲上限。

本機重跑（固定 demo project 與 loopback；harness 不符即拒絕執行）：

```sh
NODE_PATH=/path/to/test-deps/node_modules GCLOUD_PROJECT=demo-bxh-registration-v2 \
  /path/to/test-deps/node_modules/.bin/firebase emulators:exec --only firestore \
  --project demo-bxh-registration-v2 --config registration-flow-v2/emulator.json \
  'node --test registration-flow-v2/tests/recovery.test.cjs && node registration-flow-v2/tests/frontend-waves.cjs && node registration-flow-v2/tests/waves.cjs'
node --test tests/registration-feedback.test.cjs tests/family-roster-checkin.test.cjs tests/community-quick-registration-cloud.test.cjs tests/public-pages-artifact.test.cjs
node scripts/verify-production-frontend.cjs
```

CI 安裝固定 firebase-tools@13.35.1、firebase-admin@14.4.0、firebase-functions@7.3.2，Node 22、Java 17。本機 Node 版本另記於 `evidence/manifest.json`。

## 正式發布阻擋項目

- 重新擷取並對照當前 family、roster、遞補、管理及其他會寫名額的正式來源／設定。不能只以 #730 的擷取或本地測試當成當前線上版本證明。
- 將**所有**相關名額寫入入口接至同一協調規則，包括舊版客戶端與直接 Firestore 管理寫入。這份候選目前只提供新 API 與 backend bindings factory，以及本人／家庭報名的前端 allowlist 接線；既有取消、手動遞補等前端仍未切換。
- 先部署並驗證新函式、文件觸發器、恢復排程與 indexes，確認自動交付及中斷接手；`backend/bindings.cjs` 沒有加入正式 entrypoint。
- 讀取完整當前 Rules，確認私有 queue 文件不能被客戶端讀寫。`queue-rules.fragment` 只供整合審查，不能單獨部署；新增 deny 不能推翻其他重疊 allow。
- 檢查 My Events 操作憑證、分桶、現場備取、抽籤與團體模式的相容性。抽籤／團體不在本候選的可啟用範圍。
- 正式 Auth、App Check、實體瀏覽器及小範圍活動驗收，並準備來源／設定 readback 與 rollback。

上述條件未完成前，server enabled 預設 false，前端 allowlist 必須保持未定義／空。此模擬不解釋 BXH-ANYX2T 當時的確切失敗原因，該事件仍需歷史後端紀錄。
