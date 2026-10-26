# 三席裁判制：實作候選，尚未部署

每台固定主裁判、備用裁判 1、備用裁判 2。三人共存並有本台操作權，房主／管理員／最高管理員保留全台權限。

- 空位加入；本人點擊後確認退出。
- 點擊他人席位可申請交接。持有人在 ARENA 前景頁面收到確定／取消對話框；申請人看到等待、成功或「對方取消交接」。
- 同台已有席位時交換兩席；無席位者接任，原持有人退出。
- 主裁只可撤銷本台備裁；房主／管理員／最高管理員可撤銷各台三席。
- 交接兩分鐘逾時，席位變更立即使原交接失效；重新連線後讀取雲端結果。
- 修改一律透過 Callable 交易，使用穩定操作 ID、席位版本、伺服器時間與不可由客戶端寫入的稽核紀錄。
- 目前範圍是 BXH 正式個人賽、active staff 及管理員；一般玩家自建房、tester、廠商活動人員與團體賽尚未開放。

## 檔案

`functions/core.cjs` 是可單獨測試的狀態機，`service.cjs` 實作 Firestore 交易，`index.js` 匯出 asia-east1 Callable `manageRefereeSeats`。前端在原裁判台標頭下呈現三席；賽事設定提供切換入口。舊分配非空時拒絕自動搬移，防止錯認主裁；複製房間不得繼承三席或交接請求。

## 上線前必須完成的安全整合

**目前不能宣稱正式計分已完成後端逐台授權。** 原系統將整份 matches 存成一段 JSON；Firestore Rules 無法解析 JSON 逐台檢驗差異。目前新增的規則保護席位／交接資料、拒絕已無任何席位的一般 staff 寫入 data；既有兩條計分交易在讀取雲端時檢查本台三席並使用比分版本拒絕衝突，但這些交易程式仍在瀏覽器執行，不能當成不可繞過的伺服器授權。

因此 Callable 預設拒絕啟用，要求伺服器設定 `systemConfig/refereeSeatsV1` 同時具備 `enabled: true` 和 `perCourtScoringVerified: true`。**不得在尚未將所有計分／修正／離線補送入口接入可信逐台授權後端前，將第二個旗標設為 true。** 此旗標是發布閘門，不是完成該整合的替代品。

仍需把整份 JSON 計分改走可信的逐台命令後端，或拆分為受 Rules 精確保護的逐場文件，然後驗證跨台惡意寫入、被撤銷後的離線補送，以及修正結果／派場的完整相容性。未完成前保留本 PR 為 draft，不能讓正式房間切換。

## 規則候選與部署

`build-rules.py` 接受明確基線，保留原規則所有條件並附加席位保護。已提交的產物是以本 repo 的 QR candidate 產生，並非已核實的最新 live rules。部署前必須先拉取最新 live rules、整合其他正在進行的修復及執行 emulator 驗證；不得把本檔直接覆蓋正式規則。

服務部署是獨立 codebase：`firebase deploy --only functions:referee-seats --project bxh-arena --config referee-seats/firebase.json`（部署前在 functions 安裝鎖定依賴）。目前未執行部署。

啟用後無法由舊版分派編輯器覆蓋席位。公開鏡像只含顯示名稱；UID 與交接請求留在私人文件。既有 callback 寫入以 top-level canonical config 回填 JSON，避免新舊裝置誤覆蓋席位。

## 測試

- `node --test referee-seats/core.test.cjs referee-seats/service.test.cjs`
- `node referee-seats/browser.test.cjs`：需要 Playwright 及 Chromium，使用模擬後端、三個獨立頁面，驗證加入、主備交換、拒絕通知、撤銷、退出與四種寬度。
- `python3 referee-seats/build-rules.py --source qr-checkin/firestore.candidate.rules --output /tmp/referee-seats.rules`

瀏覽器測試不可宣稱為正式 Firebase／實機驗收。
