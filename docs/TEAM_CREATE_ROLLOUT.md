# 建立戰隊接線與開放條件

本變更把既有 PR #607 的瀏覽器元件接入目前主選單，不合併過時的 Core。
`BXH_TEAM_FULL_ENABLED=false`；管理員唯讀預覽維持運作。完整元件僅在明確啟用時載入，進入戰隊頁才查資料，離頁、登出與帳號切換會清除元件。

建隊流程：讀取 teamRead/mine 的 creationCapacity → 檢查是否已有戰隊與名額 → 填寫 2–24 字名稱、選隊徽 → teamCommand/create → 回讀 mine 確認隊長身分與新戰隊。

目前尚未在正式環境執行：

1. 回讀 teamCommand、teamRead、teamEmblemUpload 與原戰隊背景函式的版本／旗標，核對原本已部署服務；不能用歷史回讀取代現在狀態。
2. 在寫入關閉期間，以後端候選的 createCapacityBootstrap 核對 teamsV1 的 active 數量及 teamCapacityControlV1/current。既有計數不一致時需處理原因；不可直接填 0。初始化是一筆正式資料寫入，需用實際來源計數。
3. 核對最新正式 Firestore 規則／索引、隊徽桶及 App Check／Auth，包括停用、測試及非啟用帳號的伺服器拒絕路徑。前端隱藏入口不代表後端授權。原後端候選 PR #245 尚未合併。
4. 決定並驗證完整後端啟用範圍。BXH_TEAMS_ENABLED 控制的不只有建立，還包括加入、審核、投影、經驗與背景維護。建立後的公開投影及人數不足 24 小時解散規則需一併驗證；不能只為一個按鈕直接全開。
5. 完整 CI 通過，完成後端受控開放與回讀後，另提啟用前端旗標的變更。以真實帳號驗收建立、重試、我的戰隊、名額及公開清單；本 PR 的合成 API 測試不代替正式寫入驗收。

回復前端：將 BXH_TEAM_FULL_ENABLED 關閉並重新整理；管理員唯讀預覽會恢復。後端旗標回復必須涵蓋實際啟用的函式與背景服務，不能只關閉前端。

## Cloud Shell 第一階段：只讀回讀

以下不變更旗標或資料：

```bash
for bxh_function in teamCommand teamRead teamEmblemUpload; do
  gcloud functions describe "$bxh_function" \
    --gen2 --project=bxh-arena --region=asia-east1 \
    --format='yaml(name,state,buildConfig.runtime,serviceConfig.environmentVariables.BXH_TEAMS_ENABLED)'
done
```

之後再依實際回讀準備計數核對／初始化命令，避免使用未確認版本或直接開啟功能。
