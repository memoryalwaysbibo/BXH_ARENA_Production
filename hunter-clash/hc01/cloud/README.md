# HC01 雲端內測候選包

這是部署前的候選程式與手機操作頁，不代表已部署、已取得專案權限或已完成實機驗收。只使用 `bxh-hc-test`，Hosting site 使用獨立 `bxh-hc-test-hc01`，不覆寫既有 HC00 Hosting 頁面。正式 ARENA 入口仍關閉。

## 產生候選包

在 repository 根目錄執行（輸出目錄須位於 repository 外、名稱以 hc01-cloud-test- 開頭）：

```sh
node hunter-clash/hc01/cloud/build-bundle.cjs /tmp/hc01-cloud-test-candidate SOURCE_COMMIT_SHA
cd /tmp/hc01-cloud-test-candidate
npm install --no-audit --no-fund
npm run build:web
```

可附第三個參數傳入已填好的 client config JSON；輸入只允許指定測試專案。未提供設定時，產生 `enabled:false`、空 API key／appId／App Check site key 的設定，頁面保持關閉。不能把模板當成已可登入的入口。

CI會驗證本機單玩家 UI 的雙 session 完賽、登入後恢復場次、登出清理及390px版面，並真正安裝固定Firebase SDK後打包。前者使用明確標示的假登入／記憶體fixture，不冒充雲端Auth、App Check或實機。

## 部署前需具備的設定

- 已建立的 `bxh-hc-test` 之可核對部署身分、必要服務與計費設定。
- 在該專案建立獨立Hosting site `bxh-hc-test-hc01`，註冊Web App，啟用測試用電子郵件／密碼登入及對應Auth授權網域。此頁不提供註冊入口。
- 在Web App註冊reCAPTCHA Enterprise App Check provider，填入有效的公開site key；不得以debug token取代實機驗收。
- 使用獨立測試帳號；`hcActors/{uid}` 必須有 `active:true`、`hc01Allowed:true` 與合格role。登入成功不等於取得內測操作權限。
- `hcConfig/runtime` 的 `enabled:true`、`environment:"sandbox"`、`hc01Enabled:true`、明確 `hc01Rules:{version,targetScore}` 與 `hc01PairingTtlMs`（1000–300000）。不得由前端直接修改，也不能用範例自動覆寫現有HC00設定。
- 核對現行Firestore Rules，確定拒絕client直接讀寫 `hc01Challenges`、`hc01Receipts`、`hc01Audit`、`hcActors`、`hcConfig`。候選包刻意沒有Firestore部署設定，避免取代HC00／其他既有規則。

## 傳輸與部署範圍

Function為 `asia-east1/hc01Command`，codebase為 `hc01-isolated-test`。Callable必須可由瀏覽器送HTTPS請求；本候選設定 `invoker:public`，每次操作仍需通過Firebase Auth、強制App Check與服務端測試帳號名單。這不是正式站玩家功能開放。HC00舊候選的private invoker不能直接視為手機可用的證據。

對照Firebase官方 [Callable協定](https://firebase.google.com/docs/functions/callable-reference) 與 [App Check Enterprise設定](https://firebase.google.com/docs/app-check/web/recaptcha-enterprise-provider)。客戶端只呼叫固定測試端點，明確附帶Auth與App Check Token，未知回應保留原requestId；Token不進入QR、自己的pending storage或紀錄。

部署只針對此獨立Function與Hosting site，不能使用本機Emulator的firebase.json部署。Functions與Hosting predeploy都要求GCLOUD_PROJECT精確為bxh-hc-test；runtime另核對SDK專案與環境。套件／建置可先完成，部署需在可核對的專案存取設定下執行，不能因CI通過就將雲端驗收改成PASS。

部署後再提供 `https://bxh-hc-test-hc01.web.app` 作手機內測；目前這只是預定地址，未驗證可用。需記錄部署commit、Auth／App Check／Rules／IAM、真實雙手機流程、斷線重送與撤銷授權結果。關閉 `hc01Enabled` 可停止新操作；保留測試資料供核對。

## 檢查候選包與開通指定帳號

產出的包含有 `tools/check-candidate.cjs` 與 `setup-input.example.json`。SDK打包後執行 `npm run check:candidate`，列出候選程式與Web App設定缺項。輸出中的 `cloudVerified:false` 與 `notVerified` 永遠保留：此工具沒有查詢IAM、Auth provider、App Check registration或雲端部署，不能憑本機檔案宣告雲端PASS。

目前沒有Firebase／Google Cloud操作連接可供此對話直接讀取專案；下列命令需由可存取該專案的操作者在已登入的環境執行。不要把正式站帳號或資料匯入此測試專案。

在測試專案先建立兩個測試Auth帳號，將UID填入 `setup-input.example.json`，另存為 `setup-input.json`。這份檔案不包含密碼、Token或私鑰；規則／TTL須由測試主持者明確選定，範例4分／120秒只屬內測政策。安裝後端依賴後執行：

```sh
npm install --prefix functions --no-audit --no-fund
GCLOUD_PROJECT=bxh-hc-test node functions/hc01/cloud/setup.cjs inspect setup-input.json
# 核對輸出的指定UID、角色與planHash後，使用該次PLAN_HASH：
GCLOUD_PROJECT=bxh-hc-test node functions/hc01/cloud/setup.cjs apply-closed setup-input.json PLAN_HASH
```

`inspect`只讀，不建立帳號或寫入資料。`apply-closed`再次核對Auth及資料庫快照：若角色／設定已變動、帳號停用或凍結，拒絕套用。它只準備指定UID的hc01Allowed與HC01規則，保存現有角色／HC00設定及其他欄位，設定 `hc01Enabled:false`，不啟用全域enabled、不部署、不修改Rules/IAM、不建立挑戰或獎勵。新建runtime預設 `enabled:false`；既有全域enabled保持原值。

取得Web App設定的第一步：[bxh-hc-test專案設定](https://console.firebase.google.com/project/bxh-hc-test/settings/general/)。在「你的應用程式」選Web App，取得 `projectId`、`authDomain`、`apiKey`、`appId`；App Check的Enterprise site key另在該App註冊後取得。只有實際資料齊備並核對上述雲端缺項後，才可設定前端enabled並進行隔離部署／手機驗收。

填妥client config後，以build-bundle的第三個參數重新產生候選包，再打包SDK／檢查；不要直接修改已產出檔案而使manifest校驗失效。
