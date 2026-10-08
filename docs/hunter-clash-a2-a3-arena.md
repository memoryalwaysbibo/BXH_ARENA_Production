# A2 / A3：獵人交鋒併入 ARENA（內測程式候選）

基準：main 72d6f4e；疊在 A1 PR #456 的相同 tree。原隔離 PK PR #434 不整份合併，也不匯入 sandbox 戰績。

## A2：對戰與可信帳本
- 專用 `hunter-clash/arena` codebase 的 `hunterClashCommand`，沿用 bxh-arena Auth / asia-east1 / 預設 Firestore；拒絕 sandbox 或客户端指定專案。
- Callable 強制 Auth 與 App Check；Admin SDK 再驗證 token（含撤銷）。每次操作核對 users 的 active、角色、測試帳號狀態與 `systemSettings/hunterClash` 的 enabled/environment/allowedUids。對手失去資格亦阻止對戰寫入，返回／拒絕仍可關閉本房。
- 設定缺失、disabled 或非指定 UID 均預設拒絕。既有 `hunterClashA1` claim 只控制前端可見性，不替代服務端白名單。撤銷白名單下次請求生效。
- 固定規則版本 `arena-pk-4pt-v1`：極限3、擊飛2、爆裂2、轉停1；4分勝。預設1場，最多100場，0表示循環；同一房下一場不需重新配對。
- 一次性 QR（獨立 `bxh-arena-pk` 前綴）與4碼；2–9/A–Z排除I/O；配對期限由可信設定提供。序號10次/分鐘，成功配對即消耗。逾期由服務端讀回同步過期狀態。
- 記分方快速記分；撤銷上一筆留痕；爭議進 score_review，修正後重新確認。整房雙方確認才保存。先確認者顯示等待對方，沒有爭議畫面。
- revision防併發；開始與同一結果版本的完賽確認遇到競態可同步後安全重送，記分不盲目重送。requestId receipt原操作重試不重計，未知網路結果保留原操作。
- `arenaPKPlayers/{uid}/matches/{challengeId}_gNNN`保存完整場次與rounds；雙方帳本、總計、challenge、receipt與audit同交易寫入（100場最多200筆帳本，不截斷50場）。所有讀取由callable驗證本人UID，詳情限定參與者。
- 分頁50筆，依文件名游標；generation在新完賽/撤銷時改變，跨頁變動拒絕混合不同快照。前端不把未完成頁面當完整生涯分母。
- 已完賽更正本批採 super_admin `revokeChallenge`：理由、expectedRevision、requestId必填；雙方帳本新版completed=false保留原始明細，總計回扣一次，audit留痕。玩家不能改完成紀錄，需撤銷後重建，不提供任意改分。

## A3：畫面与獵人執照
- 共用ARENA登入與玩家名稱，無第二次登入／手填名字。Shadow DOM隔離PK CSS；切頁、背景、帳號切換釋放相機與timer。前景有活動房時每3秒同步，不重疊；完成、背景或資格关闭停止轮询。
- PK頁與執照使用同一個完整分頁cache；loader有unconnected/loading/partial/error/empty/ready。失敗不以零戰績顯示、不將舊帳號資料帶到新UID。
- 內測資格者可選PK；全部展示加入PK，正規／附魔來源維持原讀取。PK頁保留場次、玩家、對手、比分、勝率、完整回合明細；獵人檔案提供同資料與期間篩選。
- 八軸固定：極限、擊飛、爆裂、轉停、被極限、被擊飛、被爆裂、被轉停；100%滿半徑，分數／次數分布沿用2.0；無分母顯示—。本房保留5場初步／10場較充分門檻，屬暫計／參考，非正式實力；獵人檔案PK只顯示分布，不產生綜合能力分。
- adapter驗證來源、版本、UID、雙方確認、勝者、分值與全比分；缺rounds或帳不符僅保存排除原因，不猜分布。namespace+場號+revision識別；最新撤銷不讓舊完成版本復活。
- `hunterProfileCache.records`、growth、licenseOverview與永久成就輸入仍只使用既有正規／附魔来源。displayRecords仅用于期間統計、能力分布與對戰列表。既有XP/階級/成就不變。

## 驗證與狀態
- 8項實際服務／adapter／cache／執照隔離測試（含51場完整帳本、權限、重送、撤銷、分頁競態与XP/階級不變）。
- A1 7項入口單元及瀏覽器回歸；A2/A3双玩家瀏覽器實際模組＋交易fixture，真实QR圖片解碼、四碼加入、自動同步、等待、共用戰績、換頁／換帳號、320/390/430px。
- 真實Admin SDK＋Auth/Firestore Emulator：雙方認證、同版本確認競態、51場分頁、雙方帳本、撤銷重送、直接客户端讀取403、失效帳號拒絕。
- CI critical新增服務測試；UI新增双玩家瀏覽器；Emulator job 安裝鎖定server SDK並執行新整合測試。
- 本機critical 24組、frontend verifier、hunter-license-grade、附魔帳本／計分與B1～B6回歸通過。CI實際結論另以PR最新commit為準。
- 真實 bxh-arena backend部署、App Check接受驗證、指定ARENA UID／claims／設定開通與雙實體手機驗收：**尚未執行**。Emulator/fixture通過不能替代雲端驗收。

## 發布順序與回退
1. 合併內測程式仍預設關閉：沒有新增任何真實設定或claims。既有Pages pipeline在main驗證後會發布前端；不會部署本codebase到Firebase。
2. 後端發布須在此資料夾以**明確project bxh-arena**、**only functions:arena-internal-pk**定向部署；不得替換既有整包functions或rules。firebase.json只供專用codebase，未改目前站點部署設定。
3. 保留現有Firestore規則，在既有documents區塊加入deny fragment（目前主線無對這些集合開放權限，預設已拒絕）；不覆蓋ARENA users/registrations等原規則。Admin SDK/IAM為後端可信邊界。
4. 可信Admin建立`systemSettings/hunterClash`：先enabled=false、environment=arena-internal、allowedUids=[]、rules={version:arena-pk-4pt-v1,targetScore:4}、pairingTtlMs=120000。明確指定同專案ARENA UID並保留現有custom claims，再加hunterClashA1=true；不套用舊sandbox UID。
5. 小範圍開關與真實雙手機驗收後才公開入口。尚未部署／設定的服務，前端顯示未開通與可重試；不得宣稱玩家已能正式使用。
6. 回退先enabled=false清空白名單停止服務，再移除對應claim並刷新token。需要程式回退時revert整合commit；帳本與audit不刪除、不重置既有生涯。

XP每日上限、同對手遞減、PK永久成就、正規／資歷間接升階、反刷警告與懲罰都不在此批開通；依2.0交接最新限制保持待確認。沒有自動封號。
