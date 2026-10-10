# Hunter 2.0 Phase 2 — P2-04 Rating Ledger / deterministic replay

本批建立研究用 rating ledger，解決重送、改分與撤銷後 rating 漂移問題。

## Event contract

每筆事件使用：

- `eventCode`
- `matchId`
- `revision`

同一 `eventCode + matchId` 只採最高 revision。相同 revision 的完全相同重送視為冪等；內容不同則拒絕為 revision conflict。

僅接受：

- source = `official-standard`
- scoringVersion = `bxh-4pt-v1`
- completed + confirmed 的正式結果
- 或更高 revision 的 revoked tombstone

## Replay

rating 狀態不靠「反加減」修補，而是：

1. 每場選出最新 revision。
2. 排除 latest = revoked 的場次。
3. 依 completedAt 重新排序全部有效場次。
4. 從 provider 預設值重新 replay。

因此較早場次被撤銷時，後續場次的 current rating 會重新計算，不會沿用已污染的中間狀態。

## Snapshot 與 replay 的差異

開賽前 snapshot 是歷史事實：記錄「當時系統實際看到的 rating」，封存後不可改。

rating ledger replay 是更正後的 current research state：撤銷舊結果時可以重建現在的 rating。

兩者目的不同，因此 replay **不回寫舊 snapshot**。

## 邊界

- 仍是 research-only。
- 不改正式 Hunter 實力、階級、XP、成就。
- 不接 production backend。
- 正式部署前仍需 Emulator 驗證 server transaction、持久化 collection 與權限邊界。
