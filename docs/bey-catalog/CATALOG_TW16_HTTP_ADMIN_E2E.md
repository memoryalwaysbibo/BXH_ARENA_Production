# TW-16｜HTTP → Firebase Admin SDK → Firestore Emulator 端到端安全驗收

## 本批範圍
- 新增 `tests/bey-catalog-emulator/tw16-http-admin-e2e.test.cjs`，將 TW-13 HTTP v2 處理函式、TW-12 App Check/Auth/角色/稽核契約、TW-15 真正 Admin SDK Firestore 交易串成一條隔離測試路徑。
- 使用 **真實 Firestore Emulator** 讀取測試用 `users/{uid}` 角色文件並保存配額、稽核文件。
- 驗證活躍 super_admin 可查詢 31 項合成待審核工作；前 5 次成功且產生 5 筆伺服端稽核，第 6 次 HTTP 429。
- 玩家 HTTP 403、研究資料不讀取、拒絕事件仍稽核；錯誤 App Check、錯誤 Origin、撤銷 Token 在敏感資料讀取前拒絕。
- 確認配額與稽核文件 `emulatorOnly=true`，並確認未寫入正式產品 collection。
- `.github/workflows/bey-catalog-emulator.yml` 新增 TW-16 測試執行。

## 嚴格區別
1. 本測試的 Auth／App Check 驗證器是**明確標示的測試替身**，不是已接正式 Firebase Auth 或 App Check。
2. 31 項審核工作由 **合成 197 筆結構資料**產生，**不是** DATA-01B 真實 197 筆 Firestore Emulator 全量寫入。
3. 這是未部署的 HTTP handler factory，沒有建立正式 Cloud Function export，也沒有修改 ARENA 正式 Firestore Rules。
4. PR #463 保持 Draft；不合併、不部署、不改玩家收藏、賽事、比分、叫號。
5. DB-01 真實資料全量匯入仍由 PR #462 追蹤，完成前不得宣稱圖鑑資料庫已正式驗收。

## 下一個阻擋
- 必須確認最新 TW-16 Emulator CI 完整成功，再開始正式服務帳戶 IAM、App Check 及私有研究資料載入器的部署前審查。
- GitHub Environment Secret 注入的真實 DATA-01B fixture 尚待獨立手動驗收。
