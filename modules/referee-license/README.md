# 裁判證前端

裁判證、九階晉升進度與 100～1,000 人賽事成就由獨立模組渲染。個人累積、正式授予、照片與回補紀錄全部來自伺服器 snapshot；正式模組沒有示範帳號或預設經歷。

## 入口與開關

- 玩家個人中心：`我的執勤` 顯示裁判證與本人照片維護；`我的成就` 顯示十項裁判成就。
- 最高管理員：`裁判管理` 可搜尋裁判、新增／修改／撤銷／恢復回補、正式授予與指定唯一裁判長。
- `index.html` 在主程式前依序載入 `domain.js`、`ui.js`，另載入 `styles.css`。
- 前端開關 `window.BXH_REFEREE_CERTIFICATES_V1` **預設為 `false`**；主程式只有在旗標為 `true` 時接通入口和動作。後端另有 `systemConfig/refereeCertificatesV1.enabled` 開關。這兩個開關須在有權限的環境設定中一起規劃啟用；載入前端檔案不會啟用正式功能。
- callable bridge 為 `window.engagementService.refereeLicense(payload)`。後端部署、資料讀取與權限規則見 `referee-certificates/README.md`。

## 模組 API

```js
window.BXHRefereeLicense.renderDuty(ctx);         // 同步回傳 HTML
window.BXHRefereeLicense.renderAchievements(ctx); // 同步回傳 HTML
window.BXHRefereeLicense.renderAdmin(ctx);        // 同步回傳 HTML
window.BXHRefereeLicense.handleAction(action, element, ctx);
window.BXHRefereeLicense.resetSession();
```

`ctx` 由主程式提供：

```js
{
  uid, user, isSuperAdmin, epoch,
  currentSession: () => ({ uid, epoch, isSuperAdmin }),
  rerender,
  onRefereeAchievements, // 切換主程式成就子頁後回傳 true；其他畫面可回 false
  onHunterAchievements  // 選用，返回既有獵人成就
}
```

所有動作使用 `referee-license-` 前綴。Render 首次讀取時會發起非同步 `get`，回覆確認後呼叫 `rerender`。快取依登入 UID 與 `epoch` 隔離；每次非同步回覆也會核對 `currentSession()`。登出或更換帳號時呼叫 `resetSession()`。

所有修改都附 `operationId`、`expectedRevision`、`targetUid`。連線中斷後的「重試原操作」沿用完整原 payload，避免重複回補。版本衝突會重新讀取，保留草稿供管理者核對，且不自動重送。畫面不樂觀修改正式累積，只有成功回覆的 snapshot 能更新已認列數量。

本人只可修改自己的照片；回補、授予、搜尋與裁判長指定維持最高管理員權限，後端仍是最終權限判定。照片支援 JPG／PNG／WebP 原始檔，前端上限 8 MiB，置中裁為 3：4、600 × 800 JPEG，輸出不超過 450,000 bytes／600,000 字元 data URL。未授證時也使用頂層 `snapshot.photoDataUrl` 保存與顯示照片。

資料不完整時顯示已核對累積並停用正式授予；不把讀取錯誤當成零。已授予等級保留。活動尚未完成的有效判決可先計入判決量，賽事次數及規模經歷待活動完成；來源列表分開標示已計入、待認列與未計入原因。

## 驗證

在專案根目錄執行：

```sh
node tests/referee-license-ui.test.cjs
node tests/referee-license-browser.cjs
```

Node 測試涵蓋 UID／epoch 晚回覆隔離、表單與伺服器狀態、同次操作重試、版本衝突、包含式規模預覽、本人照片權限與裁判長快取。瀏覽器測試需已安裝 Playwright 及 Chromium，可用 `BXH_TEST_BROWSER` 或 `PLAYWRIGHT_CHROMIUM_EXECUTABLE` 指定既有瀏覽器；也接受執行環境的 `CODEX_PRIMARY_RUNTIME_NODE_MODULES`。測試全數攔截網路、使用獨立 fixture，不連正式 Firebase。涵蓋 320／390／768 寬度、明暗外觀、實際照片轉檔，以及回補新增／修改／撤銷／恢復。

手機驗證截圖輸出到 `/tmp/bxh-referee-production-duty-320.png`、`/tmp/bxh-referee-production-achievements-320.png`、`/tmp/bxh-referee-production-admin-320.png`。

## 稱號字型

九階稱號優先使用系統標楷體 `DFKai-SB`／`BiauKai`，缺少時使用隨模組附帶的全字庫正楷子集。子集擷取自已核准的工作區字型資產，沒有另行下載商業字型；來源為數位發展部 CNS11643 全字庫，選用政府資料開放授權條款第 1 版。來源、授權連結與子集說明完整保留在 `fonts/LICENSE.md`。
