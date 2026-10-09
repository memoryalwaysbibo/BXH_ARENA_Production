# DB-00 → DB-01｜後端盤點與研究資料暫存驗收（2026-10-09）

## 實際盤點
- Frontend main: `72d6f4e13d478ddbf6cf66cde0903666bd479758`。
- Frontend PR #457 是 Draft；不合併、不部署。
- 後端原始碼相關倉庫：`memoryalwaysbibo/BXH_ARENA_Functions_Deploy`。
- 候選規則位置：`production-firestore-rules/firestore.rules`，讀取時檔頭為 v13.40.10；這是倉庫版本，不保證為雲端實際啟用規則。
- 既有測試模式：`production-roster-rules-tests` 使用 Firestore Emulator，測試專案 `demo-bxh-roster-rules`；此測試僅作模式參考，未修改既有規則。
- Frontend CI 的 main push 驗證成功可觸發正式 Pages 部署，因此禁止直接合併。

## 本批新增
- `modules/bey-catalog/catalog-staging.cjs`：來源／產品／零件／色版／內容方案／拆件／缺漏 9 類研究資料的穩定指紋、參照檢查與暫存計畫。
- `tests/bey-catalog-staging.test.cjs`：小型合成資料驗證去重、相容參照、衝突保留與拒絕正式目標。
- `safety-gate.cjs`：補上 `beyAssemblyClaims` 與 `beyCatalogIssues` 的明確白名單。
- 實際 DATA-01B 研究包在本機做了 197 個資料實體的試算與重送測試；**不是 197 個新商品，也沒有匯入 Firebase**。

## 重要限制
1. `applyEmulatorStaging` 使用注入的 emulator-only adapter，目前尚無 Firebase SDK/REST 實作。必須另外證明 adapter 確實連到 loopback Emulator；不可用它宣稱雲端寫入或安全規則已驗證。
2. 目前是逐筆 get/put 示範，未處理併發原子性；未來必須使用交易／create-only precondition、版本比對、重試與批次限額。
3. 研究資料含商家候選與未核對色版；所有寫入均需 `publicationStatus=unpublished`，禁止直接發布玩家圖鑑。
4. 現有正式規則尚未加入這些集合的 read/write 契約；不能直接在正式 Firebase 建立公開資料。
5. 正式後端規則及 IAM 的有效部署狀態、Cloud Functions 管理權限與 Emulator Rules E2E 尚未驗收。

## 下一個必要工程
- 建立與正式 Rules 隔離的 Emulator candidate rules，寫角色與權限測試。
- 建立真正的 emulator-only Firestore adapter（在建構時核對 projectId 與 host），驗證原子新增、重送與衝突。
- 審查資料契約與集合命名後，才可將 DATA-01B 暫存到隔離資料庫。
- 正式發布流程與 rollback 仍屬 DB-02/03，尚未開放。
