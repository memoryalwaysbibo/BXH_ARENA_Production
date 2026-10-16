# ARENA 正取 QR 報到候選版

草稿 PR：https://github.com/memoryalwaysbibo/BXH_ARENA_Production/pull/517

此功能尚未合併、部署或啟用。`systemConfig/qrCheckin` 預設不存在即拒絕所有操作；不能以設定 `writerGuardsVerified=true` 代替實際整合。

## 功能

- 人員管理中的「現場報到 QR／紀錄」窗口，可開始、停止、全螢幕及查看最近 100 筆異動；後端保留全部紀錄。
- QR 每 45 秒更新，簽章有效 90 秒。選手登入後掃碼直接報到，伺服器重新檢查當前正取池與已連結報名的最新狀態。
- 備取不得自助報到。工作人員先移入正取，再人工或掃碼報到；報到服務本身不會升正取。
- 記錄選手、帳號、賽事／房號、伺服器時間、方式、操作人。重複掃描返回原時間，不重複寫入稽核；撤銷與重新報到保留首次時間和異動歷史。
- 無帳號、家庭代報及一個帳號對應多名選手，交由工作人員人工處理，避免代掃錯人。
- 權限使用現行部署的活動工作人員授權模型：接受邀請且上層主辦仍有有效授權；每次交易重讀角色、房間指派及上層資料。
- 前端保存入口保留伺服器報到欄位，並拒絕過期 revision。候選完整 Rules 要求原有角色權限及兩份賽事文件的 revision 同步推進，禁止客戶端直接存取稽核、receipt、operation。

## 實際來源與整合

已取回 24 個現行部署服務的 1,731 個來源檔，逐檔核對 SHA-256 與大小。來源世代、雜湊及取得批次記於 `reference/backend-sources-20261016.json`；Firestore Rules 的原始版本與雜湊也已固定。

`build-writer-packages.py --sources <來源目錄> --output <新目錄>` 逐一驗證全部來源後，才原子產生候選套件。各服務保留自己的部署版本；包裝其 Admin SDK Firestore 入口，接入 `backend/guard-firestore.cjs`。輸出明確標記 `REVIEW_ONLY_NOT_DEPLOYABLE`，不是部署授權或覆蓋率證明。來源不符或輸出已存在即拒絕。

目前保護器涵蓋交易內的名單儲存：保留目前報到欄位、同步私人／公開 revision、拒絕單邊投影與一般交易刪除。已用現行 `registrationRosterService` 與核對過來源的名單同步函式進行 Emulator 整合驗證。

## 上線前剩餘工作

1. 已完成區域內 106 個函式名稱／世代的唯讀盤點（Functions PR #142），確認 asia-east1 未部署舊 `autoPromoteWaitlist`；這不表示其他區域的狀態。24 個服務來源已取回並固定，包含獨立部署的自動關閉、復原、結算及清理入口。各服務真實 handler 的寫入路徑與回傳值逐一回歸；直接 document、batch 及刪除修復路徑尚未完整覆蓋，不能把一般交易包裝器視為所有寫入者已驗證。
2. 現場候補抽籤已加入候選整合：進行中的 QR 報到只委派原本 `checkIn` 動作；結束抽籤後保留歷史快照、僅更新目前報到與 runtime revision；原人工報到共用稽核／receipt。必須另外由伺服器設定 `onsiteIntegrationVerified=true`，且仍需完成 Emulator 回歸、打包與部署驗收。客戶端不能開啟這個旗標。
3. 完整 Rules 的其他角色及既有保存流程回歸。Rules 交易配對限制不會解析 JSON 字串中的選手欄位，不能宣稱已單靠 Rules 強制所有管理者的報到異動都經稽核。
4. 部署 Callable、簽章 Secret 與整合後的寫入者；部署前核對來源版本未漂移。簽章值不能進入 Git 或前端。
5. 在明確允許的測試房啟用，驗證實際 Authentication、App Check、手機掃碼、登入返回與紀錄讀回，再擴大使用。

## 驗證證據

2026-10-16，commit `9dc025d4d4ab0d5a110bcb6d0e621a54f0dd82c2` 的雲端工作流程 [38930283842](https://github.com/memoryalwaysbibo/BXH_ARENA_Production/actions/runs/38930283842) 通過：

- 112 項 Node／VM／記憶體交易測試。
- 8 個 Chromium 行動尺寸瀏覽器情境，使用 mock 後端。
- 16 項 Firestore Emulator 真實交易測試，包括原始名單服務、同步函式與上層授權撤銷。
- 10 項候選完整 Rules 的 Emulator 測試。

上述交易測試包含單邊公開投影、後端刪除、原始名單服務與掃碼並行。規則測試已對照原始正式 Rules：既有純 metadata 儲存由原規則拒絕，候選規則結果相同。另有 4 項來源包裝安全測試通過。最新提交另補強選手帳號與操作帳號的稽核快照及畫面區分，須以其 CI 結果為準。候選套件的 24 個服務版本已逐檔驗證，修改／新增 JavaScript 已在本機通過語法檢查；此項不是行為驗證。

```sh
node --test qr-checkin/backend/core.test.cjs qr-checkin/backend/guard-firestore.test.cjs qr-checkin/ui.test.cjs qr-checkin/fence.test.cjs tests/community-quick-registration-cloud.test.cjs tests/family-roster-checkin.test.cjs
python3 qr-checkin/build-writer-packages.test.py
python3 qr-checkin/build-rules.py
```

Emulator 必須使用 `demo-qr-checkin` 與 `127.0.0.1:8091`；CI 的伺服器交易與客戶端 Rules 分開執行。瀏覽器測試需可啟動 Chromium 的環境。上述測試不等於正式 HTTP 端點或手機真機驗收。

## 程式版本

以 PR 內的實際檔案為準。`frontend.patch`、早期 ZIP 及 `BASELINE.json` 是較早的參考快照，不能用來覆蓋最新分支或直接部署。前端入口在 `modules/main-app/qr-checkin.js`；後端入口為 `backend/firebase-callable.cjs`，需由完成 Admin SDK 初始化的正式入口匯出。

## 現場抽籤候選整合（尚未部署）

`backend/onsite/BASELINE.json` 固定現行抽籤核心及 store 的原始雜湊。核心僅增加伺服器內部 `authorizedCheckin` 選項，限 `checkIn`；不授予抽籤、設定、遞補、關閉或重開權限，原 callable 的 payload 白名單仍拒絕此欄位。

`onsite-commit.cjs` 在原交易的純轉移完成後、任何寫入之前讀取 receipt 與上層權限，再把人工異動、稽核與雙鏡像一起提交。其他抽籤動作保留已報到欄位。套件產生器對抽籤服務使用此專用 store，避免一般保存保護器把合法人工報到還原；核心或 store 的正式原始雜湊一旦改變，打包會拒絕並要求重整合。

本機 119 項程式測試與 5 項包裝檢查通過。新增資料庫情境涵蓋抽籤房掃碼去重、人工撤銷／重放、人工與 QR 同時報到、名額調整、抽籤結束後報到、停止／重開、鏡像損毀及偽造開關；雲端結果須以最新提交為準。
