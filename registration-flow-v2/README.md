# 報名流程 V2：隔離候選與 50／100／150 筆模擬

狀態：**候選；未部署、未啟用，不能直接發布正式環境。**

前端基準：`d35d960e08d207a9b06a088d5de990a2f8201a1f`。
個人／家庭規則使用 #730 中 2026-11-05 擷取的正式來源，候選容量修正以 SHA-256 核對該來源後套用。此候選用共用資料庫租約與操作紀錄取代程序內排程，保留 handler 的帳號、資格、截止、容量、配置確認與原操作憑證。`tests/captured-family-source.json` 內每個來源逐一核對 SHA-256。

取消／自動遞補測試使用儲存庫的 `qr-checkin/backend/overlays/roster-service.js`；**這不是重新讀取的當前正式 roster 來源**。本輪不能據此宣稱所有正式寫入入口已完成整合。

## 行為

1. 同時送入的報名先各自寫入私有操作文件；受理不代表取得名額，也不預扣名額。
2. 每個房間共用資料庫租約；五個獨立 service 物件只能有一個有效處理者。
3. 原規則在實際分配時重新執行。房間、帳號、截止時間、容量等保護沒有刪除。
4. 報名資料、正備取計數與完成標記在同一筆交易提交。租約換手會使舊處理者失去寫入資格。
5. 同一使用者／房間／operationId 重送共用同一份紀錄；改變原內容明確拒絕。
6. 工作者中斷由文件觸發器與定期 sweep 接手。若原請求仍在排隊或處理中，背景事件會重新交付。受理時間與穩定文件排序決定處理順序；**不保證不同手機點擊先後的全域 FIFO**。
7. 前端僅在明確房間 allowlist 啟用 V2。在公開名單為空或社群房無上限時，本人的正／備取期望可取自已讀取的畫面資料。已有名單的有限額房間，以及多位孩子報名，會先向後端取得名額預查。後端仍拒絕配置變動。未定義 allowlist 時沿用舊服務。
8. 查詢逾時重用尚未結束的網路請求，避免疊加。65 秒後可離開提示並保留原操作；查詢為空不宣告失敗。
9. 私有操作狀態包括 queued、running、completed、rejected、attention。只有明確業務拒絕標成 rejected；未知錯誤停止無限自動重試並保留 attention。
10. 玩家 V2 API 接受本人／家庭報名，以及玩家取消線上報名的請求。取消交易核對本人或監護人身分，並依既有設定自動遞補。玩家 API 不接受管理員取消、手動遞補或設定變更。候選取消按鈕只對啟用名單中的個人賽送出 V2 取消。只有符合操作 ID 與選手的完成回執才能確認成功並刷新「我的賽程」；等待中暫停該房的取消資格。關閉新請求後仍可查詢原操作。正式環境與實體手機仍須驗收。

11. 管理端另用 `registrationRosterQueueV2` 接收取消、線上備取升正取、官方個人賽的線上降備取、現場手動升正取與現場批次新增，以及自動補位設定。送件時核對房間管理權限，實際寫入時由原服務重新核對。受理後使用同一個房間租約，交易完成才確認結果。房主管理頁和工作人員名單的線上遞補均接入候選路由。回執不含私有名單，畫面透過既有的房間或工作人員名單權限讀取最新資料。關閉入口後，已送出的操作仍可按原 ID 查回。

12. 有限額個人賽的線上報名與現場升正取在交易內共同計算已佔名額。現場參賽者佔用席位，線上正備取計數仍只計入線上報名。現場批次新增由房主或管理員送出，容量不足時整批拒絕，重送沿用原操作 ID。已有現場專用抽籤流程的房間保留專用權限及資料所有權。

## 測試與證據

`evidence/waves.json`：50、100、150 筆同時開始受理，各跑兩輪；每輪分名額足夠及名額不足，共 12 波、1,200 筆。每波核對私有／公開計數、有效報名文件、唯一性、操作完成與拒絕。

`evidence/frontend-waves.json`：另以三種人數執行實際前端 `joinTournamentAsPlayer`、本人選擇器、`familyRegistration` 路由和進度控制器，再接真 Firestore Emulator 與擷取的後端 handler，共 300 筆。這些是無 DOM 的獨立 JS context，**不是實體瀏覽器或手機測試**。前端結果經讀回目前有效報名確認，並稽核本地待確認紀錄清空。

`tests/start-320.cjs` 以 320 位選手和 12 台設定演練開賽。私有房帶 V2 所有權標記，名額佇列驗證所有權，晚報到使用儲存庫的 QR callable 處理器與 Firestore Emulator。核對兩次有效掃碼只留下兩筆稽核、重掃取回既有結果、公私名單修訂一致。抽籤後名單有異動時，舊對戰表不能開賽，重抽後開賽只寫入一次。抽籤與開賽仍由測試的伺服器寫入替代瀏覽器寫入，未驗證正式 Auth、App Check 或裁判畫面。CI 將報告收錄在隔離壓測產物。

`tests/ownership-rules.cjs` 在隔離 Firestore Emulator 先用 2026-11-04 的正式規則快照重現舊版寫入，再驗證候選規則。持有 V2 標記時，瀏覽器無法改寫或刪除私有房、公開鏡像和名單。抽籤與開賽的公私房成對寫入也被拒絕，房間維持等待。玩家仍能查自己的報名與公開賽事，操作紀錄只對伺服器可見。沒有標記的測試房可按原權限寫入抽籤及開賽。此測試載入完整規則，放在其他佇列測試後執行。

