# TW-09｜台灣繁中圖鑑管理員審核紀錄：隔離 Emulator 驗收

## 本批交付
- `catalog-tw09-review-emulator.cjs`：**只允許本機 loopback 的 demo-bxh-catalog-db01 Firestore Emulator**，透過 transaction 保存兩階段審核狀態及不可變審核事件。
- 由受信任的注入式 `authVerifier.verifyIdToken(token, true)` 取得 UID；交易內讀取 `users/{uid}`，要求 active admin / super_admin，拒絕玩家、測試帳號、停用帳號及匿名登入。
- 由 Emulator 受控 `beyCatalogTw09Proposals/{proposalId}` 讀取 canonical 提案與 SHA-256，拒絕前端偽造或更動提案；只允許原始 TW-05 研究批次及未發布狀態。
- 提案者不能自行審核；第一位接受後進入 awaiting_second，第二位必須不同人；第二次審核前重新查核第一位審核者是否仍有管理權限。
- Firestore transaction 使兩位管理員競態審核同一提案時只有一人可成功。事件寫入 `beyCatalogTw09ReviewEvents/{proposalId}_{first|second}`，記錄 actorUid、決定、理由、serverTimestamp；狀態寫入 `beyCatalogTw09Reviews/{proposalId}`，記錄 revision。
- 任何通過只到 `approved_for_draft_only`，不修改原始 197 筆資料、不發布、不讓玩家選用。拒絕為終止狀態。
- 客戶端 Firestore 規則的 catch-all deny 阻止直接寫入審核事件與狀態；測試用 admin bypass 僅在隔離 Emulator 中執行。

## 測試
- `tests/bey-catalog-emulator/tw09-review-journal.test.cjs`：雙人審核與事件時間戳、角色拒絕、撤銷第一位審核者權限、來源提案竄改、競態、客戶端禁止寫入及正式專案拒絕。
- 已加入 `.github/workflows/bey-catalog-emulator.yml`。是否通過以**最新 GitHub Actions HEAD**為準。

## 重要限制
1. 本批使用**測試用 token verifier 替身**，不是正式 Firebase Admin SDK，也沒有正式 HTTP API、App Check 或正式 Cloud Function。
2. `catalog-tw08-read-gateway.cjs` 仍是後端契約，尚未部署到正式 ARENA；TW-07/TW-08 的 HTML 為離線預覽。
3. Firestore transaction 的完整性檢查與 SHA-256 **不能取代伺服端角色任命及正式授權**。
4. 本批未合併、未部署，沒有正式 Firebase、玩家、賽事或比分資料寫入。
5. **DB-01 真實 DATA-01B 197 筆 Firestore Emulator 全量匯入尚未完成**，不能把本批模擬審核交易誤認為 DB-01 結案。
