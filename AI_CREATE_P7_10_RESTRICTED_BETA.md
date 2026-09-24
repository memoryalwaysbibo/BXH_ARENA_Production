# P7.10｜AI 智能輔助開房 Restricted Beta

狀態：Restricted Beta 後端 Callable 已完成單函式部署；前端分支重新建立於最新 Production main，等待 CI 與合併。

## Beta 權限
- super_admin：允許
- admin：僅當 users/{uid}.aiCreateBetaEnabled === true
- staff / player / tester：拒絕
- 後端為最終權威，前端隱藏按鈕不是安全邊界

## 安全邊界
- AI 只回傳結構化草稿
- 不直接建立房間
- 不直接 publish
- 不直接寫 tournaments / publicTournaments / registrations
- 儲存與發布仍走既有 ARENA Review Gate
- 缺 activity.name / event.name 可進草稿，但 Review Gate 會要求房主補齊最終賽事名稱

## 後端 Restricted Beta
- parseTournamentAnnouncementV1：已部署至 bxh-arena / asia-east1
- 模型：gpt-6-luna
- server switches：Remote Parser ON + Restricted Beta ON
- 本輪使用 1 天有效 Sandbox API Key，以 ephemeral runtime environment 注入
- Secret Manager API 尚未啟用；正式長期版本仍應切回 Firebase Secret Manager

## P7.9 Gate
- 9 / 9 Live Shadow
- Hard failures 0
- Quality mismatches 0
- Production writes 0

## 前端
- 基於最新 Production main 重建
- 僅允許 Restricted Beta actor 顯示 AI 協助建立入口
- Draft / Review Gate / no-auto-publish 保持不變
