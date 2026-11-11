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

2026-11-11 已核對使用者擷取的完整來源：`familyregistration-00042-wor`、`registrationqueuev2-00003-kur`，來源 archive 與 handler 雜湊固定在 `release-inputs.json`。名稱測試可用 `BXH_NAME_SOURCE_ROOT=/path/to/current/family/module node --test tests/community-name-mode.test.cjs` 載入完整現行相依模組，只替代 Firebase SDK 的時間戳值及資料庫；現場備取與密碼房防護使用實際模組。一般入口通過 14 項，V2 handler 通過 13 項，V2 不適用的一般入口隔離測試略過。這些是 handler 測試，未宣稱正式站或 V2 佇列端到端驗收。

`python3 -B community-name-mode/stage-live.py --output /new/private/folder` 在已登入的 Cloud Shell 執行。工具只讀取七支函式的設定及固定世代來源、在本機組裝候選，不送出雲端變更。主要兩支須吻合上述完整 archive；其他五支 V2 函式須逐檔吻合已核對的 family 模組及所有相依檔，入口與其他模組沿用各函式自己的當前來源。任何不同均停止。每份候選僅替換 family handler 名稱運算並新增同目錄 helper，其餘檔案內容完全一致。輸出包含原始包、候選包、設定快照與 manifest，供後續只更新 source 的發布與回復核對使用。此工具沒有部署功能；產生候選後仍須以現行來源與設定核對發布結果，先完成後端再發布前端。
