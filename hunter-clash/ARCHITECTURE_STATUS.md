# HC-00 架構施工與驗收

施工狀態：IN_PROGRESS。2026-09-30 對使用者回報的約 80% 是工程估算，沒有完整工時權重；不由測試數或發布 gate 自動換算，也不代表雲端已驗收。

## 本階段工項

| 工項 | 狀態 | 可核對證據／完成條件 |
|---|---|---|
| 獨立資料與環境邊界 | 本機完成 | demo 固定專案、憑證／遠端位址拒絕、既有生涯與獎勵路徑隔離測試 |
| 狀態、revision 與公開資料契約 | 本機完成 | contracts.cjs 與契約測試 |
| 可信身分、有效角色與當場指派 | 本機完成 | Auth／Functions／Firestore 模擬器測試；正式 Token／IAM 仍待驗收 |
| 交易、收據與補償邊界 | 本機完成 | 並發提交、不同 requestId 結算、同請求重送、原子回滾測試；歷史更正採補償帳本契約，尚未實裝正式更正服務 |
| 獨立操作介面與可重現實驗室 | 本機完成 | Chromium 手機流程與 lab seed／rollback／startup 測試 |
| 發布阻擋與證據採集工具 | 工具完成 | check-release.cjs、runtime-audit.cjs、compare-runtime-rules.cjs；不完整或合成證據不得當成線上 PASS |
| 現行雲端基線與可信來源核對 | BLOCKED | 取得真實 runtime 報告；Rules 名稱／內容雜湊一致；Functions build／revision 與可信部署來源一致 |
| 獨立雲端測試環境與正式授權邊界 | BLOCKED | 提供獨立 Firebase project；完成部署隔離、正式簽章／撤銷、IAM 與 App Check 驗證 |

最後兩項完成後才能宣告 HC-00 完整驗收。目前缺少完整 Functions 來源核對與獨立測試專案，不能用本機測試通過補成雲端驗收。

## 與其他階段的關係

本機提交、認證、人工風險放行與結算串接，是為了驗證架構，涵蓋 HC-01～04 的部分準備工作。QR／近距離配對、獵人執照完整 adapter、一般／認證雙軌及完整防刷引擎不因此宣告完成。
HC-05 工作人員實戰及 HC-06 正式發布另行驗收。發布清單目前 2/7 PASS（約 29%），這是必驗項目比例，不能當成 HC-00 施工完成度。

玩家正式入口保持關閉，HC 功能 PR 保持草稿，未合併或部署。例行工具與文件完善不替代上述雲端完成條件。


## 雲端採集執行路徑

後端唯讀工具 [PR #88](https://github.com/memoryalwaysbibo/BXH_ARENA_Functions_Production/pull/88) 已準備唯讀 runtime workflow，固定官方 GET 與版本 SHA，使用既有 OIDC。18 項本機工具／防護測試及 Push／PR CI 通過；兩次開發 CI 的雲端 job 均為 skipped；後續授權的手動核對結果見下節。
工作流程已經使用者授權合併至後端 main，並透過網頁執行一次手動稽核。現有 GitHub 連線沒有 workflow_dispatch 能力，後續手動啟動仍需網頁。既有部署 workflow、Functions、Rules 與 IAM 都未修改。此採集工具的啟用和 HC 功能發布分開，玩家入口與原發布 gate 保持關閉。


## 2026-09-30 真實雲端核對結果

使用者授權後，PR #88 已合併；run 36696307510 由 main 手動執行。既有 OIDC、Functions v1/v2 與 Rules releases/rulesets 讀取均成功。觀測快照有 0 個第一代、96 個第二代 Functions，分屬 36 個 build，未見 hcSandboxCommand。採集沒有部署或更改 IAM／資料。
原候選 Rules 比對為 MISMATCH，流程正確退出失敗。另從來源 commit ed1fc0d2befd6b9becae3a1e759e887f2645342b 取得相同的現行 Rules 內容，Git blob、SHA-256 與 78,887 位元組均核對一致。該來源的 PR CI 部署 job 為 skipped，不能以此宣告唯一部署來源或完整後端基線。原候選清單與失敗報告保留，不以換掉清單消除差異。
線上證據保存於 [audit/20260930-36696307510](audit/20260930-36696307510)。下一步是 Functions build 與可信部署來源對照、獨立測試專案及正式授權驗收；backendReferenceIsLiveVerified、deployed、entryWired 均維持 false。


## 2026-10-01 02:12（台北）Cloud Build 查詢结果

唯讀擴充 PR #89 已合併至後端 main，commit e20fa91c661f28bb6cc303a748e85c2b2337c7cc；Push／PR CI 皆通過，27 項工具與防護測試（18 舊有＋9 新增）。run 36756766360 手動執行：現有 OIDC、Functions／Rules 採集及 35 個 Cloud Build GET 均成功，未部署 HC 或更動 IAM／資料。

此快照有 98 個第二代 Functions、35 個 build，較前次新增 2 個十月卡牌補發 Functions，另有 13 個既有 Functions 的 build 改變；這是兩個時間點的觀測差異，不代表本次唯讀工作流程部署了它們。仍未見 hcSandboxCommand。Rules ruleset 與內容雜湊與前次一致，但原候選比較仍 MISMATCH；流程在保存 artifact 後正確失敗。

Cloud Build 報告的 sourceProvenance 沒有已解析 commit、儲存來源或來源雜湊，35 筆 COLLECTED 不代表任何一筆來源已驗收。下一步需要可信的已部署來源包或不可變部署來源清單；不能以 build SUCCESS、更新時間或合成測試補成來源證據。另仍缺專用 Firebase 測試專案與正式授權／工作人員驗收。

完整證據見 [audit/20260930-36756766360](audit/20260930-36756766360)，ZIP digest、報告連結 SHA-256 與四檔白名單已核對。HC-00 工程估算仍約 80%；正式發布 gate 與 backendReferenceIsLiveVerified／deployed／entryWired 均未放行。
