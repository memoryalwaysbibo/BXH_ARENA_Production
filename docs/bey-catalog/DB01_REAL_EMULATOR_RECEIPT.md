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

## 2026-10-10 真實執行結果

已使用 PR #462 提交 `46e379acb52ce06d6a0dd9cdec0adedfbffbbb26` 與交接包原始私有 JSON 完成真正 Firestore Emulator 寫入，並以本提交的收據驗證器回傳 `acceptance=PASS`。

- 執行環境：Node 24.19、Java 21.0.12、firebase-tools 15.30.0、Firestore Emulator 1.22.0；固定 demo 專案 `demo-bxh-catalog-db01`、loopback `127.0.0.1:8189`。
- 原始來源 SHA 與 manifest 均吻合本文件／驗證器固定值；197 個研究實體、9 個集合。
- 實際持久化 73 後中斷，恢復新增 124／既有 73，重送新增 0／既有 197，衝突均為 0；197 payload 逐筆核對一致。
- 人工修正後重送：196 既有、1 衝突，整份修正文件保留；批次為 `completed_with_conflicts`，這是預期衝突保護結果。
- Emulator 程序及獨立收據驗證器退出碼皆為 0；`published=0`、`cloudWrites=0`、`emulator=true`。收據與 Windows runner 契約測試 15/15 通過。
- 真實執行日志、Emulator debug log、收據、環境與檔案摘要已保存於私有驗收證據包。原始 JSON 未提交公開 GitHub。

本結果是本機隔離 Emulator 驗收；不宣稱 Windows 實機或正式 Firebase 已驗收。程式提交 `46e379ac` 的三項 PR CI 全數成功；此後任何新提交仍須另外核對 CI。PR #462 保持 Draft；PR #463 暫停整合；未合併、未部署、未修改正式 ARENA。
