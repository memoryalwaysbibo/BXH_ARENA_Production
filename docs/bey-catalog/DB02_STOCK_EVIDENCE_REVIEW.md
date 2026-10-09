# DB-02｜原配組合證據分級與審核閘門（2026-10-09）

## DATA-01B 真實資料稽核
來源：DATA-01B-20261009 研究 JSON（197 個資料實體）。
- 16 筆原配／單一拆件關聯
- 10 筆：結構完整、有官方來源與直接／交叉證據，可送管理員再次核對
- 5 筆：商家清單候選，須補官方來源，禁止直接發布
- 1 筆：單一 CX 紋章零件，非完整陀螺，不可建立完整組裝相容規則
- 0 筆已管理員核准、0 筆已發布、0 筆自動標示可供玩家選配

## 新增程式
- modules/bey-catalog/stock-evidence-candidates.cjs：依 group、contentClaims、來源 authority、結構與驗證等級分類。
- scripts/bey-catalog-stock-audit.cjs：對完整 JSON 執行唯讀證據分類。
- tests/bey-catalog-stock-evidence.test.cjs：官方原配、商家候選、單一拆件、審核欄位及缺來源阻擋。

## 權限與相容性界線
- 「官方原配」只證明**這組完整原配的來源候選**；不能推論跨包改裝、其他配色版本或任意零件可互換。
- 即使經管理員核對，仍只產生 unpublished 的 rule draft，沒有自動進入公開目錄或變更 selectable。
- sourceRechecked 及 reviewerId 為純函式輸入，不能代替後端身份驗證；未來必須在受控 Cloud Functions／IAM 重新驗證角色與權限。
- 不把圖片使用權、發售日期、賽規准用狀態與物理相容性混成同一欄位。
- 資料修正須走不可變 release、差異預覽與回退，不覆蓋玩家歷史紀錄。

## 未完成
- DATA-01B 真實 197 筆 Firestore Emulator 寫入與恢復驗收仍待執行。
- 尚無正式來源再次人工核對與管理端簽核。
- 尚未建立 Firebase 正式權限與玩家圖鑑 UI。
- 本 PR 維持 Draft，等待最新 CI 成功與工程驗收。
