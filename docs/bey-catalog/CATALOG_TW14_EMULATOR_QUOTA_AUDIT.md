# TW-14｜Firestore Emulator 限流與稽核持久化

## 實作
- `catalog-tw14-emulator-guards.cjs`：只允許 `demo-bxh-catalog-db01`、`127.0.0.1:8189` 的 Firestore Emulator，禁止正式專案。
- `consumeRateLimit`：Firestore transaction 固定 60 秒視窗、每 UID 每操作最多 5 次，使用 SHA-256 衍生文件鍵；多個執行個體共用同一資料庫狀態，不依賴 Node 記憶體。
- `recordAudit`：每次通過查詢後保存獨立事件，僅包含 actorHash、操作、結果、筆數、篩選、批次 ID 與伺服器時間戳；不保存 Token、原始搜尋文字或私有研究資料。
- `tests/bey-catalog-emulator/tw14-quota-audit.test.cjs`：驗證 5 次通過、第 6 次拒絕、新視窗、並行競態、稽核欄位、錯誤參數、客戶端拒絕讀寫與正式專案阻擋。
- `tests/bey-catalog-emulator/tw14-tw12-integration.test.cjs`：以 **合成 197 筆研究形狀資料**串接 TW-12 安全查詢及真實 Emulator 交易，驗證 5 次查詢與 5 筆稽核、第 6 次限流。
- 已加入 `bey-catalog-emulator.yml` CI。

## 限制
1. **不是正式 Admin Firestore 實作**：此模組使用測試用 Firebase client SDK 加上 Emulator 管理測試上下文，不能直接部署到正式 Cloud Functions。
2. `expiresAtMs` 是測試欄位，尚未配置正式 Firestore TTL Timestamp 欄位／索引／清理政策。
3. 稽核事件未設定正式保留期限、隱私／資安存取審核或不可變 IAM；actorHash 未加伺服端秘密鹽，不應作為正式不可逆匿名化保證。
4. 高併發下 transaction 可能因競態重試失敗；正式 API 必須將這類情況 fail closed，不得放行超額查詢。
5. **此批整合測試的 197 筆是合成 fixture，不是 DB-01 真實 DATA-01B**；真實 197 筆 Firestore Emulator 全量寫入仍在 PR #462 待驗收。
6. 尚未建立正式 Cloud Function export、正式 App Check／Admin SDK 實例、正式限流／稽核儲存，PR #463 保持 Draft，未合併、未部署。

## CI 觀察
- 前一 HEAD `efde1486` 的台灣繁中與 DB-01 Emulator 安全 CI 通過；前端完整驗證在當時仍執行中。
- 本批最新 HEAD 的測試結果以 GitHub Actions 實際完成狀態為準，不預先宣稱通過。
