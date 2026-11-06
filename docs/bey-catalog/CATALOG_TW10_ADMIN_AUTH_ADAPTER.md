# TW-10｜Firebase Admin SDK 身分驗證接線契約（未部署）

## 已提交
- `catalog-tw10-admin-adapter.cjs`：供可信伺服端傳入已初始化的 Firebase Admin Auth、Admin Firestore 與私有研究資料載入函式。
- 對每次查詢呼叫 `adminAuth.verifyIdToken(token, true)`，強制要求檢查已撤銷的 Token。
- 從 **Admin Firestore 的 users/{uid}** 讀取角色與狀態；只允許 active admin / super_admin、排除測試帳號；不信任前端傳入的 role 或資料集。
- 身分檢查通過後才呼叫私有 `loadResearchBatch()`，僅允許 TW-05 197 筆未發布研究批次，再交給 TW-08 唯讀清單閘門。
- 回傳 31 項待審核工作之篩選與分頁結果，不含核准、發布、Firestore 寫入能力。
- `tests/bey-catalog-tw10-admin-adapter.test.cjs`：撤銷 Token、角色偽造、停用與測試帳號、資料集污染、無依賴 fail-closed。

## 安全界線與待辦
1. 本批**只是可接 Firebase Admin SDK 的後端介面**；沒有初始化正式 Firebase Admin SDK、部署 Cloud Function、建立 HTTPS 路由或變更正式 Firestore Rules。
2. `users/{uid}` 的角色欄位與正式 ARENA 權限架構仍須核對，不能因測試使用 role=admin/super_admin 就推論正式站已採同一套欄位。
3. 需在正式受控後端整合 App Check、速率限制、操作稽核、權限任命流程與私有 TW-05 資料來源；前端角色顯示不可取代後端驗證。
4. TW-09 審核寫入仍為 loopback Emulator-only，使用測試 Token verifier；尚未可供正式管理員核准。
5. DB-01 真實 197 筆 Firestore Emulator 全量匯入仍在 PR #462 待驗收，不能宣稱 DB-01 結案。
6. PR #463 維持 Draft，不合併、不部署；玩家資料、賽事與比分未改。

## 回退
- 新增純函式與測試可獨立撤回，不修改正式站任何資料或路由。
