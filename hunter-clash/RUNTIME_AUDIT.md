# HC-00 唯讀 runtime 核對

`runtime-audit.cjs` 採集既有正式專案 `bxh-arena` 的 Functions v1/v2 清單，以及 Firebase Rules releases 與其指向的 rulesets。這是部署基線讀取工具，不部署、不修改 Rules、不啟用入口，也不操作賽事資料。

## 執行

在已具備核准 Google Cloud 存取權的操作環境執行；需要 Node 22 與已登入的 gcloud。工具只取得該環境既有登入的 access token，不執行登入或變更專案設定。所需讀取權限包括 `cloudfunctions.functions.list`、`firebaserules.releases.list` 與 `firebaserules.rulesets.get`。

```sh
node hunter-clash/runtime-audit.cjs --project bxh-arena --out /tmp/hc00-runtime-audit.json
```

只接受此專案，所有 API 請求使用 GET、固定官方端點與拒絕重新導向。各請求限時 30 秒、各清單最多 100 頁；重複分頁、重複資源、跨專案參照、無法連線的區域或錯誤回應都標示 INCOMPLETE。單一元件失敗不冒充空清單；其 records 清空，其餘元件仍可採集。

輸出保留 Functions 資源名稱、版本、runtime、build/revision 與更新時間，Rules 保留 release/ruleset 名稱與各來源檔的 SHA-256、UTF-8 位元組數。Token、環境變數、秘密、下載網址、原始 Rules 與錯誤回應內容不寫入報告。缺少可用 gcloud token 時直接失敗，不產生空白的成功報告。

退出碼 0 表示採集請求完成；1 表示失敗或不完整。`COLLECTED` 可以是有效的空清單，也不保證 HC 已部署。`runtimeReconciled` 與 `hcDeploymentVerified` 始終為 false；工具不更新 checkpoint 或發布 gate。

## 核對標準

1. 核對採集的 project、時間、Functions 兩代清單與各地區完整性；確認需要的 function 與 Firestore release 存在。沒有需要的資源不能驗收。
2. 用可信的部署工作流、來源 commit、建置與 runtime 版本建立對照；Functions 版本欄位本身不能證明來源 commit。
3. 將部署的 Rules 檔雜湊與同一可信來源逐檔比對；檔案名稱、內容及版本均需吻合。manifest 雜湊依排序後的 `{name, bytes, sha256}` JSON 計算，不是來源 commit 雜湊。
4. 清單與 Rules 讀取是分次請求，並非原子快照。核對期間如有部署或 release 更動，重新採集並確認穩定。
5. 經獨立專案部署、正式 Token／撤銷、IAM／App Check 與工作人員內部實戰驗證後，才處理相應驗收項目。不可直接把採集結果當成 PASS。

本機仍未安裝 gcloud；2026-09-30 經授權的後端 GitHub workflow 已取得真實報告，見 audit/20260930-36696307510。單元測試使用注入的 API 回應，證明工具行為，並非線上版本證據。

## 官方 API 參考

- [Functions v1 list](https://docs.cloud.google.com/functions/docs/reference/rest/v1/projects.locations.functions/list)
- [Functions v2 list](https://docs.cloud.google.com/functions/docs/reference/rest/v2/projects.locations.functions/list)
- [Rules releases list](https://firebase.google.com/docs/reference/rules/rest/v1/projects.releases/list)
- [Rules rulesets get](https://firebase.google.com/docs/reference/rules/rest/v1/projects.rulesets/get)

## 固定來源比對

`rules-source-reference.json` 固定候選來源 commit `462287fdb86f6df6b71a0966c25405ca925fcdc7`。已從該 commit 讀取 firestore.rules，驗證其 Git blob 與 FIRESTORE_RULES_SOURCE.sha256 一致；沒有把這份來源部署至正式站。

取得實際報告後執行：

```sh
node hunter-clash/compare-runtime-rules.cjs --inventory /tmp/hc00-runtime-audit.json
```

工具只讀報告與版本固定的來源清單，輸出 MATCH／MISMATCH／BLOCKED；退出碼為 0／1／1。檢查 project、採集完整性、觀測時間、預設 Firestore release、唯一 ruleset、完整檔案清單、位元組數及 SHA-256。接受 cloud.firestore 與 cloud.firestore/(default) 名稱；兩者同時存在時必須指向同一 ruleset。重複／跨專案參照、缺少／多出檔案、錯誤雜湊均會拒絕或列出差異。

MATCH 只表示這次快照的 Rules 內容符合候選來源。清單雜湊可驗證內部一致性，不能驗證報告取得者的身分或原始 API 回應真實性；報告仍需可信採集與稽核保存。工具不認證 Functions 來源，也不判斷快照是否仍為現行版本，部署有變動時必須重新採集。runtimeReconciled／hcDeploymentVerified 始終為 false，不更新發布 gate。


首次真實採集由 main commit 036369e2430f60ea7cab55bcfb514f9df7f5734b 的 run 36696307510 完成。採集為 COLLECTED，原候選 Rules 比對 MISMATCH，整體 job 失敗。另取得相同現行 Rules 的來源內容，尚未建立完整 Functions 部署對照；發布 gate 保持阻擋。
