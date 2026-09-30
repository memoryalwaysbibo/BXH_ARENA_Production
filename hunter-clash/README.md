# HC-00｜Architecture｜系統架構

獨立交鋒基礎模組。預設入口關閉，尚未掛載至 ARENA，沒有雲端寫入或部署。
自動模式持續完成可執行工作；例行進度與文件不是等待使用者確認的停點。

## 已實裝

- 純函式契約：內部入口、帳號狀態、環境一致性、狀態轉移與 revision 衝突拒絕。
- 結算鍵與 verified / risk clear 前置條件；已接上 demo Firestore 交易並驗證並發與重送，正式 runtime 尚未驗收。
- 公開資料白名單投影；不輸出 UID、email、私人參賽者或風險證據。
- 發布 gate：必要項目必須全部明確 PASS。FAIL、BLOCKED、未執行均不能放行。
- 契約、傳輸、隔離與唯讀核對測試；另執行 3 份既有 Hunter 回歸測試。CI 不觸發正式部署。

## 整合契約

HC-01 使用専用 hcChallenges / hcResults，後端從 Auth 取得身分，不能信任請求內角色。
HC-02 透過 adapter 讀既有 Hunter match.log，保留既有生涯資料；不清零、不自行加入天梯或 XP。
HC-03 認證必須綁定結果 revision；見證者不得為當場參賽者。
HC-04 風險 hold 阻止結算；清除風險須留下處理者與理由。
HC-05 使用 emulator 或独立 Firebase 測試專案；欄位標記不能取代環境隔離。
HC-06 驗證完整後才允許發布。內部角色亦須後端授權。

建議狀態：proposed → accepted → in_progress → submitted → pending_verification → verified → settled。
風險、爭議、取消、拒絕、過期皆使用明确分支；已結算更正走補償帳本，不直接改寫歷史。
離線只保存待送草稿；正式確認、時間與結算由伺服器決定。

## 基線與後端證據

前端基線與待辦見 checkpoint.json。當前正式 Functions main 只有 bootstrap / workflow。
已找到 release/production-rc1-stage5 的 Rules 與 Functions；這是歷史參考，不等於部署中的版本。
該 Rules 具有既有賽事、天梯、測試天梯與公開投影的個別權限，沒有此新 HC 模組的授權契約。
不得把歷史 Rules 整份覆蓋至正式站，也不得從 Beta 分支直接部署。

## 驗證

```sh
node --check hunter-clash/contracts.cjs
node tests/hunter-clash-contracts.test.cjs
node --test tests/enchantment-hunter-ledger.test.cjs tests/hunter-license-grade.test.cjs tests/hunter-loop-p5-ui.test.cjs
```

契約測試 PASS 只代表本地契約成立。資料庫隔離、可信授權、重送、並發、實戰仍待後續驗證。
此分支可作為後續工作檢查點；不表示 HC-00 完整驗收或下一聊天已自動喚醒。

## 獨立 Firestore 模擬器

`hunter-clash/emulator` 固定使用 `demo-hunter-clash`、127.0.0.1:8180 及 Java 21。
先執行 `npm ci --ignore-scripts`，再執行 `npm test`。正式專案、憑證或遠端模擬器位址會被拒絕。
Rules 僅允許有效且被指派的內部角色讀取 sandbox 挑戰，所有客戶端寫入與既有生涯、天梯、信箱路徑皆拒絕。
此 Rules 是新模組的測試檔，禁止整份覆蓋 ARENA 正式 Rules。

已執行 6 項真正 Firestore 模擬器測試，加上 21 項契約及既有 Hunter 回歸測試。
這不證明正式 IAM、Functions 授權、伺服器交易、重送、並發結算或內部實戰已完成。
後端候選 commit `462287fdb86f6df6b71a0966c25405ca925fcdc7` 的 run `36668868791` 僅驗證成功，部署步驟均 skipped。
發布檢查繼續拒絕缺少部署／線上核對證據的發布。

## Sandbox 交易服務

`server/sandbox-service.cjs` 僅能在 demo-hunter-clash 的 Auth／Firestore 模擬器使用，沒有正式寫入 adapter；callable 匯出另放在 emulator/functions.cjs，只允許模擬器。
Token 經 Admin SDK 驗證並檢查停用狀態；角色、入口設定及指派從資料庫讀取，忽略客戶端角色宣稱。
提交與結算以 requestId／內容指紋、revision 及 Firestore 交易處理。結算帳本、稽核、兩名玩家的 hcSandboxStats 與狀態同時提交；失敗時全部回滾。
只記錄 sandbox 比賽次數與勝場，不寫入既有 Hunter 生涯、XP、天梯、信箱或獎勵。
認證及風險放行必須綁定同一結果版本，認證者必須有效、受指派且非參賽者。
已實裝 sandbox beginVerification、verifyResult 與 reviewRisk。完整流程測試從提交開始，透過實際服務認證與放行，再結算；個別結算故障測試仍使用 fixture。
認證限指定且非參賽的有效內部見證者；風險審查限指定且非參賽的有效管理者，必須填理由並綁定結果版本。此角色配置是 sandbox 測試契約，尚未定為正式營運政策。
認證通過仍維持 risk hold，人工放行才可結算；爭議結果不得放行，已結算結果不得再改審查。重送共用交易收據，並發審查只接受一個預期版本。
已完成模擬器 HTTP/callable 與客戶端 SDK 驗證；正式 IAM 與玩家正式入口尚未完成；內部本機介面已通過瀏覽器測試。
本機測試：33 項契約、傳輸／隔離防護、唯讀採集器與既有回歸 + 38 項真正 Functions／Auth／Firestore、瀏覽器與 lab 測試，共 71 項通過。
包含兩端同時提交只接受一個版本、8 路不同 requestId 結算只入帳一次、重送一致性及失敗回滾。
這些是 demo 範圍證據，不能把 checkpoint 的正式／端到端驗收欄位改成完整 PASS。


