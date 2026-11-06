# TW-07｜BXH ARENA 管理員手機版圖鑑審核預覽

> **後續狀態（2026-10-10）**：本文件保留 TW-07 當時的 UI 預覽邊界；DB-01 原始 197 筆真實 Firestore Emulator 驗收已完成，請以 [DB01_REAL_EMULATOR_RECEIPT.md](https://github.com/memoryalwaysbibo/BXH_ARENA_Production/blob/b770b0ee3d75ed5688bbcce7688cb212cc947e46/docs/bey-catalog/DB01_REAL_EMULATOR_RECEIPT.md) 為準。此頁仍是獨立唯讀預覽，未接正式 ARENA。

## 本批交付
- `bey-catalog-tw07-mobile-preview.html`：獨立手機直列式頁面，沿用 ARENA 深色底、螢光黃重點色、金色狀態標籤與卡片排版。
- 頂部呈現 TW-06 真實盤查的 31 個待審核事項：P0 原配 5、P1 名稱／來源 15、P2 配色 11。
- 預覽畫面只內建 **6 筆具代表性的示例卡**，不是 31 筆完整資料，也不會冒充已連上正式 Firebase。
- 可用 P0／P1／P2 篩選、搜尋、展開修正前後對照。所有示例文字以 escape 轉義後顯示。
- `catalog-tw07-mobile-model.cjs`：可對真實 TW-06 queue 產生唯讀模型，非管理員角色返回 denied；即使是 admin／super_admin 也只能預覽，不能核准或發布。
- `tests/bey-catalog-tw07-mobile-model.test.cjs` 與 `tests/bey-catalog-tw07-mobile-preview.test.cjs`：檢查角色顯示閘門、優先級篩選、唯讀、示例標示與無遠端寫入。

## 正式整合前的必要條件
1. **前端角色顯示不等於安全授權**。正式後端必須由 Firebase Admin SDK 驗證 ID Token、管理員權限、App Check、來源證據與草稿版本，並由 Firestore Rules 拒絕玩家直接寫入。
2. 將 31 項真實審核資料改由授權的後端唯讀 API 提供；此時才可以拿掉示例卡。
3. 建立來源照片／說明書附件查核、審核事件持久化、版本 diff、雙人獨立核准與 rollback 演練。
4. DB-01 真實 197 筆 Firestore Emulator 全量寫入仍未完成，不可將 UI 預覽視為資料庫驗收。
5. 需完成手機觸控、螢幕閱讀器、搜尋、長名稱截斷與資料量測試後才考慮正式站入口。

## 安全與回退
- 本批只新增獨立 HTML 預覽、唯讀模型與測試，**不修改 `index.html`、正式管理員選單、Firestore Rules 或 Cloud Functions**。
- PR #463 保持 Draft，尚未合併或部署。
