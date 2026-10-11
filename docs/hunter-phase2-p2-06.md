# Hunter 2.0 Phase 2 — P2-06 Calibration / Held-out Evaluator

P2-06 建立候選模型的獨立驗證框架，避免用同一批玩家或未來資料證明自己「比較準」。

## 玩家隔離

玩家依固定 salted SHA-256 hash 分成 calibration 與 holdout，兩組玩家完全不重疊。預設 70% calibration、30% holdout。

## 時間隔離

每個 target match 只能使用該玩家**之前的 prefix**產生：

- baselineScoreBefore
- candidateScoreBefore

target match 本身與未來戰績不得進入該次預測分數。

## 比較指標

目前研究版將 0–100 strength score 映射成 0–1 proxy probability，僅用於 baseline vs candidate 的相對比較：

- Brier score
- MAE
- 50% threshold accuracy

這不是正式機率校準，也不宣稱 strength score 本身就是勝率。

## Fail-closed 接受門檻

預設至少：

- 5 位 holdout 玩家
- 30 筆 holdout target matches
- holdout coverage 至少 20%
- candidate Brier 不得比 baseline 差

不足時只回傳原因，不得宣告候選模型通過。

## 邊界

- research-only。
- 不改 production Hunter 實力、階級、XP、成就。
- P2-06 只提供驗證方法；是否正式採用任何 candidate 仍需要更大樣本、真實資料與人工政策決定。