## Callable 傳輸邊界

emulator/functions.cjs 使用官方 firebase-functions 7.4.0 onCall，僅提供 hcSandboxCommand，固定 demo project 與本機 5003 / 9098 / 8180。
請求格式為 `{operation, input}`，operation 僅允許 getChallenge、submit、beginVerification、verifyResult、reviewRisk、settle；input 使用既有服務的 challengeId、requestId 與版本契約。
SDK 傳入的 Auth 身分不能替代服務的 verifyIdToken(token, true) 與資料庫角色檢查；客戶端 uid／role 不接受。未知內部錯誤只回傳通用 internal，不暴露 Token、stack 或資料。
已用 Firebase 客戶端 SDK 經 Functions 模擬器完成實際提交、認證、風險放行與四路並發結算，帳本仍只有一筆。另驗證無效／缺少 Token、停用帳號、未指派角色、舊版本、重用 requestId 與 malformed callable protocol。
run-tests.cjs 在啟動 CLI 前阻擋正式專案／憑證，並停用 metadata credential discovery；firebase.json predeploy 無條件拒絕部署，bootstrap 在非模擬器或非 demo 環境拒絕載入。
模擬器 Auth 的 unsigned Token、Functions debug 行為不代表正式簽章、安全 IAM、App Check、撤銷傳播或負載測試已驗收。入口、發布 gate 與完整端到端欄位仍關閉；此階段未改正式 Functions repository。


## 內部本機介面

frontend/index.html / app.mjs / style.css 是獨立的測試操作頁，未接入 ARENA 首頁、選單、正式登入或 Service Worker。
frontend/serve.cjs 只綁定 127.0.0.1:5199 並只提供三個白名單資產；頁面固定使用 demo Auth 與 callable 本機端點，離開指定 origin 即禁止登入。
getChallenge 在伺服器交易中檢查有效內部角色、入口與當場指派，僅回傳顯示需要的欄位；不開放廣泛查詢、不暴露 privateNote 或直接放寬 Firestore 客戶端讀寫。
畫面依伺服器身分／指派與最新狀態控制操作。所有變更先確認；舊版本拒絕後要求重新讀取。Token 僅保留記憶體，不写入 localStorage／sessionStorage，登入後立即清空密碼欄。
未知網路錯誤保留原 operation / requestId / input，重送同一筆；已確認操作但刷新失敗則僅要求重新讀取，避免把確認結果誤當成尚未完成。

`npm ci --ignore-scripts`、`npx playwright install --with-deps chromium`、`npm test`（在 emulator 目錄）可重跑全部後端及瀏覽器檢查；Playwright 固定 1.58.2。
自動測試會啟動本機操作頁、建立測試身分與挑戰、跑完後清理及關閉頁面伺服器。手動啟動頁面可用 `node hunter-clash/frontend/serve.cjs`，需另啟 demo Auth／Functions／Firestore，並事先準備受指派的 sandbox 帳號與挑戰。
已執行五項真實 Chromium 390px 手機視窗測試：參賽／見證／管理者完整流程、结算回應遺失後原請求重送、取消與撤權、舊畫面競爭提交與讀取欄位白名單、已確認結算但刷新失敗。已查看中文字型完整的手機截圖並確認無橫向溢出。
這是自動化本機證據，尚未等同工作人員現場實戰、正式 IAM、部署核對或公開入口驗收；internalBeta 與正式 entryWired 維持 NOT RUN / false。


## 可重現的臨時實驗室與部署核對

在 emulator 目錄執行 `npm run lab`，可同時啟動三種 demo 模擬器、本機操作頁、四個臨時測試身分與全新挑戰。每次產生獨立 ID，拒絕改開已關閉的 runtime；Firestore 初始化批次失敗時只清理此次 Auth 使用者。已實際啟動並讀取操作頁，另通過建立、登入、指派讀取、不覆寫既有資料及失敗回滾測試。
完整手動操作與待測標準見 INTERNAL_BETA.md。這仍是本機準備，不表示已取得遠端人員實戰或獨立專案的部署證據。
部署核對快照見 deployment-audit.json：目前候選 run 的 Functions／Rules 仍 skipped，沒有找到該工作流的 workflow_dispatch 執行；個別 playerCardService、HUNTER LOOP 等部署步驟成功只代表各自 scope，不證明 HC 的整包來源與現行 Rules 一致。
尚缺直接 GCP runtime／Rules release 核對、獨立測試專案與人員現場驗收。此快照不得當成 backendReferenceIsLiveVerified 或完整內部實戰 PASS。


## 唯讀 runtime 採集器

`runtime-audit.cjs` 已完成七項注入回應測試，涵蓋 GET 與 Token 保護、分頁、跨專案參照拒絕、不完整區域、API 錯誤及 Rules 雜湊。採集器不更動 checkpoint／發布 gate；完整操作與人工核對標準見 [RUNTIME_AUDIT.md](RUNTIME_AUDIT.md)。目前執行環境沒有 gcloud，尚未取得實際雲端資料；正式 runtime 證據仍待取得。
