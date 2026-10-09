# 實際 HTTP 隔離驗收

2026-10-10。延續已規劃的隔離整合驗收，未建立正式入口、Functions export、部署設定或正式Firebase初始化。

## 實際接線

createTw13HttpV2Handler 注入 firebase-functions 6.4.0 的真正 firebase-functions/v2/https.onRequest；以 Express 4.21.2 解析 JSON，Node HTTP 僅綁定 127.0.0.1 隨機埠，透過 fetch 送出真正請求。Auth／Firestore 使用既有固定 demo-bxh-catalog-db01 Emulator、真實 Admin SDK 與私有資料載入器；App Check 仍為明確測試替身。

測試 transport helper 不是正式服務或部署入口。JSON 解析錯誤與超過4096 bytes 由本機 Express 測試中介層回400 INVALID_REQUEST；不可宣稱雲端 Functions Framework 的解析層已驗證。CORS／方法／授權／角色／配額等則由既有 handler 處理。

## 驗收結果

- 公開 Auth／HTTP 回歸5/5通過：真實密碼登入、玩家403、匿名／格式錯誤／錯誤audience／過期401、停用／撤銷401、CORS預檢204、方法405、錯誤Origin403、非JSON415、損壞／超大JSON400，私有資料未被讀取。
- 使用交接包原始197筆真正寫入Firestore Emulator，來源SHA及manifest固定值吻合；完整資料與來源檔均保留。
- 從HTTP回應讀取四頁10/10/10/1，共31項pending（P0=5、P1=15、P2=11）；第五次P0查詢5項，第六次限流429；玩家403、錯誤App Check403。canApprove／canPublish皆false，Cache-Control=no-store。
- 七種資料破壞案例沿用載入器直接拒絕檢查；本模式的HTTP Auth角色已撤銷，因此不宣稱這七種異常透過HTTP驗證503。
- 私有真實資料runner退出0，原始payload逐筆一致、published=0、cloudWrites=0、emulator=true，輸出http=loopback-http-real-v2-sdk。
- HTTP handler與私有載入器契約回歸9/9通過；未修改正式handler行為。

## 重現

隔離安裝現有依賴並加firebase-functions@6.4.0及express@4.21.2。公開CI的既有Auth Emulator步驟設定BXH_CATALOG_REAL_HTTP=1，再執行tw17-auth-emulator.test.cjs；不提供私有資料。

私下提供BXH_CATALOG_DATA01B_FILE，使用firebase-auth.json啟動firestore,auth後執行：

    node tests/bey-catalog-emulator/data01b-taiwan-real.cjs --real-auth --real-http

--real-http必須同時使用--real-auth。正式App Check、Google登入簽章、Cloud Functions Emulator、雲端HTTP、IAM、TTL與保留政策仍未驗收；31項補證／双人審核維持pending。兩個PR保持Draft，未合併、未部署、未修改正式ARENA。

SDK接線參考：[Firebase官方HTTP Functions文件](https://firebase.google.com/docs/functions/http-events)。實際通過聲明以本次本機日誌與程序退出碼為準，官方文件不替代測試證據。
