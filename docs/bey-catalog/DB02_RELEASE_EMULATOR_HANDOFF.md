# DB-02 第八批｜CI 修復與隔離版規則提案保存

## CI 修復
- Emulator run 37874332977 失敗原因：測試「第一位審核者降權」沿用前一個已結案草稿，得到 REVIEW_ALREADY_FINALIZED，而非預期的 FIRST_REVIEWER_NO_LONGER_AUTHORIZED。
- 已改用獨立草稿，在測試中先建立第一審，再降權，驗證第二審阻擋與狀態未變。
- 前端 run 37883477792 的風險分類失敗：checkout 已取完整歷史，後續卻對 base 執行 --depth=1，導致 git diff 三點比較找不到 merge base。已移除多餘的 shallow fetch，不降低風險等級。

## Emulator 版規則提案保存
- 新增 release-emulator-persistence.cjs，僅允許 demo-bxh-catalog-db01 的 loopback Firestore Emulator。
- 讀取雙人審核紀錄與 canonical draft，要求一致的 draft hash、相同完整原配零件集合及相同官方來源。
- 使用 Firestore transaction 做 create-only；重送同 checksum 不重複，已有不同 checksum 拒絕覆蓋。
- 只寫入 unpublished / active=false / selectable=false 的版本提案，不切換公開版本，不開放玩家配裝。
- 追加測試：重送、衝突、拒絕案件、自我審核、客戶端拒絕寫入、正式專案拒絕、跨零件／來源挾帶。

## 尚未完成
- 最新 HEAD CI 尚未驗收完成。
- 真實 DATA-01B 197 筆 Firestore Emulator 匯入尚未完成；本機已讀取真實資料 JSON，含 23 來源、9 產品、45 零件、11 配色候選、9 顏色、14 方案、16 組合、52 關聯、18 待辦。
- 尚未接正式 Firebase Admin SDK、正式 Firestore Rules、Cloud Functions、管理員 UI、正式發布或回退。
- 本 PR 維持 Draft，不合併部署。
