# DB-01｜中斷恢復與批次指紋（2026-10-09）

## 本次新增
- `catalog-emulator-batch.cjs`：每個批次建立 `beyCatalogImportRuns/{batchId}` 清單，保存穩定 manifest SHA-256、預期文件數與狀態。
- 批次中斷後，重新執行逐筆原子 create-or-compare；相同 SHA 不重建，不同 SHA 列衝突，無條件禁止自動發布。
- 相同 batchId 卻改動內容時拒絕覆蓋舊 manifest；應建立新 batch revision。
- `batch-recovery.test.cjs`：模擬第一筆後中斷、重新執行、重送、人工修正衝突、manifest 不可偷換。

## 真實保證與限制
- 單筆寫入使用 Firestore transaction；整批不是原子提交。
- `completed` 表示本次所有文件已逐筆比對；`completed_with_conflicts` 表示有人工處理項目，不可發布。
- 批次清單只用於隔離 Emulator；未串接正式 IAM、Firestore Rules、正式管理端或 Cloud Functions。
- 這個機制不是備份，也不能替代 DB-02 的 release rollback。
- 尚未執行 DATA-01B 197 筆在 Firestore Emulator 的完整匯入；仍需真實資料 E2E、批次上限與容量測試。
- 需等最新 HEAD GitHub Actions 全部成功，才能宣稱本次 Emulator 測試通過。

## 下一步
1. 最新 CI 綠燈後，在 Emulator 載入 DATA-01B 的受控資料快照。
2. 比對 197 個實體的資料計數、引用與內容 hash；確認重送 0 新增。
3. 加入失敗注入、衝突修復與可回退版本指標，才進入 DB-02。
