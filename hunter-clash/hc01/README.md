# HC-01：配對與雙方確認施工版

基於最新主線 `3c0f49ea318c978b2dbc29ba9b3d33adb7587f27` 製作。沿用 PR #275 的 runtime-boundary / preflight（來源 `9d29cefaf48e700de14504d9fad94ddbac9f685f`），其餘 HC-00 文件、雲端證據与發布 gate 維持原分支。本 PR 只移植必要隔離依賴，不取代 HC-00 完整驗收。

## 已實作

- 後端隨機一次性配對 Token；challenge 只保存 SHA-256，私人服務收據保存原回應供重送。QR 載荷使用 `bxh-hc01:challengeId:token`，不包含 Auth Token；`renderPairingQr` 可接既有 QRCode renderer。
- create → accept → 双方 start → 逐局提報/另一方確認 → 双方完賽確認。拒絕、取消、過期及爭議保留狀態與稽核。
- 每筆操作綁定 requestId / expectedRevision；同請求重送、跨請求搶碼、確認者與參賽者檢查、角色撤銷及原子收據/稽核交易。
- Firestore adapter 使用可信 Auth token（checkRevoked=true）、服務端 clock 与精確 sandbox 專案邊界。只有 `hcActors.hc01Allowed=true` 的有效測試帳號可操作；普通玩家不因此取得正式入口。
- completed 只表示双方確認的 SELF 一般交鋒紀錄，Rating 尚未發放。無 XP、獵人執照、天梯、信箱或獎勵寫入。
- 獨立雙玩家本機示範頁、QR載荷 parser／renderer bridge，以及本機瀏覽器驗收腳本。

## 驗證與操作

```sh
node --test tests/hunter-clash-hc01.test.cjs
node --test tests/module-seam-contracts.test.cjs tests/enchantment-hunter-ledger.test.cjs tests/hunter-license-grade.test.cjs tests/hunter-loop-p5-ui.test.cjs
node scripts/verify-production-frontend.cjs
node hunter-clash/hc01/local-lab.cjs
# 開啟 http://127.0.0.1:5198
# 需 Playwright + Chromium：
node tests/hunter-clash-hc01-browser.cjs
```

本輪14項HC-01單元測試、14項既有回歸与前端檢查PASS（Node 24.19.0）。單元測試的 memory adapter 序列化原子交易，用來驗證服務邏輯，不冒充實際 Firestore 並發驗收。CI 固定 Node 22，再跑相同測試。
本輪瀏覽器驗收因環境缺少 Chromium executable 未執行成功；新增 CI 瀏覽器 job，通過後仍只證明 local lab，不是 Firebase／雙手機實戰。

本機lab使用固定A/B假身分與記憶體資料；只bind127.0.0.1，Host/Origin檢查拒絕外站操作，關閉後資料消失。介面使用配對資料貼上，QR渲染與攝影機掃碼尚待接入已授權的內測手機入口。示範4分勝/120秒只屬sandbox fixture，不是最終政策核准。

## 待做與發布狀態

1. 真正 Auth/Functions/Firestore emulator 與遠端 `bxh-hc-test` adapter/授權驗證。現有服務未匯出部署Function，沒有部署入口。
2. QR掃描相機、手機HTTPS內測與QR renderer實機驗收；斷線未知結果重送的客戶端controller。
3. 爭議重審／更正流程，目前 disputed 鎖定並保留證據，不支持直接覆寫。
4. HC-03見證與認證來源分流、HC-04防刷/Rating、HC-02獵人檔案adapter、HC-05人員內測與HC-06發布。

正式入口沒有掛載至index；config、IAM、既有正式Rules與部署workflow均未變更。本PR保持draft；FAIL/BLOCKED/NOT RUN不可改成PASS。
