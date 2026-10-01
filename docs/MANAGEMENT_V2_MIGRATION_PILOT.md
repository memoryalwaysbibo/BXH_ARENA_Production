# Management V2 M1 — 模組化移轉先鋒

狀態：隔離候選，未合併、未部署、未完成正式入口切換。

## 固定基準

- source commit: `fdd1c73c7e61e97deb0c15c325057b6301bbec37`
- index Git blob: `ff61e00a1ed2ca15eff7af9a8de83aeff9141b92`
- Pages run: `36907698926`; artifact: `11185286801`.
- artifact ZIP SHA-256: `d8ee496bb60cc01d6dae84d2a68bb2649f2c98291af0435cf4dbc6f434e06c45`.

本分支只新增候選模組、移轉工具、驗證工具與紀錄，不覆寫根目錄 index.html，不改部署 workflow。不要將新增候選檔案誤稱為正式站已移轉。

## 第一批範圍

| 舊路徑 | 候選路徑 |
|---|---|
| management-ui-v2.js | modules/management-v2/navigation.js |
| management-ui-v2-adapter.js | modules/management-v2/adapter.js |
| management-ui-v2-bootstrap.js | modules/management-v2/bootstrap.js |
| management-ui-v2.css | modules/management-v2/styles.css |

四個檔案逐位元組保留。維持 classic script 與原載入順序，不同時改 ES modules 或延遲載入。interface-preference、我的介面、玩家身分顯示仍是共用模組，不隨意搬入 V2 私有目錄。

候選入口只改四個資源路徑。原路徑暫留相容；根目錄檔案仍為正式權威來源，候選副本不可獨立改功能。來源或候選出現差異時工具拒絕移轉，必須重新比對，不能放寬雜湊讓驗收通過。

V1/V2、Header、上方导航、既有 tab keys、switch-tab 事件與權限判斷均不改。保留五個可用群組，以及不可點擊的獵人建置中佔位。不修改 HC-00、報名、計分、結算、Firestore、Rules、Functions 或 Safety Gate。

## 重現

需 Python 3 與 Node.js；輸出必須是來源樹外、尚不存在的資料夾。

```sh
python3 tools/stage-management-v2-migration.py --source . --output /tmp/bxh-v2-m1
BXH_PILOT_ROOT=/tmp/bxh-v2-m1 node --test tools/verify-management-v2-migration.cjs
(cd /tmp/bxh-v2-m1 && node scripts/verify-production-frontend.cjs)
(cd /tmp/bxh-v2-m1 && node scripts/run-regression-core.cjs critical)
```

工具只在新 staging 目錄產生候選 index、四個模組、preview/smoke 路徑、manifest 與 patch。輸出存在、index/模組基準改變、引用數量異常、模組副本衝突時拒絕操作。正式來源不變；不得將 staging 工具接入正式部署以繞過審查。

## 本輪本機證據

- 正式前端 verifier：移轉前後均通過。
- 既有 critical regression：八組，移轉前後均通過。
- 移轉契約：14 項通過；其中一項對照全部 16,384 種可見 tab 子集合。
- Chromium 離線 DOM：管理員與工作人員的 UI manifest，390/1280px，基準/候選共八個情境通過；四組對照截圖逐位元組一致。
- 模擬儲存下的偏好 V1→V2、事件轉送、重掛載通過。這不是正式登入、後端授權、真實 localStorage/PWA 或實機驗收。
- 舊 smoke 有兩個寫死總群組=5的斷言失敗，原因為既有 Hunter placeholder。僅在候選測試改驗證五個可用群組，另由契約測試守住 disabled placeholder；候選 smoke 12 項通過。未刪除正式功能迎合測試。
- 瀏覽器 HTTP 導航受本機環境限制；離線 DOM 使用原檔案 bytes 注入，不得宣稱已通過真實網路載入/快取測試。

## 未完成的發布條件

重新核對最新 main；審查並將四路徑 patch 實際提交至施工分支；在該最終 commit 重新跑 CI。完成真實 HTTP 載入、手機/PWA、刷新/離線、權限與正式頁面人工驗收後，才可依單線發布流程提請合併部署。失敗回復整套版本，不單獨回復 index。

index 原為 2,396,168 bytes，候選為 2,396,206 bytes。這批先驗證安全移轉方法，不宣稱縮小 index 或加速；後續才按量測與依賴邊界抽離更多內嵌內容。其他案件不因本分支而被自動暫停或改排程。
