# TW-12｜Cloud Function 受控查詢入口契約（未部署）

## 本批內容
- 新增 `catalog-tw12-secure-read.cjs`：傳輸層中立的伺服端查詢流程，不直接宣稱是已部署的 Cloud Function。
- 請求依序檢查：
  1. 受信任的 Firebase Admin App Check `verifyToken()` 與伺服端允許的 appId 白名單。
  2. Firebase Admin Auth `verifyIdToken(token, true)`，拒絕撤銷 Token、匿名身分。
  3. 伺服端原子式 `consumeRateLimit({uid, operation})`，不接受前端提供的配額鍵。
  4. TW-10 受控 Admin Firestore `users/{uid}` 權限判定、TW-08 唯讀研究資料查詢。
  5. 受控 `recordAudit`，僅保存 uid、操作代碼、結果、筆數、篩選與批次 ID；不得記錄原始 ID Token、App Check Token、搜尋內容或私有資料。
- 任一必要檢查或稽核失敗時 fail closed，不回傳審核清單。
- 31 項真實待審核工作仍維持唯讀，管理員無法透過此入口核准、寫入或發布。
- 新增 `bey-catalog-tw12-secure-read.test.cjs`，覆蓋未註冊 App Check、撤銷 Token、速率限制、稽核失敗、玩家拒絕及輸入驗證。

## 正式 Cloud Functions 整合前的阻擋條件
1. 本模組**沒有**初始化 Admin SDK、建立 HTTP/Callable Function、部署或修改正式 Firebase。
2. 正式 Firebase Functions v2 建議優先使用 `onCall({enforceAppCheck:true})` 的平台驗證結果；若採自訂 HTTPS 入口，才由可信後端執行 `adminAppCheck.verifyToken`。不得讓客戶端聲稱已通過 App Check。
3. 真正的配額需使用具原子性與 TTL 的受控後端儲存，不能使用單一 Node process 記憶體；操作稽核也需持久化且限制讀寫權限。
4. 必須確認 `allowedAppIds` 與正式 Firebase 專案註冊 App 一致，且不能把密鑰或 Token 記錄在日誌。
5. 若要啟用 App Check replay protection，需另外核對 Admin SDK 版本、consume 權限與成本；本批**尚未啟用**。
6. 審核寫入 TW-09 仍是 Emulator-only；正式審核事件的授權與資料保存尚未完成。
7. DB-01 原始 DATA-01B 真實 197 筆 Firestore Emulator 寫入仍未完成（PR #462），不能將此批安全測試當成資料匯入驗收。
8. PR #463 保持 Draft，未合併、未部署，正式 ARENA 玩家、賽事與比分不受影響。

## 退路
- 僅新增模組、測試與文件；回退 PR 不影響正式站。
