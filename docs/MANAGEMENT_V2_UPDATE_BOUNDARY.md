# V2 M1 — 更新提示與 PWA 邊界補驗

本輪基於施工 head `50251b6aac1ea87d40afd2f8de0eecdf52eb992a`。只新增測試與紀錄，並在既有唯讀 pilot CI 增加測試命令。不改應用程式、index、version.json、正式部署 workflow、推播、資料或 HC-00。

## 已執行

本機對 index Git blob `f5c5d2205d26aeedd340c8a822b4f3fecefa377b` 抽取真正的 `bxhFreshVersionGuard`，在 Node VM／模擬 DOM、fetch、storage 下新增 12 項契約測試，12/12 PASS。原 14 項移轉契約重跑亦 PASS。此處不是實際瀏覽器或 Firebase 登入驗收，keep-login 僅是儲存區的測試 sentinel。

涵蓋：三處 build 一致、相同 build 不提示、不同 build 只顯示一次且不自動跳轉、手動更新保留網址參數與 hash、保留模擬偏好、版本 fetch 的 no-store 與同源設定、網路錯誤與恢復、HTTP/JSON 錯誤、storage 不可用、DOM 延後建立、檢查節流、15 秒重複提示抑制，以及 PWA manifest／push worker／註冊來源未變。

重現：`node --test tools/verify-management-v2-update-contract.cjs`。遠端結果需依新提交的 CI run 查核，不能沿用先前 head 的成功。

## 發布前仍需處理的版本標記

候選版和既有 main 均為 build `20261001.4`。更新程式只有在 version.json.build 不等於頁面 CURRENT_BUILD 時顯示更新提示。因此只切四個模組 URL、維持相同 build，已開啟的舊頁面不會因這次搬移收到新版本提示；使用者重新載入是另一條路徑。

這是尚未發布的候選版需要完成的 release preparation，不應誤稱正式站故障。形成發布候選時，須從當時最新 main 核對一個新的 build，同步更新 meta bxh-build、CURRENT_BUILD、version.json，再審查新增的 diff 並重跑最終 CI。現有嚴格 index blob／四路徑還原檢查會因合法版本修改而失敗，必須以明確的允許差異調整驗證，不可盲目換 hash 或刪檢查讓它變綠。此輪未執行版本切換或部署。

## PWA／快取不能混為一談

- manifest start_url/scope、叫號 worker 以及 court-call 註冊程式和基準逐位元組一致。
- 現行自訂 worker 處理推播與點擊，沒有自己的應用殼快取 fetch handler；不能從這次檔案搬移推論首次離線開站或離線重開必然成功。
- register 的 updateViaCache:none 只控制 worker 與其 imports 的 HTTP cache，不保證所有 HTML/JS/CSS 都立即更新。
- 已有 Chromium HTTP fixture 仍屬隔離頁面，關閉 Service Worker；不能替代 PWA、CDN、完整頁面權限或真手機驗收。

參考：MDN ServiceWorkerContainer.register 的 updateViaCache 說明；MDN Progressive web apps Caching 指南。查核日期 2026-10-02。

## 剩餘驗收

發布版本準備及最終 CI、實際頁面與帳號權限、真手機／安裝型 PWA／快取更新對照、發布前 main freshness、單線合併部署與上線後核對仍未完成。沒有正式環境變更，也未把未驗收项目標成完成。
