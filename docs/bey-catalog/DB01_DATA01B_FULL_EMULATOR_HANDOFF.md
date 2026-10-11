# DB-01｜DATA-01B 真實資料 Emulator 驗收交接（2026-10-09）

## 2026-10-10 更新

本文件其餘段落為 2026-10-09 歷史交接快照。最新 `46e379ac` 已以交接包原始 197 筆完成真正 Firestore Emulator 寫入與四階段收據 PASS；詳細結果與邊界見 [DB01_REAL_EMULATOR_RECEIPT.md](DB01_REAL_EMULATOR_RECEIPT.md)。最新三項 CI 成功，原始 JSON 未公開。歷史「未執行」及舊 CI 失敗狀態不代表本次結果。維持 Draft，仍不得自行合併或部署。

## 已有證據（歷史）
- 真實 DATA-01B JSON：197 個研究資料實體，包含來源 23、產品 9、零件 45、配色候選 11、顏色 9、方案 14、組合 16、內容關聯 52、待辦 18。
- 本機完成全部 197 筆參照／去重試算，73 筆中斷後補 124、重送新增 0；**不是 Firestore Emulator 寫入**。
- Firestore Emulator 前批規則驗證及交易式中斷恢復測試 CI 已成功。
- 本批新增 **197 筆合成資料** Emulator 容量與中斷測試；本次 CI 尚待最新 HEAD 結果。

## 真實 DATA-01B 的 Emulator 驗收工具
檔案：tests/bey-catalog-emulator/data01b-full-import.cjs

此工具需要事先提供的真實 catalog-research.json，不會從網路抓取，也不會自己下載圖片。必須在 Firestore Emulator 內執行：

    BXH_CATALOG_DATA01B_FILE=/absolute/path/to/catalog-research.json \
    npx firebase emulators:exec --only firestore \
      --project demo-bxh-catalog-db01 \
      --config tests/bey-catalog-emulator/firebase.json \
      "node tests/bey-catalog-emulator/data01b-full-import.cjs"

預期：第一次故意在第 73 筆中斷，恢復新增 124、已存在 73；再重送新增 0、已存在 197；所有資料維持 unpublished。

**本次尚未把真實 JSON 提交 GitHub 或執行上述命令**。因此不能將這個交接工具的存在宣稱為真實資料已完成 Emulator 驗收。

## 前端 CI 阻擋
- Validate Production Frontend RC1 run 37861039989 的 Deep E2E 失敗。
- multi-court-dispatch-deep.e2e.cjs:103 期望 4 個名單列，實際只有 1；其他驗證、Critical E2E、UI Smoke 成功。
- 本 PR 僅新增獨立圖鑑模組與測試，沒有修改既有名單流程；仍應調查失敗原因與重跑基準，不能擅自判為無關。
- 主線已從 72d6f4e 更新，合併前必須重新比對與執行全站回歸。

## 放行條件
1. 最新 CI 的 Emulator、Deep E2E 均成功。
2. 真實 DATA-01B 在 Emulator 實際匯入與恢復成功。
3. 核對資料來源、正式 Rules/IAM、回退與管理端隔離。
4. 保留 PR Draft，不自動合併或部署。
