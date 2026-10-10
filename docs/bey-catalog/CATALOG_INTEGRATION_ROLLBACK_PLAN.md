# 圖鑑隔離整合與回退準備

2026-10-10。這是可供審查的執行順序，沒有授權正式合併、部署或資料寫入。

## 已核對版本

| 項目 | 固定提交 | 結果 |
|---|---|---|
| main 最新讀取基準 | 19e54b2d070b4425679be2a24e555c19f038cf73 | 僅讀取，未修改；部署工作流程仍只接受 main push 且最新驗證提交 |
| PR #462 | b770b0ee3d75ed5688bbcce7688cb212cc947e46 | 三項 CI 成功；原始197筆真實驗收見[固定收據](https://github.com/memoryalwaysbibo/BXH_ARENA_Production/blob/b770b0ee3d75ed5688bbcce7688cb212cc947e46/docs/bey-catalog/DB01_REAL_EMULATOR_RECEIPT.md) |
| PR #463 HTTP功能基準 | 04cc2337db5844437c6b72e1257b06f46093f641 | 三項 CI 成功；含真正 Functions Emulator HTTP 邊界、真實 Auth Emulator；HTTP功能證據保留；另接續下列本機唯讀UI |
| PR #463 本機唯讀UI基準 | 5458f0665d6e8b3f52f5892dca776b425b1ce15b | 該提交三項CI成功，含六項真實Auth／Firestore Emulator＋Chromium回歸；研究fixture為合成，新文件提交CI另行核對 |

兩個 PR 與目前 main 的共同基準仍是 `8e1cf07c8693bba6615d0758744569609f23538d`，目前各自落後 main 27 個提交。本輪以固定main對#462與#463 UI基準分別執行唯讀 `git merge-tree --write-tree`，兩者退出0、未報文字衝突；這只證明固定版本的文字合成，不代表組合後功能驗收或合併授權。GitHub即時可合併狀態與最新HEAD CI另行核對，不把舊結果沿用為新提交證據。本次對#462 b770b0ee及#463 5458f066與main19e54b2再次核對皆退出0；main新增兩提交涉及獵人徽章及背景刷新保留登入表單，未改圖鑑模組或工作流程。這次未將main合入任何PR、未建立合併提交，也未執行組合後的全站驗收。

## 部署觸發與授權

最新基準的 .github/workflows/deploy-production-pages.yml 在 Validate Production Frontend RC1 完成後判斷 success、事件push、分支main，再執行Pages部署；即使只合併測試或文件，main push也有正式站重新部署風險。不得把「先合併測試」視為不會部署。PR分支目前不符合這個main部署條件；其他工作流程仍須在任何新操作前重新核對。

## 下一個安全執行順序

1. 保持#462、#463 Draft，避免重做已完成且未改動的真實資料驗收；每次以最新HEAD核對CI。
2. 實際 v2 SDK loopback HTTP 與真正 Functions Emulator URL 邊界已完成隔離驗收；除非相關程式或依賴變更，不重跑私有原始197筆或另造批次。App Check 仍是明確替身，不能把此結果說成正式雲端驗收。
   後續已補上[本機唯讀操作頁](CATALOG_LOCAL_REVIEW_UI.md)，串接既有安全查詢，支援測試登入、搜尋、篩選、分頁；Chromium與真實Auth／Firestore Emulator的六項回歸成功，研究fixture明確為合成。私有快照操作、常駐測試網站與正式整合尚未完成；頁面不能核准或發布。2026-10-10再核對時，三個本機端口均未執行，工作區沒有Firestore export metadata，既有私有證據包也不含資料快照；不得為了開頁重新匯入已驗收原始資料。
3. 31項補證與雙人審核：P0=5、P1=15、P2=11。已整理[UX-18五款官方零件圖候選證據](CATALOG_UX18_OFFICIAL_EVIDENCE_CANDIDATES.md)，保持pending；缺少原廠包裝／說明書或台灣正式名稱時維持pending，不以商家交叉佐證自動核准。自動化不能代替兩名獨立人工審核者。
4. 正式App Check需確認註冊App IDs、provider及token驗證；Firebase 的 [Web CI debug provider](https://firebase.google.com/docs/app-check/web/debug-provider) 也需要在 Firebase Console 註冊且必須保密的 debug token，不能公開提交或用自簽替身冒充。正式IAM需指定服務帳戶及最小讀取／稽核範圍；TTL與稽核保留期限需使用者決策。現有expiresAt只是欄位，尚無TTL policy。這些正式設定未獲授權前不變更。
5. 目前 main 已前進27個提交。日後取得明確整合授權後，才在隔離整合分支納入當時最新 main、核對兩個 PR 的順序並跑最新 HEAD 全套回歸；只有資料載入／交易程式或固定來源改變時，才評估重跑原始197筆真實驗收。
6. 完成後呈現固定提交、CI、部署範圍及回退點供批准；本文件不授權合併、部署或正式資料寫入。

## 回退準備

- 每個未合併PR保留固定HEAD、差異與證據；分支更新使用expected SHA，不force push或覆蓋他人提交。
- 正式發布前另行記錄當時真正的Production部署ID、main SHA、build及對應artifact；本文件的main基準不是保證可用的正式回退版本。
- 前端回退應使用已驗證的前一正式artifact或受審查的revert，不能直接reset main；因revert也可能觸發部署，同樣需明確授權。
- 資料回退和前端回退分開：保留原始JSON、來源SHA、manifest、衍生版本与審核事件；不得用舊衍生資料覆寫原始研究實體。未批准任何正式匯入，因此目前沒有需要回退的正式圖鑑寫入。
- 整合或驗收出現安全／資料異常時停止該步，其他安全獨立工作可繼續；不得以合成測試掩蓋真實原始資料失敗。
