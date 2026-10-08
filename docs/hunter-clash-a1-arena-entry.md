# A1：ARENA 獵人交鋒入口與身分整合

此為 A1 階段存檔；A2/A3 接線、完整帳本與後端 codebase 現況見 [hunter-clash-a2-a3-arena.md](hunter-clash-a2-a3-arena.md)。以下狀態描述僅對 A1 時點。

基準 main 72d6f4e；依接軌規劃 PR #455。此候選只完成入口與身分預覽，不代表可在 ARENA 建立實際 PK 對戰。

## 完成範圍
- 於既有主導覽末尾追加「獵人交鋒」，上下導覽一致。最新 main 實際有5個主頁籤，本次追加後6個；不憑空新增其他選項湊第7個。
- 沿用 ARENA currentUser 與伺服器取得的玩家資料，不另建 Firebase App、不二次登入、不要求手填名字。
- 指定登入帳號的 ID token custom claim `hunterClashA1 === true` 且玩家 active=true 才顯示；資料欄位或 localStorage 無法開通。未登入、資格缺失／讀取錯誤、切换帳號均預設隱藏。
- 建立／加入預覽、返回，加入頁自動要求相機，下方四碼欄位；拒絕相機仍保留四碼欄位。
- 返回、切頁、登出、背景／pagehide釋放相機；延遲權限回傳亦停止舊stream，重新渲染不重複要求相機。
- 不讀 PK sandbox、不傳 ARENA token 至測試專案、不產生戰績或發放獎勵。

## 尚未完成與開通限制
現有 PK 後端在 bxh-hc-test，ARENA Auth 在 bxh-arena；不同專案 token 不可直接沿用。
本 PR **沒有**發布同專案 PK Callable、跨專案 token bridge 或新增任意信任來源。建立／確認加入停用，QR解碼也尚未接入，頁面明示服務待接入。

指定 ARENA 測試 UID 及 `hunterClashA1` custom claim 需由可信 Admin SDK 操作，本 PR 未修改任何真實帳號或 claims。原先提供的兩個 UID 屬 PK 測試專案，不能當成 ARENA 身分直接套用。
custom claim 只控制這批 UI 可見性，不替代未來後端權限。開通／撤销後需刷新 Auth token或重新登入；不宣稱前端是即時停權機制。正式後端必須在每次請求驗證資格與服務總開關。

下一批需接同專案可信對戰服務，才能驗收真实建房／配對。整合身份、完整帳本與權限驗收前，正式入口不開放。

## 驗證
- 7項單元案例：隱藏／資格、姓名轉義、切換帳號競態、相機重用、延迟授權釋放、拒絕授權／手動重試、背景釋放及無PK網路／獎勵路徑。
- 新增 critical runner，合計23組核心回歸通過。
- production frontend verifier、既有獵人階級、附魔帳本檢查通過。
- Playwright：真實入口模組與主線導覽函式、模擬claims與MediaStream，320/390/430px無水平溢出；加入／返回及切頁釋放相機，無JS錯誤。
- 瀏覽器測試使用fixture身分與canvas stream，不是真實Firebase帳號或實體相機驗收。

## 狀態
實作與測試完成，待PR／CI；未合併、未部署、未設定真實測試帳號。
實際PK服務連接、QR辨識與雙手機對戰：BLOCKED／待後端接入。
XP、成就、正規實力／階級政策保持未開通。
