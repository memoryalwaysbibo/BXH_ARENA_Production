# BXH ARENA — DB-00/DB-01 安全基線（2026-10-09）

本批為隔離測試起點，不是正式 Firestore 接線，沒有 production writer。

## 已確認
- 主線觀察基準：72d6f4e13d478ddbf6cf66cde0903666bd479758。
- validate-production-frontend.yml：PR 與 main push 驗證。
- deploy-production-pages.yml：main push 驗證成功後可能自動部署 Pages，故本 PR 不合併。
- emulator-e2e.yml：使用 demo-bxh-arena-e2e / tests/e2e/firebase.json 的 auth、firestore Emulator。
- management-ui-v2-bootstrap.js 已有 V1/V2 掛載與退路；不得覆寫既有道具管理 inventory-catalog-ui.js。

## 本批內容
- modules/bey-catalog/safety-gate.cjs：拒絕 production project、非 demo project、非 loopback emulator，資料批次維持 dry-run。
- tests/bey-catalog-safety-gate.test.cjs：5 個安全邊界測試；執行 node --test tests/bey-catalog-safety-gate.test.cjs。
- 沒有修改 index.html、Rules、CI workflow、Firebase、Scheduler、玩家資料或賽事資料。

## DB-00 尚待驗收
1. 核對實際後端 Firestore Rules、IAM、管理員 writer 與部署觸發。
2. 在 Emulator 執行 Auth/Firestore Rules 測試，確認玩家不可修改目錄、來源工作者不能讀玩家資料。
3. 核對後端倉庫及隔離測試專案，禁止任何 production fallback。
4. 完成全站回歸、資料遷移及回退演練。

## DB-01 仍待實作
Firestore reader/writer、權限、索引、正式 schema 轉換與資料驗證；目前程式僅為安全前置閘門，不能視為 DB-01 完工。

## 回退
撤回本 PR 或移除新增檔案即可；尚未啟用任何雲端功能，無需修改正式資料。
