# 圖鑑隔離整合與回退準備

2026-10-10。這是可供審查的執行順序，沒有授權正式合併、部署或資料寫入。

## 已核對版本

| 項目 | 固定提交 | 結果 |
|---|---|---|
| main 最新讀取基準 | 74676300dc899a135ea5bac62a32c9935e7b6b5b | 僅讀取，未修改；部署工作流程仍只接受 main push 且最新驗證提交 |
| PR #462 | b770b0ee3d75ed5688bbcce7688cb212cc947e46 | 三項 CI 成功；原始197筆真實驗收見 DB01_REAL_EMULATOR_RECEIPT.md |
| PR #463 功能基準 | 04cc2337db5844437c6b72e1257b06f46093f641 | 三項 CI 成功；含真正 Functions Emulator HTTP 邊界、真實 Auth Emulator；後續若僅更新本文件，功能基準不變 |

兩個 PR 與目前 main 的共同基準仍是 `8e1cf07c8693bba6615d0758744569609f23538d`，目前各自落後 main 22 個提交；GitHub 在上述 HEAD 回報兩者皆 `mergeable=true`。先前針對舊 main／舊 HEAD 的 `git merge-tree` 結果只保留為歷史紀錄，**不能**當作目前 main 的整合證據。這次未將 main 合入任何 PR、未建立合併提交，也未執行組合後的全站驗收。

## 部署觸發與授權

最新基準的 .github/workflows/deploy-production-pages.yml 在 Validate Production Frontend RC1 完成後判斷 success、事件push、分支main，再執行Pages部署；即使只合併測試或文件，main push也有正式站重新部署風險。不得把「先合併測試」視為不會部署。PR分支目前不符合這個main部署條件；其他工作流程仍須在任何新操作前重新核對。

## 下一個安全執行順序

1. 保持#462、#463 Draft，避免重做已完成且未改動的真實資料驗收；每次以最新HEAD核對CI。
2. 實際 v2 SDK loopback HTTP 與真正 Functions Emulator URL 邊界已完成隔離驗收；除非相關程式或依賴變更，不重跑私有原始197筆或另造批次。App Check 仍是明確替身，不能把此結果說成正式雲端驗收。
3. 31項補證與双人審核：P0=5、P1=15、P2=11。可整理官方來源候選；缺少原廠包裝／說明書或台灣正式名稱時維持pending，不以商家交叉佐證自動核准。自動化不能代替兩名獨立人工審核者。
4. 正式App Check需確認註冊App IDs、provider及token驗證；Firebase 的 [Web CI debug provider](https://firebase.google.com/docs/app-check/web/debug-provider) 也需要在 Firebase Console 註冊且必須保密的 debug token，不能公開提交或用自簽替身冒充。正式IAM需指定服務帳戶及最小讀取／稽核範圍；TTL與稽核保留期限需使用者決策。現有expiresAt只是欄位，尚無TTL policy。這些正式設定未獲授權前不變更。
5. 目前 main 已前進22個提交。日後取得明確整合授權後，才在隔離整合分支納入當時最新 main、核對兩個 PR 的順序並跑最新 HEAD 全套回歸；只有資料載入／交易程式或固定來源改變時，才評估重跑原始197筆真實驗收。
6. 完成後呈現固定提交、CI、部署範圍及回退點供批准；本文件不授權合併、部署或正式資料寫入。

## 回退準備

- 每個未合併PR保留固定HEAD、差異與證據；分支更新使用expected SHA，不force push或覆蓋他人提交。
- 正式發布前另行記錄當時真正的Production部署ID、main SHA、build及對應artifact；本文件的main基準不是保證可用的正式回退版本。
- 前端回退應使用已驗證的前一正式artifact或受審查的revert，不能直接reset main；因revert也可能觸發部署，同樣需明確授權。
- 資料回退和前端回退分開：保留原始JSON、來源SHA、manifest、衍生版本与審核事件；不得用舊衍生資料覆寫原始研究實體。未批准任何正式匯入，因此目前沒有需要回退的正式圖鑑寫入。
- 整合或驗收出現安全／資料異常時停止該步，其他安全獨立工作可繼續；不得以合成測試掩蓋真實原始資料失敗。
