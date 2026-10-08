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
node --test tests/hunter-clash-hc01.test.cjs tests/hunter-clash-hc01-client.test.cjs tests/hunter-clash-hc01-callable.test.cjs
node --test tests/module-seam-contracts.test.cjs tests/enchantment-hunter-ledger.test.cjs tests/hunter-license-grade.test.cjs tests/hunter-loop-p5-ui.test.cjs
node scripts/verify-production-frontend.cjs
node hunter-clash/hc01/local-lab.cjs
# 開啟 http://127.0.0.1:5198；同機雙玩家示範，非手机遠端網址
# 需 Playwright + Chromium：
node tests/hunter-clash-hc01-browser.cjs
```

目前23項HC-01單元測試（服務／控制器／相機／Callable transport）、14項既有回歸與前端檢查已在本機通過。CI固定Node 22。前一批提交b323426的HC01瀏覽器CI與整站RC1 CI已通過；本批新增Emulator驗證，以最新提交的CI結果為準。

本機lab使用固定A/B假身分與記憶體資料；只bind127.0.0.1，Host/Origin檢查拒絕外站操作，關閉後資料消失。介面已支援QR顯示、相機掃碼及原請求重送。示範4分勝/120秒只屬sandbox fixture，不是最終政策核准。

## 真正Firebase Emulator驗證

`emulator/`為獨立Auth／Firestore／Functions測試入口；只允許demo-hunter-clash及127.0.0.1固定埠。Functions初始化guard和predeploy拒絕部署，不能用這份firebase.json部署雲端。

```sh
cd hunter-clash/hc01/emulator
npm install --no-package-lock --no-audit --no-fund
node run-tests.cjs
```

需Node 22與Java 21；使用HC00已採用的固定Firebase套件版本。CI自動啟動Emulator並測試真實ID Token、Callable、交易搶碼、同請求並發重送、停用帳號／allowlist撤銷、關閉開關、私人收據／設定／挑戰的client讀寫拒絕，以及完整雙人完賽且不影響生涯／天梯／郵件。`callable.cjs`只負責驗證transport並對已知錯誤分類，未知SDK錯誤不公開內部資料。

這不是bxh-hc-test雲端部署或實機手機驗收。雲端Function需另行提供只允許bxh-hc-test的部署包與存取設定，不能取消Emulator入口guard改作部署。

## 待做與發布狀態

1. 完成新增Auth/Functions/Firestore Emulator CI驗證，再串接遠端 `bxh-hc-test` adapter／授權；測試專案已由擁有者建立，仍待存取設定。
2. 手機HTTPS內測與QR／相機／斷線恢復實機驗收；controller与本機掃碼已實作。
3. 爭議重審／更正流程，目前 disputed 鎖定並保留證據，不支持直接覆寫。
4. HC-03見證與認證來源分流、HC-04防刷/Rating、HC-02獵人檔案adapter、HC-05人員內測與HC-06發布。

正式入口沒有掛載至index；config、IAM、既有正式Rules與部署workflow均未變更。本PR保持draft；FAIL/BLOCKED/NOT RUN不可改成PASS。

## 2026-10-07 第二批：掃碼與未知回應恢復

新增 controller.mjs、scanner.mjs 與独立lab.mjs。建立挑戰后顯示真實QR，camera可使用BarcodeDetector或本地jsQR pixel fallback；掃到有效載荷僅填入配對資料，由使用者再接受。拒絕不相關QR。stop／pagehide／背景化與取消權限等待後都釋放camera tracks。

未知網路回應保留同一requestId/input，阻止新mutation並提供「重送原操作」。sessionStorage僅保留同帳號待送操作（最多10分鐘），不保存Bearer Token；跨帳號／登出清除pending，舊session回應不再顯示。未收到結果不會假稱成功；刷新是讀取狀態，不會消除待確認請求。

QR依賴及license保存在vendor，單機驗收不依赖外部CDN。新增6項控制器/掃碼測試，合計20項HC-01測試；浏览器脚本新增實際QR像素解碼及「伺服器已建立但回應遺失→刷新頁面→重送同請求」情境。真实手机相机权限/iOS/Android实机、远端Auth/Firestore仍待验收，不能以local假身分测试代替。

前一批最新head a438969 的HC-01 CI与完整前端RC1 CI皆SUCCESS。第二批需以新head的CI結果為準。

## 比分核對與撤銷
爭議操作回到 score_review，保留配對及得分，暫停確認完賽。建立者可撤銷上一筆（含未確認的舊版小局），更正後按核對完成回到記分或完賽確認。所有撤銷保留原始得分證據；每次修正清除既有結果確認，新版結果必須雙方重新確認。已完賽與歷史 disputed 終止紀錄不可改寫。

### PK 戰績（隔離測試版）

`getMyHistory` 只讀取已驗證 Auth UID 的 `hc01PlayerRecords/{uid}`，不接受其他玩家 UID。雙方最終確認與兩位玩家的勝敗摘要在同一交易中保存；receipt 重送不重複累計。首頁「我的 PK 戰績」顯示累計場次、勝敗、勝率及最近 50 場名稱／比分／時間，完整對戰仍保存於 hc01Challenges。切換帳號、登出會清除畫面與取消舊請求。

摘要從此版本的新完賽開始累計；舊測試完賽尚未回填，取消／未完成／比分核對中的對戰不計入。不寫入正式獵人執照、XP、天梯或稱號。