工作者模擬是同一 Node 程序中的五個獨立 service 物件，共用真正的本機 Firestore Emulator；不是五台實體 Cloud Run。測試使用合成 Auth，沒有驗證正式 Auth／App Check、行動網路、跨區延遲或正式觸發器／排程器交付。

前端模擬完成交易後會主動讀回，將測試時鐘前移 4 秒以越過手動查詢限頻；報告時間是這個隔離測試的實際牆鐘時間，不代表正式站自動輪詢的延遲上限。

本機重跑（固定 demo project 與 loopback；harness 不符即拒絕執行）：

```sh
NODE_PATH=/path/to/test-deps/node_modules GCLOUD_PROJECT=demo-bxh-registration-v2 \
  /path/to/test-deps/node_modules/.bin/firebase emulators:exec --only firestore \
  --project demo-bxh-registration-v2 --config registration-flow-v2/emulator.json \
  'node --test registration-flow-v2/tests/recovery.test.cjs && node registration-flow-v2/tests/frontend-waves.cjs && node registration-flow-v2/tests/waves.cjs && node registration-flow-v2/tests/start-320.cjs && node --test registration-flow-v2/tests/ownership-rules.cjs'
node --test tests/registration-feedback.test.cjs tests/family-roster-checkin.test.cjs tests/community-quick-registration-cloud.test.cjs tests/public-pages-artifact.test.cjs
node scripts/verify-production-frontend.cjs
```

CI 安裝固定 firebase-tools@13.35.1、firebase-admin@14.4.0、firebase-functions@7.3.2，Node 22、Java 17。本機 Node 版本另記於 `evidence/manifest.json`。

## 正式發布阻擋項目

- 重新擷取並對照當前 family、roster、遞補、管理及其他會寫名額的正式來源／設定。不能只以 #730 的擷取或本地測試當成當前線上版本證明。
- 一般官方房的 V2 家庭報名完成後，必須由後端把報名文件投影成 QR 可讀的參賽名單。試點要核對 `registrationRosterSyncBackendEnabled`、正式 `syncRegistrationRoster` 的版本與房間設定，再驗證報名完成、觸發交付、名單讀回和 QR 報到能接續。2026-11-09 擷取的同步來源會在開賽或已有對戰表時停止投影，試點也要驗證抽籤前補齊名單，避免把不同步的名單鎖進對戰表。
- 將**所有**相關名額寫入入口接至同一協調規則，包括舊版客戶端與直接 Firestore 管理寫入。此候選已接入本人／家庭報名、玩家與管理端取消、線上備取升正取、官方個人賽的線上降備取和自動補位設定。一般官方個人賽的現場手動升正取與批次新增也已接入候選。現場專用備取流程與舊版客戶端寫入仍待查核與整合。有限額遞補目前只驗證官方個人賽候選；不限額社群房由既有 roster handler 處理。
- 先部署並驗證新函式、文件觸發器、恢復排程與 indexes，確認自動交付及中斷接手。`backend/bindings.cjs` 尚未加入正式 entrypoint，並要求由 `node backend/prepare-family.cjs <核對後的原始 family-registration.js>` 產生的容量候選。若目前正式來源與擷取版本不同，先重新審查差異並更新候選，再產出部署套件。
- V2 佇列在接受新操作的交易內要求私有房間的 `registrationQueueVersion === 2`。現有 callable 的寫入入口須以 `createGuardedLegacyWriter` 包裝，並在同一寫入交易拒絕已切換的房間。名額預查及名單讀取可以保留。正式入口尚未安裝此包裝。停用 V2 時先關閉新操作，再確認原佇列排空，最後移除房間所有權標記。
- 儲存庫的 `manageOnsiteWaitlist` 候選在同一交易讀取 V2 所有權，保留預覽及舊操作回執，拒絕新的專用備取寫入。此防護須以當前正式來源核對後接入。啟用檢查也必須拒絕由專用備取掌管的房間。
- 舊瀏覽器可直接更新 JSON 字串 `tournaments.data` 及 `publicTournaments.bracketView`。Firestore Rules 無法逐欄辨識字串內的名單、報到、對戰內容。啟用前需先把允許的狀態寫入移到受信任函式，或隔離成可由 Rules 辨識的欄位，再封鎖瀏覽器對 V2 房的直接名單寫入。只改前端開關無法封鎖舊頁面。
- `backend/compose-rules.cjs` 對 2026-11-04 已審查快照產出完整隔離候選，來源雜湊不符就停止。候選規則在 `registrationQueueVersion === 2` 時會封鎖私有房與公開鏡像的所有瀏覽器寫入，也封鎖名單子集合。任何仍依賴瀏覽器寫入的報到、抽籤、開賽、計分或房間設定須先改走可信任入口。發布前要重新讀取當前正式 Rules 並審查差異。`queue-rules.fragment` 不能單獨部署，新增 deny 不能推翻其他重疊 allow。
- 檢查 My Events 操作憑證、分桶、現場備取、抽籤與團體模式的相容性。抽籤／團體不在本候選的可啟用範圍。
- 正式 Auth、App Check、實體瀏覽器及小範圍活動驗收，並準備來源／設定 readback 與 rollback。

上述條件未完成前，server enabled 預設 false，前端 allowlist 必須保持未定義／空。此模擬不解釋 BXH-ANYX2T 當時的確切失敗原因，該事件仍需歷史後端紀錄。
