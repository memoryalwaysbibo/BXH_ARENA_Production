# DB-01｜真實 197 筆 Firestore Emulator 驗收收據規格

## 驗收判定
本批新增 `data01b-verify-receipt.cjs` 與獨立測試。即使 Firestore Emulator 程序退出碼為 0，也必須同時有下列**四個依序產生、各恰好一筆**的 JSON 紀錄，才會認定本次寫入驗收通過：

1. `interrupted`：已持久化 73 筆。
2. `recovered`：新增 124、既有 73、衝突 0。
3. `replayed`：新增 0、既有 197、衝突 0。
4. 最終收據：`batchId=DATA-01B-20261009`、`records=197`、`verifiedDocuments=197`、`verifiedCollections=9`、`manualConflicts=1`、`manualCorrectionPreserved=true`、`published=0`、`cloudWrites=0`、`emulator=true`，且中斷／恢復／重送計數吻合。

缺少任何階段、階段重複或順序錯誤、筆數不符、未保存人工修正、存在正式雲端寫入或任何發布，都必須失敗。單純印出 `verifiedDocuments=197`、離線 preflight 或合成 Emulator Safety CI **不構成 DB-01 完成證據**。

## 接線
- Windows `run-data01b-windows.ps1`：Emulator 程序成功後，呼叫 Node 收據驗證器核對整份日誌。
- GitHub 手動 `bey-catalog-real-data.yml`：使用 `set -euo pipefail` 與 `tee` 保存暫存日誌，執行收據驗證；結束時刪除暫存原始研究 JSON 與收據。
- 無秘密資料的 PR Safe Preflight CI：新增收據驗證器單元測試，確保錯誤／合成／不完整日誌不能通過。

## 誠實的驗收邊界
收據驗證器只檢查輸出格式與數值，**不證明日誌來源真實**。真正的證據必須同時來自可信執行環境、原始資料 SHA-256、真實 Firestore Emulator 寫入程序、程序成功退出與完整收據。

目前原始 DATA-01B 197 筆的 Firestore Emulator 真實寫入仍未完成。PR #462 保持 Draft；PR #463 暫停整合；未合併、未部署、未修改正式 ARENA。
