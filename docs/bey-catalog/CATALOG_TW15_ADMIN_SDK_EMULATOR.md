# TW-15｜Firebase Admin SDK × Firestore Emulator 實際交易驗收

> **後續狀態（2026-10-10）**：本文件保留 TW-15 當時以合成形狀資料測試 Admin SDK 的批次邊界；DB-01 原始 197 筆真實 Firestore Emulator 驗收其後已完成，並已接續通過私有載入器、真實 Auth Emulator 與 v2 SDK loopback HTTP。請分別參考 [DB01_REAL_EMULATOR_RECEIPT.md](DB01_REAL_EMULATOR_RECEIPT.md) 與 [CATALOG_REAL_HTTP_ACCEPTANCE.md](CATALOG_REAL_HTTP_ACCEPTANCE.md)。

## 本批交付
- `modules/bey-catalog/catalog-tw15-admin-emulator.cjs`：使用 **firebase-admin/firestore** 的 Firestore `runTransaction`、`DocumentReference.create`、`Timestamp` 與 `FieldValue.serverTimestamp`；僅允許 `demo-bxh-catalog-db01` + `127.0.0.1:8189` 的隔離 Emulator。
- 每個 UID／操作在 60 秒固定視窗最多 5 次；配額文件以受控 HMAC-SHA256 導出 ID，不在文件路徑暴露原始 UID；交易內檢查既有 count 防止異常覆寫。
- 稽核紀錄用 `create` 追加文件，含 HMAC 化 actor、操作、結果、回傳數量、優先級、批次 ID、伺服器時間戳；不保存 Token 或搜尋文字。
- 配額 `expiresAt` 使用 Firestore Timestamp，可供未來正式 TTL 規劃；本批 **沒有建立 TTL policy**，也不宣稱會自動刪除。
- `tests/bey-catalog-emulator/tw15-admin-sdk.test.cjs`：真實 Admin SDK 對 Emulator 交易，驗證限流、並行、HMAC 稽核、Timestamp、錯誤輸入，以及 TW-12 安全查詢接上真實 Admin SDK 的 5 次成功／第 6 次拒絕。
- GitHub Actions `bey-catalog-emulator.yml` 安裝 firebase-admin 13.5.0 並執行整合測試。

## 嚴格限制
1. **只准 Emulator**：程式逐次檢查 target、`FIRESTORE_EMULATOR_HOST` 與 Admin Firestore projectId，拒絕正式專案或非 loopback 連線。
2. HMAC secret 由可信伺服端注入，不在倉庫寫入正式金鑰；測試使用公開的固定測試值，絕不能用於正式環境。
3. 正式環境需獨立審核 IAM、App Check、速率限制政策、TTL、稽核資料保留期限、隱私影響與費用，**不能直接解除本批 Emulator guard 當成部署**。
4. TW-12 測試中的 Auth/App Check 仍為測試替身；這不是實際正式 Firebase 身分驗證端到端測試。
5. 本批的 197 筆仍是 **合成研究形狀資料**；真正 DATA-01B 197 筆 Firestore Emulator 寫入尚未完成，獨立 PR #462 未結案。
6. PR #463 仍為 Draft，未合併或部署正式 ARENA，未修改玩家、賽事、比分或叫號資料。

## 驗收門檻
- 最新 GitHub Actions HEAD 的 Emulator CI 必須成功，且 `tw15-admin-sdk.test.cjs` 確實執行通過，才可標記 TW-15 測試完成。
- 不能以台灣繁中 CI 通過取代 Admin SDK Emulator 測試。
