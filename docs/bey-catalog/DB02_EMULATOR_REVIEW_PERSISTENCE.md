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

## 第七批｜權限變更與並行審核保護
- CI 曾發現測試斷言與新防竄改邏輯不一致：預期 DRAFT_CHANGED_NEW_REVIEW_REQUIRED，實際由更早的伺服端 canonical draft hash 檢查回傳 CANONICAL_DRAFT_MISMATCH。已修正測試斷言，不弱化安全檢查。
- 新增第一位審核者於第二次核准前遭停用／降權的即時角色重新驗證；不允許沿用失效的第一階段核對。
- 新增兩位管理員同時搶先送出第一階段審核的競態測試；同一份草稿只能有一個第一審成功。
- 修正測試污染：刻意竄改 canonical draft 的案例結束後，恢復隔離測試資料。
- 這些只在 Emulator 內驗證；正式雲端管理員授權與真實 197 筆資料匯入仍待完成。
