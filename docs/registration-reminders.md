# 報名提醒候選版

玩家於每場官方賽事小卡自行開關通知；預設關閉。開啟預設於報名開放前 60 分鐘提醒，可改為 30 分鐘、10 分鐘或開放當下。瀏覽器通知權限與裝置推播註冊成功，且伺服器儲存成功後，才能顯示已開啟。

## 尚未發布

registration-reminder-ui.js 尚未加入 index.html，避免後端尚未完成時出現無效入口。本次取得的 Functions_Production repository 僅有 bootstrap README；Functions_Deploy 的 functions-source.zip 不含現行 courtCallPushService。必須先取得目前已部署的推播來源與 token ownership 邏輯，才能接上定時通知並發布。

## Callable 合約

`registrationReminderService` 限登入玩家操作本人偏好，uid 必須來自 request.auth，禁止採信 payload uid。

- list：回傳 `{ok:true,items:[{code,enabled,minutesBefore}]}`。
- set：接受 `{action:'set',code,enabled,minutesBefore}`，回傳 `{ok:true,item:{code,enabled,minutesBefore}}`。
- 時間僅接受 0/10/30/60；驗證公開、可線上報名且未取消的活動；開啟時確認尚未報名且仍未開放。
- 關閉操作不得要求通知權限或推播註冊；同一 uid/code 僅保留一份設定。

前端 bridge：在 engagementService 加入 `registrationReminder(payload)` 呼叫上述 callable，再於所有主要函式定義後載入 UI module。

## 後端定時工作

使用現行 BXH CALL token registry 與所有權驗證共用發送通道，禁止另存一套無法與登出／換帳號同步的 token 清單。每分鐘查詢到期工作，重新讀取權威活動、玩家偏好與報名紀錄，使用 core decision 判斷。活動時間變更需重排工作；取消、隱藏、已報名立即停用。

以 uid/code/openAt/minutesBefore 作為工作唯一鍵；交易取得租約後發送，完成紀錄與重試使用同一鍵。FCM 並不提供 exactly-once 保證；Service Worker 使用相同 notification tag 避免重複展示。失效 token 使用既有清理流程。

提醒文案：

標題：🔔 距離開放報名還有 1 小時！
內文：你關注的「{活動名稱}」將於 {台灣日期時間} 開放報名，記得準時回來！

開放當下標題：📣 你關注的賽事開放報名了！
內文：「{活動名稱}」已開放報名，點擊查看名額並完成報名。

推播 kind 必須為 registration-reminder；Service Worker click 路由需單獨處理，不能觸發叫號 overlay。點擊開啟本人可存取的活動詳情，不直接自動報名。

## 驗證

已通過 node tests/registration-reminder.cjs（10 項）與 UI module 語法檢查；既有 verify-production-frontend 檢查全部通過。

發布前仍需：後端身份／token 所有權、租約／重試／取消競爭測試；小卡操作與跨帳號隔離測試；Android 與 iPhone 主畫面背景／鎖屏／通知點擊實測。
