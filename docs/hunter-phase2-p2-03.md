# Hunter 2.0 Phase 2 — P2-03 Server Rating Provider v0

本批建立一個**研究用 server rating provider 參考實作**，採獨立 Elo 型尺度，預設 1000、K=24、400 分差曲線。

## 邊界

- 版本：`hunter-rating-elo-v0`
- 尺度：`elo-400`
- 僅供未來 server-side pre-match snapshot 與離線回測。
- 不接正式 Hunter 實力、階級、XP、永久成就。
- 不等同現有天梯 seasonPoints。
- 本 repo 目前沒有 production engagement callable 的後端原始碼，因此本批**不宣稱已部署或已接正式賽事開始流程**。

## 原子封存

`sealMatchSnapshots` 在同一交易中讀取：

1. match
2. player A rating state
3. player B rating state

然後一次封存 A/B 兩個 perspective snapshot。兩邊互為 self/opponent，使用同一 capturedAt 與 matchStartedAt。

封存後不可因玩家後續 rating 變動而覆寫；完全相同的 transaction retry 為冪等。

## Rating 更新

`settlePair` 提供兩人 Elo 型更新參考：

- 勝：1
- 和：0.5
- 敗：0
- K=24
- 雙方 rating delta 總和為 0

這仍是研究 v0，尚未定義哪些 ARENA 對戰可以更新 rating，也尚未處理撤銷／更正的 production ledger。**因此不能部署成正式 rating provider。**

## P2-04 前置條件

下一批必須先完成：

- 定義 rating ledger 可計入的正式來源。
- 定義 completed match 的唯一 event key / revision。
- 定義撤銷與更正後的 deterministic replay。
- 找到 production callable 後端 source 或建立獨立專用 codebase。
- Emulator 驗證原子 snapshot + settlement + revoke/replay。

在上述條件完成前，v0 provider 只能作為 contract/reference implementation。
