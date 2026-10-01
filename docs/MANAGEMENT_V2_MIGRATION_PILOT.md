# Management V2 M1 — 模組化移轉先鋒

## 現在的邊界

PR #293 保持 Draft。施工分支已接線，未合併 main、未部署正式站。

接線 commit：`898412d979fdfab788cad8f6188d7bcb41878063`。只在施工分支把 index 的四個 V2 資源路徑換到新目錄，並同步 preview/smoke 與移轉 manifest。根目錄舊資源保留相容；不改功能、權限、資料、計分規則或既有正式部署流程。

一次性 branch writer 完成後已從現行 pilot workflow 移除：只保留 `contents: read`、`persist-credentials: false` 的驗證，不保留自動 commit/push。這份紀錄提交後，仍須對新的最終 head 重跑既有完整 CI，不能拿前一個 commit 的 PASS 代替。

## 固定來源與檔案

- baseline main：`fdd1c73c7e61e97deb0c15c325057b6301bbec37`
- 原 index blob：`ff61e00a1ed2ca15eff7af9a8de83aeff9141b92`（2,396,168 bytes）
- 接線 index blob：`f5c5d2205d26aeedd340c8a822b4f3fecefa377b`（2,396,206 bytes）
- baseline Pages run：`36907698926`；artifact：`11185286801`
- baseline ZIP SHA-256：`d8ee496bb60cc01d6dae84d2a68bb2649f2c98291af0435cf4dbc6f434e06c45`

| 原檔（暫留相容） | 新引用 |
|---|---|
| management-ui-v2.js | modules/management-v2/navigation.js |
| management-ui-v2-adapter.js | modules/management-v2/adapter.js |
| management-ui-v2-bootstrap.js | modules/management-v2/bootstrap.js |
| management-ui-v2.css | modules/management-v2/styles.css |

四個模組逐位元組相同。維持 classic script 與原載入順序；interface-preference、my-interface-ui、player-identity-ui 留在原位。V1/V2、既有 tab keys、switch-tab、五個可用群組與不可操作的 Hunter 佔位均保留。

這是安全移轉方法的試點，不是體積/效能改善成果。沒有縮小 index，沒有聲稱加速。

## 2026-10-02 實際驗證

本機重跑：14/14 移轉契約、既有前端 verifier、8 組 critical regression 通過；17 項 HTTP server transport 檢查通過。原/候選的離線 DOM 八情境與四對截圖一致。本機 Chromium HTTP 導航仍受 ERR_BLOCKED_BY_ADMINISTRATOR 限制，沒有修改環境政策來繞過限制。

首次雲端 run `36913410964` 因 container Git ownership 前置作業失敗；接線步驟 skipped。commit `acfc7326a8dba64607171a457ab4819c66be881e` 只加入當次 checkout 的 safe.directory，未使用萬用信任、未放寬 SHA/路徑檢查。

重跑 run `36913575464` / job `110541947758`：

- 14 項 exact-byte/導航契約通過，其中包含 16,384 種可見 tab 子集合。
- 前端 verifier 與 8 組 critical regression 通過。
- 8/8 Chromium HTTP 測試通過：管理員/工作人員 UI manifest × 390/1280px；真實 HTTP 資源 bytes、V1/V2 真實 localStorage 與 reload、remount 單次事件；smoke 12 個斷言；舊 URL bytes；導航或 adapter 載入失敗回退 V1。
- 通過後才提交四個白名單檔案；固定 main 與施工分支 head 再檢查，非 force push。
- artifact `11188536664`；ZIP SHA-256 `deb6c3a976e0a10c9c580887a423a5e15a70db0336f9c4ac4526c437bbd9e5d9` 已下載核對；artifact 內記錄的接線 commit 與遠端 PR head 一致。

HTTP 測試是隔離 fixture：沿用實際 index 中的資源 URL 與實際模組 bytes，但不載入整站、不登入 Firebase；提供的是 UI 可见 tab 清單，不是後端授權驗收。瀏覽器為 Chromium 的兩種 viewport，不是真 iPhone/Android。Service Worker 被禁用、fixture 不使用快取，因此不是 PWA、離線重開或正式 CDN 快取驗收。

## 重現（已接線分支）

```sh
node --test tools/verify-management-v2-migration.cjs
node scripts/verify-production-frontend.cjs
node scripts/run-regression-core.cjs critical
# 安裝 package.json 的固定 Playwright 版本及相容 Chromium 後：
npx playwright test --config=tools/management-v2-http.config.cjs
```

`tools/stage-management-v2-migration.py` 仍是原始基準的一次性工具；已接線的 index 不應再次套用，工具拒絕是預期行為。Pilot gate 固定目前基準，若 main 或 index 改變，需要重新核對依賴與差異，不可單純放寬雜湊讓測試通過。

## 尚未完成

對最終提交重跑完整既有 CI、檢查真實頁面/角色、手機/PWA/快取更新及必要人工驗收。發布前再確認 main 與其他未完成案件沒有交疊；依單線流程部署並保留整套回復版本，不單獨回復 index。其他案件沒有因本 PR 自動暫停或改排程。HC-00、Functions、Rules、報名與結算均不在此次移轉範圍。
