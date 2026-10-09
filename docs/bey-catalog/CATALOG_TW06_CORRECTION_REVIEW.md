# BXH ARENA｜TW-06 台灣圖鑑修正審核流程

## 交付範圍
- 純函式 `catalog-tw06-review.cjs`，在 **TW-05 的 197 筆衍生資料副本** 上提出名稱／類別顯示修正。
- 允許：products、parts、variants、colors、assemblyClaims 的 `displayName`、`displayNameZhTW`；parts 額外允許 `categoryZhTW`。
- 禁止：商品／零件／色版 ID、原配 BOM、partId、category、來源、實物配色認證、selectable、publicationStatus 等任何影響實體或發布的欄位。
- 中文顯示名稱必須同時更新 `displayName` 與 `displayNameZhTW`，避免同一筆資料兩種顯示不同步。

## 提案、審核、差異、回退
1. 提案人提供理由（至少 12 字元）、HTTPS 來源、UTC 時間、目標紀錄與修正欄位。
2. 第一位審核者不可為提案人；第二位不可與提案人或第一位重複。
3. 任何拒絕直接終止草稿流程；審核通過仍只可 `approved_for_draft_only`，**不能發布**。
4. 變更前比對完整紀錄 SHA-256，若有人修改原始資料，返回 `TW06_STALE_RECORD`，不得覆蓋。
5. 生成的 TW-06-DRAFT 保留 before/after、原始 hash、來源 URL 與兩位審核者 ID。
6. 回退前比對修正後 hash；內容已遭其他人修改時拒絕回退，以免覆蓋後續變更。

## 安全界線
- **此模組沒有驗證 Firebase Auth 或管理員身分**。所有 reviewerId 都是測試／預覽用輸入；不可直接接在玩家前端作為正式授權。
- SHA-256 是資料完整性檢查，不是簽章或權限驗證；真實管理端須由 Cloud Functions／Admin SDK 取得 UID 並以 Firestore transaction 原子保存。
- 只允許 TW-05 研究衍生批次；保留 197 筆、`productionWritable=false`、`autoPublish=false`，不改原始 DATA-01B。
- 此批不會自動修改 BX-20 原配零件或 UX-18 原配內容；此類物理 BOM 修正須走另一套有原廠證據的流程。
- 不修改 ARENA 玩家收藏、賽事、比分、叫號、正式 Firestore Rules。

## 驗收
- `tests/bey-catalog-tw06-review.test.cjs`：修正差異、禁止危險欄位、雙人審核、拒絕狀態、草稿套用、版本衝突與回退。
- GitHub Actions `bey-catalog-zh-tw.yml` 執行，最新 HEAD 綠燈後才算此批測試完成。
- DB-01 真實 197 筆 Firestore Emulator 寫入仍需獨立 PR #462 驗收。
