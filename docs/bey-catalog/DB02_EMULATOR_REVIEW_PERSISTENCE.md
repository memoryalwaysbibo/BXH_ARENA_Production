# DB-02 第六批｜Emulator 審核持久化與權限驗證

## 本次實作
- 新增 `review-emulator-persistence.cjs`：受控測試環境的審核紀錄 Firestore transaction。
- 身分來自注入的 `authVerifier.verifyIdToken()`，不是前端提交的 reviewerId。
- 角色從 transaction 內讀取 `users/{uid}`；僅允許 active admin / super_admin，tester、停用帳號、player 拒絕。
- 審核前核對伺服端 `beyCatalogRuleDrafts/{draftId}` 的不可變 digest；來源草稿更動時拒絕沿用舊審核。
- 第一位審核者與第二位必須不同，拒絕自我核准；使用 Firestore transaction 保護並行競態。
- 審核結果儲存在 `beyCatalogReviewDrafts/{draftId}`，狀態最多到 `ready_for_server_verification`，不發布、不開放玩家選配。
- Emulator candidate rules 仍對客戶端完全拒絕審核文件的讀寫。

## 本批測試
- `tests/bey-catalog-emulator/review-persistence.test.cjs`：角色權限、獨立雙人審核、資料竄改、客戶端拒絕、正式專案阻擋。
- 已接入 `bey-catalog-emulator.yml`；以 GitHub CI 實際結果為準。

## 尚未完成的安全條件
1. 此模組 **僅可在 `demo-bxh-catalog-db01` 的 loopback Emulator 執行**，不可部署為正式 Cloud Function。
2. 測試使用替身 token verifier，尚未與正式 Firebase Admin SDK 的 `verifyIdToken`、撤銷驗證、App Check 及 IAM 完成整合。
3. 角色從 users 文件讀取，但正式站的角色生命週期、管理員任命及權限變更仍需交叉驗證。
4. 正式審核文件的安全規則、持久化、版本發布交易、事件記錄與回退演練尚未驗收。
5. DATA-01B 真實 197 筆 Firestore Emulator 全量寫入仍未完成；不得宣稱 DB-01 完全結案。

## 上線原則
- PR #459 保持 Draft；不合併、不部署。
- 本批新增程式與測試不會變更正式 Firebase、比賽、玩家資料或叫號。
