# BXH 附魔之戰｜Functions 接入契約（未部署）

## 開放條件

- `meta.playMode` 僅可由有權限的主辦建立為 `enchantment`；目前表單保持 disabled，且儲存時強制標準玩法。後端交易與真機驗收前不能解鎖。
- 一場比賽綁 `matchId`、`station`、A/B 兩位正式選手的 **帳號 UID**、當前授權裁判。不能只用姓名、房號或裝置判斷抽卡身分。
- 裁判根據現場情況自行確認人已到場，按一次「開始抽卡」。不新增選手到場確認／取消流程。

## 伺服器狀態

以比賽作為交易邊界：`tournaments/{eventCode}/enchantmentMatches/{matchId}`。目前 Functions 草稿 PR #62 已建立此子集合，尚未部署。

| 欄位 | 意義 |
| --- | --- |
| `state.matchId`, `state.players.A/B` | 與現有場次一致的比賽 ID 與帳號 UID；桌次每次由賽事主檔重新檢查 |
| `round`, `phase` | `waiting-referee → drawing → ready-to-score → drawing/awaiting-result → completed` |
| `cards.A/B` | 伺服器指定的卡牌 ID；指定後不可更換 |
| `revealed.A/B` | 玩家本人完成拖牌動畫後揭示；重試只能取得同一張 |
| `state.scores.A/B`, `state.history` | 附魔回合暫存分數與紀錄；尚未寫入正式賽事比分 |
| `version` | 每次成功轉移加一，拒絕跨局或過期指令 |

**保密邊界：** 卡片指定值不得放在任何兩位選手均可讀的 Firestore 文件。後端使用 private 文件保存指定值；每個玩家 callable 只能取得自己的卡，裁判可取得已揭示卡片。既有公開賽事鏡像不得包含未揭示卡 ID。

## 目前 Functions 草稿的交易入口

單一 callable `enchantmentService` 以 `action` 分流，請求帶 `code`、`matchId`；變更指令除 `start` 外帶 `version`，局內指令帶 `round`。

1. `start`：限該桌有權裁判；核對賽事已開始、玩法為附魔、對戰雙方及目前場次，建立第 1 局並在同一交易指定兩張卡。重複開始會被拒絕，前端可用 `get` 讀取既有狀態。
2. `get`：裁判可查看已翻開的雙方卡；選手只能看自己已翻開的卡。未翻開的卡不得透過回應洩露。
3. `draw`：只允許 A/B 綁定 UID 翻開自己的卡；卡片早已由伺服器指派，拖曳動畫不決定抽到哪張。兩人均翻開後才能計分。
4. `score`：限裁判提交 `round`、`winner` 與**原始勝利方式** `type`。後端用私有卡片計算得分，跨版或重複送出被拒絕；目前只更新附魔子集合的暫存比分。
5. `undo`：限裁判依版本撤回上一筆附魔比分與回合狀態。正式賽事比分、晉級與完成場次的撤銷尚未串接。

正式賽事計分交易與 `confirm` 尚未實作；不得將上述暫存比分視為正式賽事比分。完成前需補齊請求冪等鍵及跨裝置中斷重試驗收。

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
