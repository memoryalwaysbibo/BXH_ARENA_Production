# 裁判證後端開發候選

此目錄是獨立 `referee-certificates` Functions codebase，尚未部署、未啟用，沒有資料遷移腳本或真人預設數據。入口為 `asia-east1` 的 Callable `refereeCertificateService`。每次請求均在交易內確認 `systemConfig/refereeCertificatesV1.enabled === true`；未設定時預設關閉。

## 測試

不需 Firebase 依賴或網路的純計算及交易 mock 測試：

```sh
node --test referee-certificates/test/*.test.cjs
```

Firestore 實際交易與規則測試獨立執行，不納入上述 glob。依賴由外部隔離目錄提供，不加入正式 functions dependencies：

```sh
NODE_PATH=/tmp/bxh-referee-test-deps/node_modules /tmp/bxh-referee-test-deps/node_modules/.bin/firebase emulators:exec --only firestore --project demo-referee-certificates --config referee-certificates/firebase.emulator.json 'node --test referee-certificates/emulator/service.emulator.cjs'
```

測試程式拒絕缺少 loopback emulator host，或使用其他 project。所有測試身分與活動皆為程式建立的虛構資料；不查詢正式 Firebase。Mocks 會檢查先讀後寫、文件及 query 衝突重試、原子提交。

2026-10-29 本機實測：純 Node 測試 32 項（domain 5、sources 10、service 17）通過；Firestore Emulator v1.19.8 的 5 項整合測試通過，涵蓋並行發證／永久證號、回補與收據原子性、裁判長唯一性、有效私人來源及待完成活動、本人與管理員直連 SDK 均不可讀寫新集合。實測 Node 為 v24.22.1，部署設定與 CI 目標為 Node 22；正式環境仍維持未部署、未啟用。模擬器測試僅驗證本目錄候選規則，不表示 live rules 已合併驗收。

## API 與授權

actions：`get`、`search`、`saveBackfill`、`revokeBackfill`、`restoreBackfill`、`grant`、`setChief`、`photo`。

- 主體一律取 Firebase Auth `request.auth.uid`，交易重新讀取 `users/{uid}`。actor 必須 active，且不是 tester／測試帳號／刪除／停用／凍結。
- 本人可讀、更新照片；讀其他人、搜尋、歷史認列、授予與裁判長指定僅 `super_admin`。前端稱號與角色文字不構成權限。
- `get` 首次確認至少一場有效判決時自動發 L1，亦在交易內配置唯一、單調增加、不回收的證號。L2–L9 必須明確 `grant`，後端重讀所有有界來源再檢查資格；已核定階級不隨來源或回補修正自動下降。
- `snapshot.revision` 永遠提供，無證件時從 0 開始；請勿只讀 `certificate.revision`。mutation 必填 `operationId`（8–128 個英數／底線／連字號）與 `expectedRevision`。
- `snapshot.photoDataUrl` 亦在尚未授證時回傳已存照片；照片不會自行配置證號或提升階級。
- `setChief` 另需 `expectedChiefRevision`。新任命要求目標帳號有效；解除可處理已停用或後來變成測試帳號的目標。唯一主資料在 `refereeCertificateSystem/chief`，全域交接 audit 與目標 audit 同交易寫入；不變更原有 L 等級或帳號角色。
- `search` 為姓名／暱稱前綴及精確 UID 搜尋，回傳最小身分欄位及 `active`、`accountStatus`。停用者仍可查歷史，精確 UID 可定位需要撤銷的舊目標。
- 同 actor 的 operationId 在全域收據命名空間去重，相同內容重試不重複增加；不同內容重用 ID 回覆 `operation-conflict`。重試仍驗證當下 actor 權限與啟用旗標。

## 來源與相容限制

不把 `staffActivityLogs` 文件數直接當可信判決。此集合原本允許本人寫入；新讀取會以私人 `tournaments/{code}.data` 中目前已完成、非輪空、雙方與勝方有效的 match，再核對 `confirmedByUid`。缺少 UID 時，僅接受同 match、同裁判、同確認時間及同比分版本的 server-only `refereeScoreAudit`。

