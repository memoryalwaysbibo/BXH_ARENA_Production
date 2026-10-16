# ARENA 正取 QR 報到候選版

草稿 PR：https://github.com/memoryalwaysbibo/BXH_ARENA_Production/pull/517

尚未合併、部署或啟用。目標是讓正取選手登入後掃碼直接報到，並保留 QR 與人工操作紀錄。所有生效條件仍由伺服器控制，不能用開啟設定代替實際部署與驗收。

## 行為

- 「人員管理 → 現場報到 QR／紀錄」提供開始／停止、全螢幕與最近 100 筆異動；後端保留完整歷史。
- QR 每 45 秒更新，簽章有效 90 秒。重新核對帳號、當前正取池與已連結報名的最新狀態；成功提交後才顯示報到成功。
- 備取不能自行報到。工作人員先移入正取後才可掃碼；報到服務不會升正取，也不以同名匹配帳號。
- 無連結帳號、家庭代報或同一帳號對應多名選手，交由工作人員人工處理。
- 稽核保存選手、帳號、報名識別碼、房號／賽事、伺服器時間、方式、狀態、首次時間與操作人。重複掃碼返回原時間；撤銷與重報另留異動。
- 權限使用現行角色／活動工作人員／合作主辦模型，每次交易重讀帳號、房間指派及必要的上層授權。
- 私人與公開房間的系統關閉、刪除中、取消或封存狀態都阻止新報到；管理者仍可查歷史。

## 抽籤與其他寫入者

已取得 24 個相關部署服務的 1,731 個來源檔，逐一核對 SHA-256、大小與來源世代。固定資料見 `reference/backend-sources-20261016.json`；區域內 106 個函式名稱／世代也已盤點。asia-east1 未部署舊 `autoPromoteWaitlist`，不據此推定其他區域狀態。

`build-writer-packages.py` 驗證全部原始來源後，原子產生逐服務候選套件，拒絕受損來源及覆寫輸出。一般交易保留報到欄位、同步兩份鏡像版本，拒絕單邊投影或一般交易刪除。套件仍標記 `REVIEW_ONLY_NOT_DEPLOYABLE`，不代表所有實際 handler 已完成部署驗收。

抽籤進行中，QR adapter 在驗證身分、簽章與正取資格後，只委派原本的 `checkIn` 動作，維持原抽籤及 runtime revision。內部 `authorizedCheckin` 選項不開放給客戶端，不授予設定、抽籤、遞補、關閉或重開權限。抽籤結束後只改目前名單與 runtime revision，保留歷史抽籤快照。

原抽籤人工報到透過專用 store，把 receipt、稽核、原操作紀錄與雙鏡像放在同一交易。其他抽籤動作保留已有報到。重放不重新報到、不增加稽核。抽籤核心／store 與清理 policy／engine 的正式原始雜湊一旦改變，套件產生器即要求重整合。

過期社群房清理排除 QR 管理房，包含舊清理租約的續跑；一般房維持原清理規則。原本明確授權的整場賽事刪除功能不在此自動保留條件內。

## 生效條件與部署前項目

`systemConfig/qrCheckin` 必須同時有 `enabled=true`、`writerGuardsVerified=true`、明確允許的 `roomCodes`。抽籤房另需 `onsiteIntegrationVerified=true`。預設缺少設定即拒絕，這些設定從不接受客戶端代傳。

部署前須完成各寫入路徑與角色回歸，核對目前來源未漂移，並準備原部署設定一致的 scoped Functions／Rules 發布。Callable、寫入者及 Rules 必須先部署完成，再限測試房啟用；不得只發布 UI 或開啟旗標。簽章值使用 Secret Manager 的 `QR_CHECKIN_SIGNING_KEY`，不得放進前端、Git 或紀錄。

候選 Rules 在原有角色條件外要求雙鏡像 revision 同步，禁止客戶端直接存取 receipt／audit／operation。Rules 不能解析 JSON 字串中的選手欄位，因此不能把此版本配對限制稱為所有管理者異動都無法繞過稽核的證明。

最後仍須驗證正式 Authentication／App Check HTTP 端點、登入返回、手機真機掃碼與紀錄讀回，再擴大房號清單。目前沒有啟用任何正式 QR 房間。

## 驗證

雲端提交 `19957152852d8a4ea0839583a2df22f51d0cd36f`、[Actions 38935771488](https://github.com/memoryalwaysbibo/BXH_ARENA_Production/actions/runs/38935771488) 全部通過：

- 122 項 Node／VM／記憶體交易測試。
- 5 項套件來源與路徑檢查。
- 8 個行動尺寸 Chromium 情境，後端為 mock。
- 30 項 Firestore Emulator 真實交易測試，包括抽籤與 QR 併發、重放、結束抽籤後報到、清理保留與一般房刪除。
- 10 項完整候選 Rules 測試，包含原始正式 Rules 的 metadata 儲存結果對照。

24 個候選套件的所有相對 require 路徑已核對，899 個新增／修改 JavaScript 通過本機語法檢查；這不是實際行為驗證。最新提交另補自動關閉／復原的實際 handler 測試，以其 CI 結果為準。

```sh
node --test qr-checkin/backend/core.test.cjs qr-checkin/backend/onsite.test.cjs qr-checkin/backend/cleanup.test.cjs qr-checkin/backend/guard-firestore.test.cjs qr-checkin/ui.test.cjs qr-checkin/fence.test.cjs tests/community-quick-registration-cloud.test.cjs tests/family-roster-checkin.test.cjs
python3 qr-checkin/build-writer-packages.test.py
python3 qr-checkin/build-rules.py
```

Emulator 限用 `demo-qr-checkin` 與 `127.0.0.1:8091`。CI 分別執行伺服器交易與客戶端 Rules 測試；這些結果不等於正式端點或真機驗收。

## 使用的程式

以 PR 內的實際檔案為準。`frontend.patch`、早期 ZIP 及 `BASELINE.json` 是早期參考快照，不能覆蓋最新分支或直接部署。介面入口是 `modules/main-app/qr-checkin.js`；Callable 入口是 `backend/firebase-callable.cjs`，必須由完成 Admin SDK 初始化的正式入口匯出。
