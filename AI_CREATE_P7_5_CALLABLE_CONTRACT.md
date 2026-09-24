# P7.5｜AI 建房 Firebase Callable 契約

> 狀態：**介面已建立、遠端 Parser 預設關閉（disabled by default）**  
> 本階段只建立前端呼叫層與資料契約；不部署 AI Provider、不放 API Key 到前端、不寫 Firestore、不建立或發布賽事。

## Callable

- Region：`asia-east1`
- Function：`parseTournamentAnnouncementV1`
- Contract：`bxh-arena.ai-create.callable.v1`
- Result Schema：`bxh-arena.ai-create.v1`
- 前端 timeout：45 秒
- 前端 feature flag：`window.BXH_FEATURE_FLAGS.aiCreateRemoteParser === true`
- 預設值：未設定／`false`

後端必須重新驗證 Firebase Auth 與角色權限；不得信任前端 feature flag 或前端角色資料。

## Request

```json
{
  "contractVersion": "bxh-arena.ai-create.callable.v1",
  "schemaVersion": "bxh-arena.ai-create.v1",
  "sourceText": "活動原始文案",
  "locale": "zh-Hant-TW",
  "timezone": "Asia/Taipei",
  "limits": {
    "maxEvents": 8,
    "maxSourceChars": 12000
  }
}
```

限制：

- `sourceText` 必填，最多 12,000 字。
- 後端不得接受前端傳入的「直接發布／直接建立房間」指令。
- Parser 只回傳結構化草稿資料。
- Parser 不得直接寫入 `tournaments`、`publicTournaments`、registrations 或其他正式賽事資料。

## Success Response

```json
{
  "ok": true,
  "contractVersion": "bxh-arena.ai-create.callable.v1",
  "schemaVersion": "bxh-arena.ai-create.v1",
  "result": {
    "schemaVersion": "bxh-arena.ai-create.v1",
    "sourceMode": "remote-callable",
    "timezone": "Asia/Taipei",
    "activity": {},
    "events": [],
    "bundleOffers": [],
    "warnings": []
  }
}
```

`result` 還必須通過前端既有 `validateAiCreateStructuredResult()`。若 Callable envelope 或 result schema 任一層不合法，ARENA 必須 fail closed：停止在 AI 預覽層，不得套用草稿。

## Expected Errors

後端可使用 Firebase Callable 標準錯誤並帶出穩定 reason，例如：

- `feature-disabled`
- `invalid-argument`
- `permission-denied`
- `resource-exhausted`
- `deadline-exceeded`
- `parser-unavailable`

任何錯誤都不得造成部分寫入。

## P7.5 Frontend Behavior

1. feature flag 關閉時：
   - Golden Test Case 仍可走 mock parser。
   - 其他文案不猜測、不映射。
2. feature flag 開啟時：
   - 由 Firebase Callable 呼叫 `parseTournamentAnnouncementV1`。
   - 回傳先驗證 Callable contract，再驗證 ARENA AI schema。
3. 通過後：
   - 房主仍需選擇賽事。
   - 只套入 `settingsFormDraft` / `registrationFormDraft`。
   - P7.4 Review Gate 仍是必要防線。
   - AI 永遠沒有「儲存正式資料」或「發布」權限。

## P7.6 建議邊界

下一層才建立後端 stub / provider adapter，並保持：

- Provider secret 只存在 Firebase Functions secret / server environment。
- 不把任何 AI API Key、Service Account Key 或 secret 寫進 HTML / JS bundle。
- 先用 feature flag + allowlist 測試，再逐步開啟。
- 實際 AI 輸出必須被 server-side schema validator 與前端 validator 雙重驗證。
