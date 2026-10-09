# 圖鑑隔離整合與回退準備

2026-10-10。這是可供審查的執行順序，沒有授權正式合併、部署或資料寫入。

## 已核對版本

| 項目 | 固定提交 | 結果 |
|---|---|---|
| main 相容性基準 | 8517cb98fcbdd00b743798e4c563501e199b1d49 | 僅讀取，未修改 |
| PR #462 | b770b0ee3d75ed5688bbcce7688cb212cc947e46 | 三項 CI 成功；原始197筆真實驗收見 DB01_REAL_EMULATOR_RECEIPT.md |
| PR #463 | 4f2958d8bf7f0c63f227c8fc9986b638f4c233c9 | 三項 CI 成功；真實資料31項pending、Auth與私有載入器隔離驗收 |

git merge-tree --write-tree 的離線計算皆退出0：main+#462 tree b5a38191abf38b2bf7fe1ce40b59a0943ae551e4、main+#463 tree b82209e77b7c84960617b0f9be4334f03eb1164f、#462+#463 tree 7d9584a55c0a46f2016ad355fec75008aca508ad。這只是固定提交的文字相容性檢查，沒有建立合併提交、改動分支或執行組合後的全站驗收，不代表可直接發布。

## 部署觸發與授權

最新基準的 .github/workflows/deploy-production-pages.yml 在 Validate Production Frontend RC1 完成後判斷 success、事件push、分支main，再執行Pages部署；即使只合併測試或文件，main push也有正式站重新部署風險。不得把「先合併測試」視為不會部署。PR分支目前不符合這個main部署條件；其他工作流程仍須在任何新操作前重新核對。

## 下一個安全執行順序

1. 保持#462、#463 Draft，避免重做已完成且未改動的真實資料驗收；每次以最新HEAD核對CI。
2. 可在新的隔離工作目錄檢查實際HTTP傳輸與Cloud Functions v2 onRequest依賴；禁止匯入正式入口、初始化正式Firebase或解除固定demo／loopback guard。測試替身、實際SDK、實際HTTP與正式環境結果分別標示。
3. 31項補證與双人審核：P0=5、P1=15、P2=11。可整理官方來源候選；缺少原廠包裝／說明書或台灣正式名稱時維持pending，不以商家交叉佐證自動核准。自動化不能代替兩名独立人工審核者。
4. 正式App Check需確認註冊App IDs、provider及token驗證；正式IAM需指定服務帳戶及最小讀取／稽核範圍；TTL與稽核保留期限需使用者決策。現有expiresAt只是欄位，尚無TTL policy。這些正式設定未獲授權前僅準備審查，不變更。
5. 日後取得明確授權後，才重新抓main、核對差異與整合次序，在隔離整合分支跑適當回歸和必要的原始197筆驗收，再呈現固定提交、CI、部署範圍及回退點供批准。此文件不授權該步。

## 回退準備

- 每個未合併PR保留固定HEAD、差異與證據；分支更新使用expected SHA，不force push或覆蓋他人提交。
- 正式發布前另行記錄當時真正的Production部署ID、main SHA、build及對應artifact；本文件的main基準不是保證可用的正式回退版本。
- 前端回退應使用已驗證的前一正式artifact或受審查的revert，不能直接reset main；因revert也可能觸發部署，同樣需明確授權。
- 資料回退和前端回退分開：保留原始JSON、來源SHA、manifest、衍生版本与審核事件；不得用舊衍生資料覆寫原始研究實體。未批准任何正式匯入，因此目前沒有需要回退的正式圖鑑寫入。
- 整合或驗收出現安全／資料異常時停止該步，其他安全獨立工作可繼續；不得以合成測試掩蓋真實原始資料失敗。
