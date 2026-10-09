# DB-01｜交易式研究資料暫存驗收（2026-10-09）

## 實作
- `catalog-emulator-transactions.cjs` 以 Firestore `runTransaction` 做單筆 create-or-compare，防止兩個匯入工作同時檢查不存在、隨後互相覆寫。
- 既有相同 SHA-256：`unchanged`；不同 SHA-256：`conflict`，不覆寫人工修正；不存在：`inserted`。
- 強制 `demo-bxh-catalog-db01`、`127.0.0.1:8189`、`FIRESTORE_EMULATOR_HOST` 相符及 Firestore SDK 專案 ID 一致。
- 僅能寫入白名單公共研究集合，所有新資料 `publicationStatus=unpublished`。
- `tests/bey-catalog-emulator/transactions.test.cjs` 測試雙工作並行、衝突保留、正式目標拒絕、禁止寫入已發布文件。

## 驗收限制
- 此功能仍只供隔離 Emulator，不是正式 writer，也不包含雲端 IAM。
- 交易只保護**單筆文件**；整批多文件不是原子操作。若中途失敗，重試會略過已完成文件，但尚未建立完整批次提交／恢復狀態機。
- 尚未匯入完整 DATA-01B 真實資料至 Firestore Emulator；本批使用合成資料驗證。
- 未建立正式版管理端 reader/writer、正式 Rules 或 release 發布。
- GitHub CI 必須在本次 HEAD 上成功，才能將本批標示為「Emulator 交易驗證通過」。

## 後續
- 補批次狀態／恢復紀錄及資料依賴順序檢查。
- 檢查有效正式 Rules 與雲端部署權限，不直接將本候選規則複製到正式環境。
- 在隔離環境試匯入 DATA-01B，核對資料數、來源、衝突與 rollback，再進入 DB-02。
