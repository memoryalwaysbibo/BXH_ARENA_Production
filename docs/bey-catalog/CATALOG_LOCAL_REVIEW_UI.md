# 圖鑑待審清單：本機唯讀操作頁

2026-10-10。接續既有 TW-07 預覽與 TW-08／TW-12 唯讀 API，補上實際瀏覽器操作；這是既有介面的隔離接線，不新增研究批次，不核准31項內容，不重跑DB-01。

## 本次完成範圍

- `bey-catalog-local-review.html`：手機版測試登入、P0／P1／P2、搜尋紀錄編號或待核原因、每頁10項、下一頁、空結果與錯誤提示。
- 登入走固定 `127.0.0.1:9098` Auth Emulator 密碼登入；只回傳ID token，不回傳refresh token。密碼輸入立即清空，token只留頁面記憶體，沒有localStorage／sessionStorage或cookie。
- 每次清單讀取仍走TW-12：真實Admin Auth撤銷驗證、可信 `users/{uid}` 角色、TW-15資料庫交易限流／稽核，以及私有DATA-01B載入器。角色和來源路徑不能由客戶端指定。
- 啟動時先以私有載入器唯讀核對**既有已完成的197筆Emulator快照**；不存在、不一致或有衝突就不開啟伺服器，不自行匯入。
- 僅綁定 `127.0.0.1`，逐次要求固定demo project及Auth／Firestore Emulator host；精確Host與Origin檢查阻擋跨站請求及DNS rebinding。靜態資產白名單、同源CSP、no-store，不提供任意檔案讀取。
- 清單以textContent呈現；切換查詢重置cursor，失效登入清除清單，登出取消未完成請求，避免舊回應重新出現。429只提示稍後手動重試，沒有自動輪詢。
- App Check在本機transport中**明確使用替身**，不能視為正式App Check通過。這不是可部署的正式API，也不是已發布的獨立網站。

## 啟動前提

已安裝既有Emulator工具／Admin SDK；固定demo Emulators正在執行，且已保有既有驗收的有效快照與測試管理員帳號。不能使用正式ARENA帳號密碼。若快照不存在，先停在此處，不為了開頁重做已通過的原始197筆匯入。

私下設定 `BXH_CATALOG_DATA01B_FILE` 為原始檔路徑，並提供至少32字元的本機 `BXH_CATALOG_LOCAL_SECRET`。此secret只用於隔離配額／稽核，重啟應沿用同值，避免改變配額鍵；不得使用正式secret或提交任何secret。

```sh
FIRESTORE_EMULATOR_HOST=127.0.0.1:8189 \
FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9098 \
node scripts/bey-catalog-local-review.cjs
```

成功後在同一部電腦開啟 `http://127.0.0.1:5019`。來源固定為未發布研究批次，全部事項仍pending；管理員每60秒最多5次清單讀取，四頁讀完會用掉4次。只有配額與稽核寫入Emulator，研究內容保持唯讀。

## 驗證界線

`tests/bey-catalog-emulator/local-review-ui.test.cjs` 使用真正Auth／Firestore Emulator、Admin SDK、Chromium手機viewport，**研究資料是明確合成fixture**。它驗證：

1. 同源／Host／方法／JSON與客戶端角色或來源注入阻擋。
2. 真實測試登入、玩家拒絕及未授權不載入研究資料。
3. 四頁10/10/10/1、P0篩選、搜尋、真實交易限流429。
4. 失效登入清除資料、過期cursor400、登出時未完成回應不恢復清單。
5. 來源文字不能插入HTML、手機不水平溢出、憑證不寫瀏覽器儲存。
6. 啟動後Emulator配置遭變更時拒絕讀取。

此測試不使用私有原始JSON，不能替代DB-01已完成的真實資料驗收，也不證明本頁已以私有快照完成人工操作。正式Google登入、App Check、IAM、Rules部署、TTL、31項雙人審核與ARENA整合維持待辦。

本機結果：六項瀏覽器／HTTP／Emulator測試全部成功，程序退出0；既有TW-08／TW-12／TW-13相關20項契約回歸成功。公開CI結果須另以最新PR HEAD核對。

PR #463保持Draft；未合併、未部署、未發布圖鑑、未修改正式ARENA。回退時移除本次頁面、local-review模組、啟動腳本及相應測試即可，無正式資料遷移。
