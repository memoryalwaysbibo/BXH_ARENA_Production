# TW-17 真實 Auth Emulator × DATA-01B 接軌驗收

> **後續狀態（2026-10-10）**：TW-17 的 Auth Emulator 結果保留；HTTP 已從程序內 handler 接續到真正 v2 `onRequest` SDK 的 loopback 傳輸驗收，詳見 [CATALOG_REAL_HTTP_ACCEPTANCE.md](CATALOG_REAL_HTTP_ACCEPTANCE.md)。App Check、雲端 HTTP 與正式 IAM 仍未驗收。

2026-10-09。前一提交 d002f93 的繁中、Emulator Safety、前端完整回歸三項 CI 全部成功。

## 發現與修正

實際 Firebase Admin SDK 驗證失敗會帶 auth/* 錯誤代碼；舊 HTTP adapter 只辨識測試替身的 TOKEN_REVOKED 等訊息，將真正的無效憑證誤回 503。補上 SDK 無效、逾期、撤銷、停用與不存在帳號的 401 UNAUTHENTICATED 映射，保留網路或配置故障 503 SERVICE_UNAVAILABLE，不回傳 SDK 訊息。

## 真實原始資料驗收

以 firebase-auth.json 啟動隔離 Auth（127.0.0.1:9098）與 Firestore（127.0.0.1:8189），專案固定 demo-bxh-catalog-db01。--real-auth 模式要求 Auth Emulator 主機完全匹配；原始 JSON SHA 與 manifest 仍鎖定，缺少原始資料時直接失敗。

Firebase Admin SDK 真實建立 Emulator 測試帳號，經 Auth Emulator REST 密碼登入取得 ID Token，再由 verifyIdToken(token,true) 驗證；不替換 Auth verifier。

- 真實原始 197 筆：完整讀回核對，原始檔與 Firestore payload 保留。
- 審核佇列：31 項（P0=5、P1=15、P2=11），唯讀、全部 pending。
- 管理員五次查詢與真實 Firestore 配額／稽核成功，第六次 429。
- 玩家身分驗證成功但權限不足，403；不載入私有研究資料。
- 匿名、格式錯誤、錯誤 audience、停用帳號、撤銷 ID Token：401；不增加研究資料載入次数。
- 原始資料驗收程序 exit code 0；published=0、cloudWrites=0、emulator=true。
- 預設 Auth 替身模式重新執行成功，維持既有驗收工具相容性。

公開 CI 新增 tw17-auth-emulator.test.cjs 真正 Auth/Firestore Emulator 測試，不依賴或提交私有原始資料。四項 Auth 測試通過，另含逾期 ID Token 401。契約回歸 79/79 通過。公開 Auth CI 不等於原始 197 筆資料驗收；兩者日誌分開保存。

首輪真實 Auth 測試實際得到 503 而非 401；修正 HTTP 錯誤映射後重跑成功。沒有降低 Auth、App Check 或角色規則。

## 重現

安裝與既有 Emulator CI 相同版本套件（firebase-admin 13.5.0、firebase-tools 15.30.0 等）與 Java 21，私下設定 BXH_CATALOG_DATA01B_FILE 後：

```sh
firebase emulators:exec --only firestore,auth --project demo-bxh-catalog-db01 --config tests/bey-catalog-emulator/firebase-auth.json 'node tests/bey-catalog-emulator/data01b-taiwan-real.cjs --real-auth'
```

公開 Auth 回歸不需原始 JSON：

```sh
firebase emulators:exec --only firestore,auth --project demo-bxh-catalog-db01 --config tests/bey-catalog-emulator/firebase-auth.json 'node --test tests/bey-catalog-emulator/tw17-auth-emulator.test.cjs'
```

## 尚未驗收

Auth Emulator 使用未簽署測試 ID Token，只驗證本機 SDK 接軌及身分／撤銷判斷，不代表正式簽章、Google 登入或正式 ARENA 帳號驗收。官方說明：https://firebase.google.com/docs/emulator-suite/connect_auth

App Check 仍為測試替身；HTTP 為程序內 handler，沒有部署 Cloud Function。正式 IAM、App Check、TTL policy 與稽核保留期限仍待正式整合前確認。PR 保持 Draft；未合併、未部署、不修改正式 ARENA。
