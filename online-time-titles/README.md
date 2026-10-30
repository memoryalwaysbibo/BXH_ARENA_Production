# 累積在線時數稱號候選版

使用者於 2026-10-30 確認以下六個稱號與分類：

| ID | 名稱 | 時數 | 等級 |
| --- | --- | ---: | --- |
| online_time_1h | 微光初現 | 1 | 一般 |
| online_time_10h | 星火漸明 | 10 | 一般 |
| online_time_50h | 流光刻痕 | 50 | 稀有 |
| online_time_100h | 百時星軌 | 100 | 稀有 |
| online_time_500h | 歲月銘刻 | 500 | 史詩 |
| online_time_1000h | 千載流光 | 1,000 | 傳說 |

全部永久持有、`limitedType: none`、`isLimited: false`。微光初現已接入第一張圖片（768×270，保留比例與透明背景的無損 WebP＋PNG 備援），其餘五張圖片待接入。更新了共用稱號與天梯顯示映射；未部署正式站。

## 已實作範圍

- 後端使用既有 `onlinePresence/{uid}.lastSeenAt` 的前後快照，不新增瀏覽器計時器、不接收客戶端時數。
- 稱號時數沒有每日上限，不讀取或更改活躍積分錢包、每日積分、兌換與簽到資料。
- 同 UID 相同來源區間透過 SHA-256 receipt 交易去重，事件不同 ID／亂序／交易重試均不重複計時。
- 使用 `playerStats.officialOnlineTimeMs`，merge 保留其他統計；條件單位為分鐘，前端呈現小時。
- 有效連續心跳間隔暫採現有 presence 觀察視窗 120 秒；更長離線間隔不計。這個技術連續性參數仍需與**正式在線積分後端**核對，不是每日上限。
- 進度每跨越30分鐘更新；達到門檻呼叫注入的既有 `awardTitle`，沿用其已取得／撤銷／審計／計數保護。計時交易成功後授予失敗會拋錯重試，receipt 不會阻止補發。
- 預設不啟用。必須存在 `systemSettings/onlineTimeTitles` 的 `enabled: true`、明確毫秒 `startAt` 與 `sourceSchema: lastSeenAt-v1` 才處理。授予亦遵守現有 titlesEnabled／automaticTitleAwardsEnabled。
- 首次有效事件建立六個缺少的定義及公開文字目錄；有同 ID 但名稱／條件／門檻／分類不符時拒絕，不覆蓋。停用與封存交由原生 awardTitle 繼續管控。

## 尚未正式接入：不得將本候選當成已上線

本倉庫主線沒有現行 `activityOnlinePresenceWritten` 或完整 engagement 後端原始碼。已讀取 Functions_Deploy 的歷史 presence／engagement 介面作為設計參考，**它們不是最新正式來源證據**。

發布前還需完成：

1. 讀取當前正式 `onlinePresence`、`activityOnlinePresenceWritten`、所有會跑 `evaluateTitles`／稱號進度維護的 Function 原始碼與版本；核對 lastSeenAt 的可信寫入、前景／斷線／多裝置語意及有效區間算法。
2. 確認是否已有完整、未受每日積分上限截斷的歷史時數。此候選不推測舊時數，不將全部活躍積分換算成小時，也不做歷史補發。`startAt` 是後續開始記錄的技術界線，**尚未替使用者決定放棄歷史**。
3. 對每個實際會評估稱號的獨立部署包加上 `total_online_minutes` 條件，公開投影與管理編輯須保留 conditionType／rarityTier／limitedType。不能只部署新的觸發器，否則舊的維護程序可能把進度寫成0。原生 `awardTitle` 也必須核對當前分類與撤銷行為。
4. 用當前可信來源建立可審查的逐 Function patch 與精確部署清單；核對既有 Firestore 規則是否拒絕瀏覽器寫入 receipts、統計、定義及已取得稱號。未修改線上規則。
5. 對真實 Firestore Emulator 驗證交易競態、重送與 deny 規則；目前本機測試使用 MVCC 記憶體 fixture，尚不等於 Emulator／正式驗收。
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
