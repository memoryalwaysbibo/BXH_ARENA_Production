# Firebase Functions Emulator HTTP 邊界驗收

2026-10-10。這項驗收把既有 TW-13 `firebase-functions/v2/https.onRequest` factory 載入真正 Firebase Functions Emulator，透過 Emulator 提供的 HTTP URL 測試 Functions Framework 邊界。它是既有真實 Auth Emulator 與 v2 SDK loopback 驗收的下一層公開 CI 回歸，不新增資料批次，也不重跑或取代 DB-01 私有原始197筆驗收。

## 隔離條件

- 專用 demo project：`demo-bxh-catalog-db01`。
- Firestore、Auth、Functions 只綁定 `127.0.0.1` 的 8189、9098、5009；fixture 在載入前再次檢查兩個資料 Emulator host。
- fixture 只供測試，沒有部署指令、正式 project、正式 Firebase 初始化或私有研究資料。
- 使用真正 Firebase Admin SDK 連接 Auth／Firestore Emulator；建立一名管理員與一名玩家，使用 Auth Emulator 密碼登入取得 ID token。
- App Check 仍是明確標示的測試替身。管理員資料載入器固定 fail closed 為 `PRIVATE_RESEARCH_NOT_AVAILABLE_IN_PUBLIC_CI`。

## CI 驗收矩陣

`tests/bey-catalog-emulator/functions-http.test.cjs` 必須透過 Functions Emulator URL 驗證：

1. CORS 預檢 204、允許來源、`Cache-Control: no-store`、GET 405 與錯誤 Origin 403。
2. 真實 Auth Emulator 玩家身分到達角色閘門並得到 403；管理員通過身分與角色後，因公開 CI 沒有私有 loader 而受控得到 503。
3. 未登入 401、錯誤 App Check 403、超大 payload 400。
4. 損壞 JSON 由實際 Functions Framework 邊界拒絕 400，回應不得反射原始內容或堆疊。

驗收成立以 PR 最新 HEAD 的 `BEY Catalog DB-01 Emulator Safety` 工作流程成功為準；舊 HEAD、離線 preflight、程序內 handler 或合成資料都不能代替此結果。

## 未涵蓋範圍

本測試不含 DB-01 私有原始197筆；該真實資料證據沿用既有固定來源 SHA、manifest 與私有證據包。它也不驗證正式 App Check、Google登入簽章、雲端 Functions HTTP、服務帳戶 IAM、正式 Firestore Rules 部署、TTL／稽核保留政策，且不核准31項 pending 研究內容。

PR #463 必須保持 Draft；不得因 Emulator CI 通過而合併、部署、發布圖鑑或修改正式 ARENA。
