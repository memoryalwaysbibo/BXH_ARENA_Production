# 累積在線時數稱號候選版

使用者於 2026-10-30 確認以下六個稱號與分類：

| ID | 名稱 | 時數 | 等級 |
| --- | --- | ---: | --- |
| online_time_1h | 微光初現 | 1 | 一般 |
| online_time_10h | 星光漸明 | 10 | 一般 |
| online_time_50h | 流光刻痕 | 50 | 稀有 |
| online_time_100h | 百時星軌 | 100 | 稀有 |
| online_time_500h | 歲月銘刻 | 500 | 史詩 |
| online_time_1000h | 千載流光 | 1,000 | 傳說 |

全部永久持有、`limitedType: none`、`isLimited: false`。六張已使用對話中的原圖完成接入（768×270，保留比例與透明背景的無損 WebP＋PNG 備援），共用稱號、天梯映射與六個定義的 artwork 路徑一致。六張及六款可展開預覽已由 #662 獨立發布上線；不代表後台功能已啟用。

## 已實作範圍

- 後端使用既有 `onlinePresence/{uid}.lastSeenAt` 的前後快照，不新增瀏覽器計時器、不接收客戶端時數。
- 稱號時數沒有每日上限，不讀取或更改活躍積分錢包、每日積分、兌換與簽到資料。
- 同 UID 相同來源區間透過 SHA-256 receipt 交易去重，事件不同 ID／亂序／交易重試均不重複計時。
- 使用 `playerStats.officialOnlineTimeMs`，merge 保留其他統計；條件單位為分鐘，前端呈現小時。
- 已核對正式在線積分來源：連續心跳視窗為 120 秒，presence 最短寫入間隔為 30 秒；更長離線間隔不計。這是連續性判定，不是每日上限。
- 進度每跨越30分鐘更新；達到門檻呼叫注入的既有 `awardTitle`，沿用其已取得／撤銷／審計／計數保護。計時交易成功後授予失敗會拋錯重試，receipt 不會阻止補發。
- 預設不啟用。必須存在 `systemSettings/onlineTimeTitles` 的 `enabled: true`、明確毫秒 `startAt` 與 `sourceSchema: lastSeenAt-v1` 才處理。授予亦遵守現有 titlesEnabled／automaticTitleAwardsEnabled。
- 首次有效事件建立六個缺少的定義及公開文字目錄；有同 ID 但名稱／條件／門檻／分類不符時拒絕，不覆蓋。停用與封存交由原生 awardTitle 繼續管控。

## 尚未正式接入：不得將本候選當成已上線

2026-10-30 已透過既有部署身分唯讀取得正式 148 支 Function 清單，以及 34 個相關服務的來源包與目前 Firestore 規則。證據保留於私人 `BXH_ARENA_Functions_Deploy` 的 `audit/online-time-live-source-20261030` 分支，不將正式後台完整來源放入公開前端倉庫。未讀取或修改玩家資料。

確認正式 `activityOnlineDaily.activeMs` 被截在每日 3 小時，因此無法直接當作無上限累積時數；不能憑該欄位推算每日超過 3 小時的歷史。正式 `getEngagementSnapshot` 的舊投影也會遺漏新條件與分類欄位；`patch-live.cjs` 提供只針對新稱號的相容修補。稱號進度維護、簽到、補簽與天梯服務分別部署，必須依各自現行來源修補。

已加入真實 Firestore 模擬器測試及從正式來源擷取原生 `awardTitle` 的整合測試，於私人分支執行；真實 Emulator、擷取原生授予實作與正式規則防偽測試已通過；舊維護程序防覆寫保護亦已於先前 CI 通過；本次 C 回補變更新增的 Emulator 案例仍須重跑。已確認的稱號會記錄授予確認，避免之後每次心跳反覆呼叫原生授予交易。

發布前還需完成：

