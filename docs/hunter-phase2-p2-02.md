# Hunter 2.0 Phase 2 — P2-02 開賽前 Rating Snapshot 契約

本批建立可信的開賽前 rating snapshot 契約，供未來 Hunter 實力模型回測使用。**尚未接入正式賽事開始流程，也不改正式實力或階級。**

## 原則

- snapshot 必須由可信 server rating provider 提供。
- 不接受 client 自填 rating。
- capturedAt 必須嚴格早於 matchStartedAt。
- snapshot 一旦封存即不可修改；重送相同內容冪等。
- provider 必須宣告 ratingVersion 與 ratingScale。
- 沒有可信 provider 時 fail closed，不以 0、目前分數或任何推測值補齊。
- 目前天梯 seasonPoints 是累積活動積分，**不是 Elo／對戰實力 rating**，P2-02 不把它別名成 Hunter rating。

## Schema

```json
{
  "schemaVersion": "hunter-prematch-rating-snapshot-v1",
  "source": "server",
  "verified": true,
  "ratingVersion": "hunter-rating-v1",
  "ratingScale": "elo-400",
  "capturedAt": 1000,
  "matchStartedAt": 1100,
  "selfBefore": 1012,
  "opponentBefore": 1120
}
```

## 與 B5 的接軌

server snapshot 可投影成 B5 已有的 `ratingSnapshot` 結構。P2-02 只定義資料可信邊界與不可變性，不決定 rating provider 的正式公式。

## 下一步

P2-03 才會實作真正的 server rating provider，並決定 snapshot 應在哪個正式賽事「開始前」交易中原子寫入。provider 必須先有自己的版本、尺度與回測驗證，不能直接使用天梯累積積分代替。
