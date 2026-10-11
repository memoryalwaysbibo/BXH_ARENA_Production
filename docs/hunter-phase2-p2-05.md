# Hunter 2.0 Phase 2 — P2-05 Research Rating Dataset / Replay Report

P2-05 將 P2-01～P2-04 串成單一離線研究管線：

```
versioned result ledger
  → deterministic rating replay
  → per-match pre-match research rating
  → Hunter B5 backtest
  → opponent-adjusted candidate
  → de-identified research report
```

## 輸出

每位匿名玩家輸出：

- rating coverage
- baseline strength
- candidate strength
- candidate - baseline 差值
- baseline / candidate 最大逐場跳動
- weaker / peer / stronger opponent 分層勝率
- repeat-opponent 集中度
- candidate unavailable reason

整體輸出平均 baseline、candidate、delta 與 jump 指標。

## 隱私與可重現

- 玩家 UID 使用固定 salted SHA-256 alias。
- 報表不輸出 playerId、matchId、原始 rounds、原始 ratingSnapshot。
- 輸入 ledger 與 player records 各自記錄 SHA-256。
- 相同輸入與相同版本會產生相同核心報表。
- generatedAt 只存在 CLI 外層 metadata，不參與研究判斷。

## 更正與撤銷

rating 使用 P2-04 deterministic replay。舊結果被 revoke / supersede 後，研究 rating 由有效事件重新建立；對應不到有效 replay match 的 perspective record 不會偷偷回填 rating。

## 邊界

- research-only。
- officialScoreChanged=false。
- 不改 production Hunter 實力、階級、XP、成就。
- 報表本身不能證明 candidate 比 baseline 更準，只提供後續 held-out validation 所需的可比較輸出。

## P2-06

下一批應建立 calibration / held-out evaluator：

- 按玩家與時間切分，禁止同玩家／未來資料洩漏。
- 比較 calibration 與 holdout 的預測表現。
- 明列 coverage、樣本數與置信區間。
- 設定候選公式的接受／拒絕門檻。
