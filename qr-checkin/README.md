# ARENA 正取 QR 報到候選版

狀態：第二版候選程式。已接入正式前端的本機獨立分支 feature/qr-checkin-20261016；未推送 GitHub、未部署、未啟用。此包不是可直接覆蓋上線的版本。

## 已實作

- 人員管理新增「現場報到 QR／紀錄」窗口。
- 開始／停止報到、QR 全螢幕、每 45 秒更新 QR，簽章有效 90 秒。
- 正取選手登入後掃碼直接報到，不再按確認；伺服器重新核對帳號與最新正取／報名狀態。
- 備取不能自行報到；工作人員先移入正取，再人工或掃碼報到。本服務不自行升正取。
- 紀錄選手、帳號、賽事／房號、伺服器時間、QR／人工、操作人；撤銷與重報另留稽核。
- 重複掃描傳回原時間，不新增稽核、不覆蓋首次時間。
- 查閱最近 100 筆異動。所有資料留在後端，並非僅保留 100 筆。
- 非帳號選手由工作人員人工處理；家庭代報及帳號對應多名選手暫交人工，防止代掃到另一名子女。
- 新版前端共用交易保存入口增加 QR revision 檢查：落後畫面不能保存；同版保存保留伺服器報到欄位。已接入 cloud-runtime 原有共用寫入保護流程。
- 附 Firestore Rules 條件草案，要求雙份賽事鏡像一起推進 revision；尚未套用至正式完整 Rules。

## 尚未完成，禁止啟用的原因

正式 Functions 儲存庫 main 未包含現行完整 functions 原始碼；不同功能散落獨立部署分支。目前參考的是 `feature/onsite-waitlist-final-enable-20261009` 的資料形狀，並非已證實與線上所有函式相符的部署快照。

1. 取得正在運作的 Functions 原始碼、Firestore Rules 與各函式實際版本，核對管理員、活動工作人員、合作主辦及上層授權失效規則。本候選權限模型尚未驗證所有正式角色。
2. 將 `preserveCheckins(nextState, receipts)` 接入所有既有伺服器名單／賽事寫入者，在交易內讀取完整 checkinReceipts 並合併。現在只有輔助函式及單元測試，尚未接入線上寫入者。
3. 新版前端共用交易入口已增加 revision 與報到欄位保留邏輯，並有真實 cloud-runtime 方法的記憶體 stub 測試。仍需將 firestore.rules.fragment 合入實際生效的完整 Rules，盤點未經共用入口的客戶端寫入、既有伺服器寫入，以及單文件修復／刪除路徑。未完成前不能只發布 UI 或 Callable。
4. 加入 `checkinReceipts`、`checkinAudit`、`checkinOperations` 專用集合規則：前端不能直接新增／修改／刪除，讀取仍需活動管理權限；檢查廣域 match 不會繞過。
5. 現場抽籤使用另一組 server-owned revision／凍結名單，本候選目前明確拒絕這類房間。需整合原本 manageOnsiteWaitlist.checkIn 後才可支援。
6. Firestore Emulator 驗證真實交易並行、鏡像、規則及舊畫面覆寫；真機測試登入返回、手機掃描、跨帳號、多人同掃、讀回失敗。已備妥 8 個 Playwright 瀏覽器情境，啟動時因環境禁止 Chromium singleton socket 而中止，沒有任何瀏覽器案例可計為通過。真機／Emulator 仍未驗收。

## 後端整合方式（完成上述項目後）

- 將 backend/core.cjs 與 backend/firebase-callable.cjs 放進正式 Functions source 的同一個子目錄，入口匯出 tournamentCheckin。先初始化 Admin SDK，再 require 此匯出。
- 使用 Secret Manager 提供隨機且私密的 QR_CHECKIN_SIGNING_KEY；不得放入前端、ZIP 或 Git。
- Callable 使用 Firebase Authentication、App Check、asia-east1。前端已接入既有 tournamentOperation 與 App Check 路徑。
- 正式 writer guards、權限及 Emulator 全數驗證完成後，才可設定 systemConfig/qrCheckin：enabled=true、writerGuardsVerified=true、roomCodes=[明確允許的測試房號]。預設不存在或缺任一條件均拒絕。
- 先單一測試房驗收，再擴大房號清單。不能用 writerGuardsVerified=true 取代實際整合。

## 驗證

執行 `node --test qr-checkin/backend/core.test.cjs qr-checkin/ui.test.cjs qr-checkin/fence.test.cjs tests/community-quick-registration-cloud.test.cjs tests/family-roster-checkin.test.cjs`。

瀏覽器情境：`node qr-checkin/browser.cjs`。需 Playwright 與可啟動 Chromium 的環境；可用 PLAYWRIGHT_CHROMIUM_EXECUTABLE 指定執行檔。

2026-10-16 第二版結果：96 項本機測試通過，包含 41 項 QR 核心／VM／寫入保護案例，以及 55 項既有雲端名單與家庭報到回歸案例。雲端交易測試使用記憶體 stub，不是 Firestore Emulator。

四份新增／修改 JavaScript 已通過 node --check：主程式、cloud-runtime、新 QR 介面、Firebase adapter。

## 檔案使用

`frontend.patch` 修改目前已確認的三個前端檔案及一份既有測試檔，避免覆蓋整份 core.js。套用前須核對 BASELINE.json，並處理同時進行中的其他修改。另加入 modules/main-app/qr-checkin.js 與 modules/main-app/qr-checkin-fence.js。候選版先保持未發布。

後端核心傳入的時間、帳號、角色、名單、設定、receipt 與 operation 必須全由 adapter 的可信讀取提供，不接受客戶端代傳。成功訊息必須在伺服器交易提交後才能顯示。
