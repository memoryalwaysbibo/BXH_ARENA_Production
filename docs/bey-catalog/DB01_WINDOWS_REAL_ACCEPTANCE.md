# DB-01｜Windows 本機真實 197 筆 Firestore Emulator 驗收

## 為何不直接合併 PR #462
已核對 `.github/workflows/deploy-production-pages.yml`：正式 main 的 `Validate Production Frontend RC1` 在 push 成功後，會透過 `workflow_run` 自動執行 GitHub Pages 部署。**即使 PR #462 只有驗收工具，合併主線也可能觸發正式 ARENA 重部署。** 因此在沒有明確部署授權前不合併。

## 不合併主線的安全替代方案
在 Windows 電腦安裝 Node.js 22、Java 21、Git，並可連上 npm registry。將 `catalog-research.json` 與 `run-data01b-windows.ps1` 放同一資料夾，在 PowerShell 執行：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\run-data01b-windows.ps1
```

腳本會：
1. 先驗證原始 JSON SHA-256 為 `2a53b4d0164d97a5f0607b4d4fd8a536a84b388530bca3eb371453f525cb7d42`。
2. Clone PR #462 專用分支至新的 `BXH_ARENA_DB01_TEST` 資料夾（若已存在則停止，避免覆蓋）。
3. 安裝隔離 Emulator 依賴，執行 SHA、9 類、197 筆、Manifest 安全檢查。
4. 僅啟動 `demo-bxh-catalog-db01` 本機 Firestore Emulator，執行第 73 筆中斷、恢復 124 筆、197 筆重送、逐筆核對與人工修改衝突測試。
5. 驗證輸出 `verifiedDocuments=197`、`manualCorrectionPreserved=true`、`published=0` 才回報 PASS；結果保存於 `DB01_197_Emulator_Result.txt`。

## 安全
- 真實研究 JSON **不提交 GitHub**，不放入 Pages 或 PR 工作流程。
- 腳本不執行 `firebase deploy`、`git push`、`gh pr merge`；不使用正式 Firebase 專案。
- 本機 Firestore Emulator 為短暫測試，不等於正式 Firestore 上線。
- 目前的 Node/Java 執行環境雖具備工具，但無法連線 npm registry（EAI_AGAIN），且缺 Firestore Emulator JAR，因此尚未在此環境完成實際寫入。
- 若使用者希望在 GitHub Actions 自動執行，仍需先經授權審核主線部署副作用，並設定 GitHub environment secret `BXH_DATA01B_GZIP_BASE64`。

## 驗收完成標準
完整日誌出現 `records:197`、`verifiedDocuments:197`、`manualConflicts:1`、`manualCorrectionPreserved:true`、`published:0`、`emulator:true`，且程序結束碼為 0；否則 DB-01 仍未結案。