1. 已取得上述 34 個來源包；仍須完成依實際入口與相依函式核對的精確部署清單。前端前景／多裝置租約與來源規則仍需端到端驗證。
2. 確認是否已有完整、未受每日積分上限截斷的歷史時數。使用者已選定下列 C 方案：一次性回補舊每日在線紀錄，交接後由新計時累積。不得將全部活躍積分換算成小時；現有資料保存範圍仍須唯讀盤點。
3. 對每個實際會評估稱號的獨立部署包加上 `total_online_minutes` 條件，公開投影與管理編輯須保留 conditionType／rarityTier／limitedType。不能只部署新的觸發器，否則舊的維護程序可能把進度寫成0。原生 `awardTitle` 也必須核對當前分類與撤銷行為。
4. 用當前可信來源建立可審查的逐 Function patch 與精確部署清單；核對既有 Firestore 規則是否拒絕瀏覽器寫入 receipts、統計、定義及已取得稱號。未修改線上規則。
5. 對真實 Firestore Emulator 驗證交易競態、重送與 deny 規則；本機已有 30 項測試通過；既有真實 Emulator／原生授予整合已通過，本次 C 方案新增案例待 CI 驗證，尚不等於正式驗收。
6. 評估每心跳額外 receipt＋統計寫入的成本與持續保存策略；候選未配置 TTL，不可先刪 receipt 再允許舊事件重放。
7. 核對以上項目後再部署並設定啟用時間；目前沒有部署腳本、沒有啟用、沒有寫入正式玩家資料。

前端原有 heartbeat 約45秒一次且只在前景回報；此條件代表繼承該來源，沒有另行承諾已具備滑鼠／觸控閒置辨識。

## 候選組裝與驗證

`install.cjs` 只在新目錄組裝候選，檢查已知函式錨點後插入條件與新觸發器，拒絕變動／重複錨點與覆寫目的地；不部署。它不是對現行正式來源相容性的證明，也沒有自動產生完整部署清單。

```sh
node --test online-time-titles/test/*.test.cjs
node scripts/verify-production-frontend.cjs
node online-time-titles/install.cjs CAPTURED_BACKEND_SOURCE NEW_CANDIDATE_DIRECTORY
```

後續補圖沿用六個固定 ID 與原授予紀錄，無需重拿稱號。

## C 方案：一次性歷史回補＋獨立新計時（2026-10-30 確認）

`backfill.cjs` 是僅供可信 Admin SDK 執行的內部服務，未暴露 HTTP／callable，沒有部署或寫入正式資料。

- 全服使用同一個明確交接時間 `startAt`，必須為已到達的台灣午夜。不得將測試日期當正式啟用日期。
- 設定 `migrationStrategy: C-once-v1`、`backfillEnabled: true`、固定 `backfillBatchId` 與 `historyStartDate`。歷史起日須依實際保存範圍盤點決定；單次最多 366 日，超過必須另行設計，不能截短。
- 逐日讀取 `activityOnlineDaily/{YYYY-MM-DD}/players/{uid}.activeMs`，核對 UID、日期、非負整數與每日三小時上限。保留實際已記錄的不足半小時部分，避免將積分入帳延遲當作時數遺失。不從總積分或其他任務推算。
- 歷史範圍為起日到交接前一天；當天及後續完全由新計時處理。新心跳橫跨交接時間時，只計交接後部分。
- 每帳號 `onlineTimeTitleBackfills/{uid}` 固定收據，保留批次、界線、每日證據、雜湊、實存天數及缺漏天數。完成後不再補入後來變動的舊資料；改批次或起日也不能第二次加時。
- 同一交易合併歷史時數到 `officialOnlineTimeMs`，並保留 `onlineTimeHistoricalMs`；與新計時並發透過交易重試保留兩者。其他玩家統計、每日任務與積分不變。
- 回補後更新稱號進度並沿用原生授予；授予失敗可重跑，歷史時數不會再加一次。
- 缺漏日記錄為缺漏，不編造時數。正式執行前須提供唯讀盤點／預估結果並凍結遷移設定，確認來源已處理完交接前事件；不得將資料未載入誤認為不存在。

尚待完成：正式資料保存盤點、批次執行入口與全服乾跑報表、逐 Function 正式部署及 C 回補的真實 Emulator／規則驗證。這些完成前不可宣稱已開始累積或完成回補。

已提供內部 `backfill(uid, {dryRun: true})`：不必開啟回補開關，僅預覽逐日證據、缺漏天數、時數與達標稱號，不寫入統計、定義、收據或授予。交接前的預覽屬暫估，正式回補必須到交接後重新讀取來源。尚未執行正式資料預覽。
