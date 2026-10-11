# Hunter 2.0 Phase 2 — P2-07 Acceptance Gate / Model Decision Report

P2-07 是 Phase 2 的研究收尾層。它不再建立新模型，而是將 P2-06 held-out evaluator 的輸出轉成明確決策狀態。

## 狀態

### PASS
條件：
- 樣本與 coverage 門檻全部滿足。
- evaluator accepted=true。
- 沒有 model failure。

含義：Candidate 通過目前研究 gate，但**不代表可以直接上 production**。下一步必須人工政策審查。

### FAIL
條件：
- 資料充分。
- Candidate 在模型品質門檻失敗，例如 candidate Brier 比 baseline 差。

含義：維持 baseline，不採用 candidate。

### INSUFFICIENT_DATA
條件：
- holdout 玩家不足。
- holdout samples 不足。
- holdout coverage 不足。
- 缺少可比較 metrics。

含義：不能判定 Candidate 好或壞，只能繼續收資料。

如果同時存在「資料不足」與「candidate-brier-worse」，仍以 INSUFFICIENT_DATA 為主，避免在資料不足時把模型判死刑；model failure 仍會保留在報表供人工檢視。

## 報表內容

- decision status
- calibration / holdout 玩家數
- all / calibration / holdout rows
- holdout coverage
- baseline / candidate Brier
- baseline / candidate MAE
- baseline / candidate accuracy
- Brier delta
- evaluator criteria
- insufficient-data reasons
- model-failure reasons
- model / data / evaluator versions
- input ledger / records SHA-256
- researchOnly=true
- productionEligible=false

## Phase 2 收尾政策

P2-07 合併後：

- 暫停新增 Hunter 研究功能。
- 不開 P2-08、P2-09 等新研究批次。
- 只保留 Bug 修正、資料品質檢查與真實樣本累積。
- 只有資料量達到門檻時，才重新執行 Candidate vs Baseline evaluation。
- 正式 Hunter 實力分、階級、XP、永久成就維持現況，除非另有明確人工政策決策。
