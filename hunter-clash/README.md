# HC-00｜Architecture｜系統架構

獨立交鋒基礎模組。預設入口關閉，尚未掛載至 ARENA，沒有雲端寫入或部署。
自動模式持續完成可執行工作；例行進度與文件不是等待使用者確認的停點。

## 已實裝

- 純函式契約：內部入口、帳號狀態、環境一致性、狀態轉移與 revision 衝突拒絕。
- 結算鍵與 verified / risk clear 前置條件；結算鍵尚未接上資料庫交易，不能宣稱 exactly-once 已驗證。
- 公開資料白名單投影；不輸出 UID、email、私人參賽者或風險證據。
- 發布 gate：必要項目必須全部明確 PASS。FAIL、BLOCKED、未執行均不能放行。
- 9 個契約測試；另執行 3 份既有 Hunter 回歸測試。CI 不觸發正式部署。

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

`server/sandbox-service.cjs` 僅能在 demo-hunter-clash 的 Auth／Firestore 模擬器使用，沒有 Functions 匯出或正式寫入 adapter。
Token 經 Admin SDK 驗證並檢查停用狀態；角色、入口設定及指派從資料庫讀取，忽略客戶端角色宣稱。
提交與結算以 requestId／內容指紋、revision 及 Firestore 交易處理。結算帳本、稽核、兩名玩家的 hcSandboxStats 與狀態同時提交；失敗時全部回滾。
只記錄 sandbox 比賽次數與勝場，不寫入既有 Hunter 生涯、XP、天梯、信箱或獎勵。
認證及風險放行必須綁定同一結果版本，認證者必須有效、受指派且非參賽者。
已實裝 sandbox beginVerification、verifyResult 與 reviewRisk。完整流程測試從提交開始，透過實際服務認證與放行，再結算；個別結算故障測試仍使用 fixture。
認證限指定且非參賽的有效內部見證者；風險審查限指定且非參賽的有效管理者，必須填理由並綁定結果版本。此角色配置是 sandbox 測試契約，尚未定為正式營運政策。
認證通過仍維持 risk hold，人工放行才可結算；爭議結果不得放行，已結算結果不得再改審查。重送共用交易收據，並發審查只接受一個預期版本。
HTTP/callable、正式 IAM 與玩家介面尚未實裝。
本機測試：21 項契約及既有回歸 + 24 項真正 Auth／Firestore 模擬器測試，共 45 項通過。
包含兩端同時提交只接受一個版本、8 路不同 requestId 結算只入帳一次、重送一致性及失敗回滾。
這些是 demo 範圍證據，不能把 checkpoint 的正式／端到端驗收欄位改成完整 PASS。
