# BXH ARENA｜TW-08 真實審核資料唯讀閘門

## 本批已提交
- `catalog-tw08-read-gateway.cjs`：供未來**可信後端**注入 `verifyIdToken`、`loadUserByUid`、`loadResearchBatch` 的唯讀查詢契約，**不是已部署的 Cloud Function**。
- 每次請求先驗證 ID Token（介面要求 revoked check），從可信資料庫讀取 active admin/super_admin 且非測試帳號，再讀取研究資料；玩家、訪客、停用管理員、測試帳號均不得取得清單。
- 從受控 TW-05 197 筆研究資料即時計算 TW-06 待審核項目，預期現有版本是 31 項：P0 5、P1 15、P2 11。
- 只回傳必要的隊列欄位，不回傳原始來源文件、私密研究 JSON 或使用者資料；管理員仍僅可唯讀，不可核准或發布。
- 支援 P0/P1/P2、關鍵字搜尋、每頁 1–20 筆，含資料指紋的 cursor；查詢或清單變動時拒絕沿用舊 cursor。
- `bey-catalog-tw08-read-gateway.test.cjs`：31 項分頁 10/10/10/1、權限、停用與測試帳號、撤銷 token、偽造 cursor、錯誤批次、搜尋篩選、無寫入。
- 已用本機既有真實 `TW06_待審核清單.json` 與 `catalog-research-zh-TW-TW05.json` 產出 **31 項完整資料的離線手機 HTML 預覽**，不把私有研究資料放進公開 GitHub；此 HTML 在工作區供下載，並未接到正式網站。

## 正式接線前必要條件
1. 目前 `verifyIdToken` 等為注入契約，尚未接入正式 Firebase Admin SDK／Cloud Functions；前端角色提示不是安全授權。
2. 需由受控伺服端保存 TW-05 研究資料、完成 DB-01 原始 197 筆 Firestore Emulator 寫入驗收，再建立正式唯讀資料路徑。
3. 正式 API 必須加上 App Check、權限角色來源校驗、稽核與速率限制；不得將 `loadResearchBatch` 交給客戶端控制。
4. 不能將本機離線 HTML 或內嵌清單當成正式後端授權頁面。
5. 本批沒有修改 `index.html`、正式 Firestore Rules、Cloud Functions、玩家、比分或賽事資料；PR #463 保持 Draft。

## 回退
- 純函式模組與測試均在獨立分支；刪除 TW-08 模組或回退該 PR 即可，不會改寫正式資料庫。
- TW-06 的審核草稿與 TW-05 原始衍生版本不受影響。
