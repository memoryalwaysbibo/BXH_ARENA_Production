# TW-18 私有原始研究資料載入器

2026-10-10。前一 HEAD 1ae462a 的繁中、Emulator Safety、前端三項 CI 全部成功；本批未重做 DB-01 或 TW-17。

## 本批行為

新增 catalog-data01b-private-emulator-loader.cjs，將真實資料驗收 runner 內的私有讀取流程抽為可由可信後端注入的載入器。僅支援固定 demo 專案與 loopback Firestore Emulator，沒有正式 writer、公開 API 或部署功能。

- 每次載入均核對私有原始 JSON SHA、九類實體數與固定 manifest，不接受請求傳來的檔案路徑或資料內容。
- 原始 SHA：2a53b4d0164d97a5f0607b4d4fd8a536a84b388530bca3eb371453f525cb7d42。
- Manifest：e8fa4337fa76bd13ebc372ff91e611d03fcd4ccd5ec91623be21f5dabc5992f0。
- 在 Admin SDK readOnly transaction 的同一個一致快照中，核對完成的批次狀態、零衝突、九類集合數量及 197 筆完整文件。
- loadOriginal 回傳通過核對的原始資料副本；loadResearchBatch 執行既有 TW-01～TW-05 衍生，不寫入資料。
- 私有研究資料仍在角色檢查後才載入；載入異常對 HTTP 僅回 503 SERVICE_UNAVAILABLE。

## 實際驗收

原始 197 筆經真實 Firestore Emulator 匯入，成功產出 31 項 pending（P0=5、P1=15、P2=11）；分頁、配額與稽核維持既有驗收行為。原始檔與 Firestore payload 在異常模擬回復後逐筆核對保持一致，published=0、cloudWrites=0、emulator=true。

七種實際異常全部拒絕：
1. payload 改動但保留舊 SHA。
2. 文件誤標為 published。
3. 批次 in_progress。
4. 批次 completed_with_conflicts。
5. manifest 摘要錯誤。
6. 額外文件。
7. 缺少文件。

預設 Auth 替身模式也逐項驗證 HTTP 回 503，不回傳 SDK 診斷、私有來源或原始內容；原始研究資料不被載入器覆寫。真正 Auth Emulator 模式驗證完整登入、撤銷、停用、匿名與 197 筆接軌，並以載入器直接驗證七種異常。

契約回歸 81/81 通過；公開 CI 新增不需私有資料的載入器隔離／來源拒絕測試。公開 CI 不替代私有原始 197 筆驗收。

## 重現與限制

私下提供原始檔，設定 BXH_CATALOG_DATA01B_FILE 後沿用 data01b-taiwan-real.cjs；真正 Auth 模式加 --real-auth，使用 firebase-auth.json 並開啟 firestore,auth Emulators。

目前只供隔離 Emulator。App Check 仍為替身、HTTP 是程序內 handler，正式 IAM、App Check、TTL 與資料保留政策未啟用。31 項待審核內容未核准。PR 保持 Draft；未合併、未部署、未修改正式 ARENA。
