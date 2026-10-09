# TW-13｜Cloud Functions v2 HTTP 安全入口隔離驗收（尚未部署）

> **後續狀態（2026-10-10）**：本文件保留 TW-13 當時的 factory 隔離測試；DB-01 原始 197 筆真實驗收已完成，並已注入真正 v2 `onRequest` SDK 經 loopback HTTP／真實 Auth Emulator 驗收。最新結果見 [CATALOG_REAL_HTTP_ACCEPTANCE.md](CATALOG_REAL_HTTP_ACCEPTANCE.md)。仍未部署，App Check 仍為替身。

## 本批交付
- `modules/bey-catalog/catalog-tw13-http-v2.cjs`：接受受信任的 `firebase-functions/v2/https.onRequest` 注入，產生未部署的 HTTPS v2 處理函式。
- 僅允許受控 HTTPS Origin 白名單，處理 CORS 預檢、POST 與 JSON，限制請求內容 4 KiB、查詢參數白名單。
- 讀取 Authorization Bearer ID Token 及 `X-Firebase-AppCheck`，交由 TW-12 可信 Admin SDK 契約執行 App Check、撤銷驗證、UID 一致性、原子配額、角色檢查及稽核。
- 只回傳 TW-08/TW-10 的唯讀待審核清單（目前預期 31 項）；沒有建立、核准、發布或修改資料的 HTTP 操作。
- 對外回傳最小化錯誤碼：401 未登入／Token 撤銷、403 Origin／App Check／角色拒絕、429 限流、400 請求錯誤、503 稽核或服務不可用。不得回傳堆疊、UID、Token 或私有研究資料。
- `tests/bey-catalog-tw13-http-v2.test.cjs`：使用注入的 onRequest 與安全服務替身，驗證正常分頁、Origin、預檢、方法、內容型別、Token、App Check、角色、限流、稽核及故障阻擋。

## 已發現的其他 CI 問題
- 前一 HEAD `105d9d01` 的繁中與 Firestore Emulator 安全 CI 均成功。
- 同一 HEAD 的 ARENA 前端 UI Smoke 失敗，定位為既有 `tests/e2e/pwa-install-entry.spec.cjs` 的密碼輸入值在關閉／重新開啟安裝介面後未保持，桌面兩次重試失敗、Android 曾重試恢復。
- 該 PWA UI 測試與本批新增的未掛載後端模組沒有直接接線關係；**不能直接宣稱根因已確認為環境波動或完全與本批無關**。本批不修改登入／PWA 前端程式，保留獨立調查。

## 正式上線前必須完成
1. 核對實際 Cloud Functions v2 的 `onRequest`、Firebase Admin SDK、App Check 註冊 App IDs 與服務帳戶 IAM，建立受控且不可被前端替換的依賴。
2. 真正的原子速率限制（例如 Firestore transaction + TTL）及伺服端稽核儲存，附上權限與費用驗證。
3. 針對正式 ARENA 登入、手機、CORS 與 App Check 的端到端測試，避免在未驗收前開放正式路由。
4. 真實 DB-01 DATA-01B 197 筆 Firestore Emulator 全量匯入仍未完成；這是與本批不同的必要驗收。
5. 正式發布／回退與管理員審核寫入尚未上線。PR #463 保持 Draft，未合併、未部署。

## 回退
本批僅新增獨立模組、測試、CI 與文件，沒有新增正式 Function export 或部署；撤回 PR 即可。