測試、虛擬名單、取消活動、輪空、已撤回結果及已改由另一人確認的舊 log 不算新證件的有效判決；原 log 完全保留。來源已刪除、活動官方屬性缺漏／矛盾或無法核對的舊 log 列為 `pendingLogCount`，可由黑爸依記憶另外認列，無須上傳證明；不要盲目把原始總量與新認列數直接相加。

有效判決可在比賽中累積；活動尚未完成封存時列 `pendingEvents`，system record 狀態為 `pending_event`，不混入無法核對的 `pendingLogCount`。私人狀態已 `archiveStatus: completed` 且非輪空對戰完成後，才認列一次活動經歷及規模成就，不要求玩家天梯積分已入帳。

實際規模使用已完成活動的 canonical bracket player IDs 與私人玩家名單交叉核對，包含實際入籤的輪空選手，不拿容量、報名數或補齊籤表格數代替。無法確定／團體賽未有個人人數契約時存 `unknown`，只計活動總次數。此版本不修改既有計分核心；主備裁未送出確認而缺少 log 的執勤仍需官方回補，不能以最後席位推造歷史。

## 回補、照片與儲存

- `saveBackfill.entry`：`decisions`、`events`、`size`、`precision`、`period`、`note`，修改時加 `id`。只接受未計入的增量。判決是整筆總數，不乘賽事次數。
- `precision` 為 `exact`／`at_least`／`unknown`。未知規模要求 `size:null`，只增加活動總數。至少 96 不表示已達 100；148 則同步涵蓋 64、96、128 與百人成就。
- 回補來源記為 `official-memory-estimate`；期間可填月份、大致期間或系統開始記錄前。原筆修改、撤銷與恢復保留不可變 audit，僅 active 最新版參與統計；撤銷不刪除歷史或回收證號。
- 若記憶數字是「含系統現有紀錄的總量」，必須先比對扣除已計入部分，再填未記錄增量。彙總回補不聲稱能自動精準除重；日後來源恢復時，應修改或撤銷原筆避免重算。不得重建看似精確的逐場日期。
- 照片只接受 JPEG／PNG／WebP dataURL，字元長度最多 600000、解碼最多 450000 bytes，驗證 canonical base64 與 MIME 對應 magic bytes。null／空字串移除照片；不接受外部 URL、SVG。audit／receipt 不複製圖片，只保留 hash／大小。
- `refereeCertificates/{uid}` 保存證件；`records` 保存回補；`audit` 保存歷程；`refereeCertificateOperations` 保存操作收據；`refereeCertificateSystem/numbering` 保存永久證號序列。

查詢上限：logs 3000、來源活動 128、回補 200、每活動 score audit 500、需查 audit 的活動 16。搜尋每欄最多 20。計數來源截斷回 `incomplete:true` 與原因，阻擋首次自動授 L1及官方 grant，不以局部結果冒充完整累積。第 201 筆新回補會被拒絕，已存在的 200 筆仍可修改、撤銷及恢復。超出計數來源界限需另做分頁／投影，不是自動刪除歷史。

所有 audit 均持續保存。每次按遞增 revision 的反序展示最新 1000 筆，避免相同毫秒的時間戳使排序不確定；超出時回 `historyTruncated:true`，這是歷程顯示截斷，不影響完整 active records 的統計、授予、撤銷或裁判長解除。

## 安全規則與後續部署

`firestore.rules.fragment` 僅是新增三組 server-only 集合的候選片段。讀取也走 Callable，因此 owner 與 super_admin 的瀏覽器均不能直接改發證、操作收據或 audit；Admin SDK 交易由入口授權守衛保護。請與當下 live rules 合併驗證，不用此片段覆蓋整份 production rules。

正式部署前另需授權與完成規則整合、Firestore emulator 驗證及呼叫身分驗收。本次沒有修改啟用旗標。獨立 Functions 部署範圍是 `functions:referee-certificates` 與此目錄 `firebase.json`，不包含其他 codebase。
