# TW-11｜與 ARENA 正式管理員權限規則對齊

> **後續狀態（2026-10-10）**：本文件保留當時批次的驗收邊界；原始197筆其後已在真實Firestore Emulator完成DB-01驗收，請以[PR #462固定收據](https://github.com/memoryalwaysbibo/BXH_ARENA_Production/blob/b770b0ee3d75ed5688bbcce7688cb212cc947e46/docs/bey-catalog/DB01_REAL_EMULATOR_RECEIPT.md)為準。此結果不代替31項內容審核或正式Firebase驗收。

## 正式規則核對
核對來源：`memoryalwaysbibo/BXH_ARENA_Functions_Deploy/production-firestore-rules/firestore.rules`，版本註記 v13.40.10（2026-10-06）。

正式 Firestore Rules 定義：
- `hasTestIdentity(d) = d.role == 'tester' || d.get('isTestAccount', false) == true`
- `isAdminData(d) = d.active == true && !hasTestIdentity(d) && (d.role == 'super_admin' || d.role == 'admin')`
- `staff` 與合作主辦權限並非圖鑑全域管理員，不應因其他賽事功能權限而取得審核權限。

## 本批修改
- 新增 `catalog-tw11-role-policy.cjs`，以同一個 `isActiveCatalogAdmin` 驗證 TW-08 唯讀閘門及 TW-09 Emulator 審核交易。
- TW-10 Firebase Admin adapter 透過 `projectTrustedUserProfile` 只投影 role、active、isTestAccount；不傳出私有 email、聯絡方式或其他 users 文件內容。
- 新增 `bey-catalog-tw11-role-parity.test.cjs`，包含 super_admin/admin、tester、staff、player、合作主辦、停用管理員、測試帳號、角色大小寫與非布林欄位；驗證不合法身分在載入研究資料前遭阻擋。
- CI 加入 TW-11 角色一致性測試。此測試與已查閱的規則版本對齊，但**無法保證未來正式規則更新後仍一致**；每次 Firestore Rules 角色語義變更須重跑與重新審核。

## 尚未完成的正式整合
1. 尚未部署 Cloud Function 或正式 Admin SDK 實例，亦未完成 App Check、速率限制及管理員角色任命審核。
2. `users/{uid}` 欄位語義已與正式規則比對；但尚未用正式站真實使用者資料進行任何讀寫驗證。
3. TW-09 審核仍為 Emulator-only，`approved_for_draft_only` 不等於正式發布。
4. DB-01 原始 197 筆 Firestore Emulator 全量寫入仍未驗收；不得以 TW-11 的安全測試替代。
5. PR #463 保持 Draft，不合併、不部署；不修改正式 Firebase Rules 或玩家／賽事資料。
