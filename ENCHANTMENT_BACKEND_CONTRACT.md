# BXH 附魔之戰｜Functions 接入契約（未部署）

## 開放條件

- `meta.playMode` 僅可由有權限的主辦建立為 `enchantment`；目前表單保持 disabled，且儲存時強制標準玩法。後端交易與真機驗收前不能解鎖。
- 一場比賽綁 `matchId`、`station`、A/B 兩位正式選手的 **帳號 UID**、當前授權裁判。不能只用姓名、房號或裝置判斷抽卡身分。
- 裁判根據現場情況自行確認人已到場，按一次「開始抽卡」。不新增選手到場確認／取消流程。

## 伺服器狀態

以比賽作為交易邊界：`tournaments/{eventCode}/enchantmentMatches/{matchId}`（實際路徑由 Functions repo 檢查現有資料模型後定稿）。

| 欄位 | 意義 |
| --- | --- |
| `schemaVersion` | 附魔狀態版本，首次為 `1` |
| `matchId`, `station`, `playerUids.A/B` | 與現有場次一致的身分與桌次 |
| `round`, `phase` | `waiting-referee → drawing → ready-to-score → drawing/awaiting-result → completed` |
| `cards.A/B` | 伺服器指定的卡牌 ID；指定後不可更換 |
| `revealed.A/B` | 玩家本人完成拖牌動畫後揭示；重試只能取得同一張 |
| `scores.A/B`, `events` | 實際得分與完整得分紀錄，均在同一交易內更新 |
| `revision` | 每次成功轉移加一，拒絕跨局或過期指令 |

**保密邊界：** 卡片指定值不得放在任何兩位選手均可讀的 Firestore 文件。後端使用 private 文件保存指定值；每個玩家 callable 只能取得自己的卡，裁判可取得已揭示卡片。既有公開賽事鏡像不得包含未揭示卡 ID。

## 五項交易入口

1. `enchantmentStart`：限該桌有權裁判；核對賽事已開始、玩法為附魔、對戰雙方及目前場次，建立第 1 局 `drawing`。`requestId` 重試回傳原狀態。
2. `enchantmentPrepareDraw`：後端使用安全隨機來源，**在交易內各指定一張** 12 張池中的卡；記錄後才將可抽狀態推送雙方。抽卡動畫不得在前端選卡，也不能重新整理重抽。
3. `enchantmentReveal`：只允許 A/B 綁定 UID 揭示自己這一局的卡；重複相同請求冪等，回傳同一卡；兩人均完成後才能開啟裁判計分。
4. `enchantmentScore`：限該桌有權裁判；只接收 `matchId`、`round`、`winnerSide`、**原始勝利方式**、`requestId`、`expectedRevision`。後端讀取雙方卡片，計算原始分、觸發卡、實得分，再原子更新比分與紀錄。用戶端不能提交卡牌 ID 或最終得分。送分後才建立下一局；達 4 分進入待確認。
5. `enchantmentUndo`／`enchantmentConfirm`：同一裁判權限。Undo 在同一交易中回復上一筆比分、卡片與局數，讓已開始的下一局舊請求失效；Confirm 必須已達勝利條件，沿用現有晉級／結算路徑，不能只改附魔狀態。

## 計分紀錄與相容性

既有 `normalizeHunterRoundEvent` 會拒絕分數與基礎分不同的紀錄。附魔賽事必須使用版本化新紀錄，不可直接將 4 或 6 分塞進 `v1` 原始得分事件。

建議 `v:2` 紀錄欄位：`eventId`, `seq`, `side`, `type`, `basePoints`, `points`, `delta`, `winningCardId`, `losingCardId`, `appliedCardId`, `round`, `ruleVersion`, `t`。賽後核對以後端同版本規則重算，且 `sum(events.points)` 等於雙方比分。普通賽事的 `v:1` 正規化與存檔行為維持原樣。

增益與防禦同時命中目前回傳 `priority-undecided`，不能寫入得分事件。失誤兩次的 +1 分屬於現有規則；需在後端明確定義它是否受附魔影響後再開通附魔賽事的失誤送分。

## 接入驗收

- A/B 分別登入兩支手機，裁判第三支手機啟動；A 不可抽 B 的卡；刷新或斷線重試不換卡。
- 雙方未揭示前不能送分；裁判連點同一結果只記一次；上一局延遲封包不能進下一局。
- 「A 爆裂 2 + 雙重爆裂 2 → 實得 4」後，裁判、雙方選手與公開比分相同；撤銷後四處一致。
- 封印、轉停弱化 1→0、勝方增益與敗方防禦同時命中均有獨立驗收。
- 普通賽事、快速判定、兩次失誤、原本撤銷與賽後 HUNTER ROUND 紀錄仍通過原有驗收。
