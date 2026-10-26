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

`functions/core.cjs` 是可單獨測試的狀態機，`service.cjs` 實作 Firestore 交易，`index.js` 匯出 asia-east1 Callable `manageRefereeSeats` 與 `commitRefereeCommand`。前端在原裁判台標頭下呈現三席；賽事設定提供切換入口。舊分配非空時拒絕自動搬移，防止錯認主裁；複製房間不得繼承三席或交接請求。

## 後端計分與調度整合進度（第三版）

已新增 `commitRefereeCommand` Callable。手機只傳固定命令及席位／比分／派場版本、當場兩位選手，伺服器重讀正式資料與使用者資格、驗證本台權限，再重算比分與晉級；不接受手機上傳完整 state、比分或回合紀錄。

已接線：旋轉／擊飛／爆裂／極限得分、失誤、撤銷、重賽、確認結果、簡易判定、安全修正／撤回結果、準備／開始／暫停／恢復、跳過。每個命令有操作 ID 去重、比分版本及席位世代檢查；主裁與備裁同時操作舊版本時只會一筆成功。

Firestore 候選規則現在拒絕所有一般 staff 直接寫入三席房的私人 JSON 或公開 bracketView，即使仍占有席位也不能繞過 Callable；場主／管理員保有原本的本場管理能力。舊瀏覽器計分交易及離線 snapshot 補送在三席房直接回覆 `seat-command-required`。新三席計分目前要求在線，不在斷線時假裝計分成功或新建離線 snapshot。

伺服器的晉級／修正引擎由受版本控制的純函式產生，隨函式包部署，不執行請求提供的程式碼。`tools/build-engine.cjs` 及 `engine/manifest.json` 保留來源函式與純模組雜湊，CI 重新產生後必須無差異。已測單淘晉級、季殿門檻、雙敗總決賽重置、循環賽排名與下游已有實際比分時禁止撤回。

已將空台承接、跳過場次承接、手動派台、交換、強制退場、重新開台、脫離場次承接、退役轉台及增減台接至同一命令後端。換台要求相關兩台權限與版本；有實際比分／失誤的目標台不得覆蓋。增減台僅接受明列的一般場地資訊，其他設定變更須分開儲存。PASS 等待中的場次及前置場次暫時阻擋移台與退場，等待鏈未完成時阻擋增減台，避免遺失依賴。遞延場次在所有前置場次完成前，同樣禁止簡易判定、確認、開始／恢復及重賽等命令，避免從其他入口提早結束等待。

CALL／PASS 沿用既有獨立後端及原本推播，不調整既有 PASS 規則。舊權限投影含房主與三席持有人，房主不占第四席；撤銷後立即移除本台權限。整合測試使用雜湊鎖定的既有 CALL 服務來源，串接實際 emulator 的交接、PASS、計分與自動回叫。

仍維持 draft 與預設關閉。尚未部署正式 Callable／Rules，尚未完成最新 live rules 整合、實機網路中斷與正式房相容性驗收。

伺服器設定 `systemConfig/refereeSeatsV1` 必須同時有 `enabled: true`、`perCourtScoringVerified: true` 才能啟用；未完成所有入口與正式規則整合前，不可設定旗標。測試中的旗標僅存在 demo emulator。

## 規則候選與部署

`build-rules.py` 接受明確基線，保留原規則所有條件並附加席位保護。已提交產物改以 2026-10-26 18:03:35 UTC 的正式規則唯讀快照產生；來源為 Functions run 40374239019 的 artifact 12672839053，雜湊及 ruleset 證據記於 `reference/firestore.production-20261026.json`。保留目前正式版兩處 `qrCheckinRevision` 名單修復。部署時必須再次讀取 live rules，比對快照 SHA-256；不一致就停止並重新整合，不得覆蓋同時發布的其他修復。

服務部署是獨立 codebase：`firebase deploy --only functions:referee-seats --project bxh-arena --config referee-seats/firebase.json`（部署前在 functions 安裝鎖定依賴）。目前未執行部署。

啟用後無法由舊版分派編輯器覆蓋席位。公開鏡像只含顯示名稱；UID 與交接請求留在私人文件。既有 callback 寫入以 top-level canonical config 回填 JSON，避免新舊裝置誤覆蓋席位。

## 測試

- `node --test referee-seats/core.test.cjs referee-seats/service.test.cjs referee-seats/scoring.test.cjs referee-seats/dispatch.test.cjs referee-seats/scoring-bridge.test.cjs`
- `node referee-seats/browser.test.cjs`：需要 Playwright 及 Chromium，使用模擬後端、三個獨立頁面，驗證加入、主備交換、拒絕通知、撤銷、退出與四種寬度。
- `python3 referee-seats/build-rules.py --source referee-seats/reference/firestore.production-20261026.rules --output /tmp/referee-seats.rules`

另有 `full-rules.test.cjs` 直接載入完整候選規則，驗證裁判直接寫入被拒、場主管理保留、管理員不可竄改席位，以及各角色不可讀寫收據／稽核。這不代表已核對最新正式規則。

瀏覽器測試不可宣稱為正式 Firebase／實機驗收。
