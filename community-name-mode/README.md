# 一般房參賽名稱

候選，尚未部署。快速開房提供本名、ID、不限，預設本名。不限依會員個人資料的名稱偏好；兒童使用自己的本名與暱稱，偏好未設定時沿用監護人的名稱偏好。ID 空白時使用本名。房主也按相同規則加入名單。報名時保存名稱快照，名單投影、樹狀圖與裁判台沿用選手名稱，不因之後修改會員資料而改名。既有報名不重寫。積分場設定不變。

發布前必須先更新目前正式 `familyRegistration` handler。用即時擷取的完整部署來源，保留該版本現有 QR、V2、權限、操作回執、交易與入口設定。以獨立核對的來源 SHA-256 執行：

```sh
node community-name-mode/prepare-family.cjs /path/to/live/family-registration.js EXPECTED_SHA256 > /path/to/staged/family-registration.js
cp modules/main-app/participant-names.js /path/to/staged/participant-names.js
node --check /path/to/staged/family-registration.js
```

工具只輸出單一名稱運算的候選替換，不部署、不替換完整舊版 handler。來源雜湊不符、名稱運算錨點消失或出現多次都停止。不得以測試快照當作目前正式來源。V2 worker 若打包自己的 family handler，必須對該完整來源分別套用、驗證及部署；不能只更新舊版 callable 就啟用 V2 房的不限模式。

後端與實際部署包相依檔驗證後才發布前端。前端須清除舊快取載入新的 helper、core、cloud runtime 與 community-host。正式驗收包含三模式、本名與 ID 不同的本人、未設定 ID、家庭兒童、重新讀取名單、抽籤後樹狀圖與裁判台，以及既有積分場。現有 community 公私文件規則已允許參賽名稱欄位；本候選不修改 Rules、不新增索引，開房與報名不增加額外服務呼叫。

2026-11-11 已核對使用者擷取的完整來源：`familyregistration-00042-wor`、`registrationqueuev2-00004-dez`，來源 archive 與 handler 雜湊固定在 `release-inputs.json`。名稱測試可用 `BXH_NAME_SOURCE_ROOT=/path/to/current/family/module node --test tests/community-name-mode.test.cjs` 載入完整現行相依模組，只替代 Firebase SDK 的時間戳值及資料庫；現場備取與密碼房防護使用實際模組。一般入口通過 14 項，V2 handler 通過 13 項，V2 不適用的一般入口隔離測試略過。這些是 handler 測試，未宣稱正式站或 V2 佇列端到端驗收。

`python3 -B community-name-mode/stage-live.py --output /new/private/folder` 在已登入的 Cloud Shell 執行。工具只讀取七支函式的設定及固定世代來源、在本機組裝候選，不送出雲端變更。主要兩支須吻合上述完整 archive；其他五支 V2 函式須逐檔吻合已核對的 family 模組及所有相依檔，入口與其他模組沿用各函式自己的當前來源。任何不同均停止。每份候選僅替換 family handler 名稱運算並新增同目錄 helper，其餘檔案內容完全一致。輸出包含原始包、候選包、設定快照與 manifest，供後續只更新 source 的發布與回復核對使用。此工具沒有部署功能；產生候選後仍須以現行來源與設定核對發布結果，先完成後端再發布前端。

已比對 V2 00003 與 00004：只有 index.cjs 的試點房間／退役房間設定與 bindings.cjs 的多個退役房間支援改變。family handler 與相依模組全部相同。候選沿用 00004 的完整入口與 bindings，不重寫試點或退役設定。

`release.py` 固定本次 Cloud Shell 組裝 manifest 的 SHA-256 `8b8072bbc7760ed2f5d77c9670d94b12c9b5b2e8d71a7b6e439f7af6b1b41abf`。`--check` 重建名稱替換並核對七份本機候選的所有檔案、線上版本／來源 archive 與服務設定，只有讀取。`--apply` 再做完整核對後逐支上傳來源，Cloud Functions API 的 PATCH 僅指定 `updateMask=buildConfig.source`。每支完成後下載已部署 archive 核對完整雜湊與服務設定，最後再核對七支狀態。原始 ZIP 與設定快照保留在組裝資料夾，前端需另行發布。

發布工具以檔案鎖與同步寫入的 journal 記錄進度。中斷後使用 `--status` 查看、`--resume` 接續；已送出但回應遺失的更新不會再次送出，會先讀回來源判斷。發現外部更新、未知提交結果或不同的部署內容即停止，不自動回復或覆蓋。`--apply` 不接受已存在的發布 journal。

發布狀態測試涵蓋七支正常更新、部署前版本改變、上傳後競爭、已知操作接續、提交回應遺失、未確認提交不重送、部署後來源／設定不同，以及重複執行保護。另使用本次實際來源做七份本機候選驗證與模擬 Cloud 發布／接續測試；未在本機進行正式 Cloud 更新。

第一次正式發布停在 familyregistration-00043-xet 的容器啟動檢查；Cloud Run 顯示 latestReadyRevisionName 為 00042-wor、100% 流量仍指向 00042。其餘六支未開始更新。候選在 Cloud Shell Node 26 可載入並使用 Functions Framework 監聽，但該結果不能作為 Node 22 的證明。

`diagnose-startup.py STAGING` 固定上述 manifest，在本機暫存目錄分別解開原始與候選來源，用相同的 SDK 依賴與 Framework，並使用 npm 安裝的 Node 22 實體執行檔做 TCP 啟動比較。它只連線本機隨機連接埠，不發出 callable 請求；測試後停止伺服器並清理暫存目錄。另唯讀輸出 00042／00043 的容器啟動設定及環境欄位變更名稱，隱藏其他環境變數值。這是啟動診斷，沒有部署或流量更新功能。
