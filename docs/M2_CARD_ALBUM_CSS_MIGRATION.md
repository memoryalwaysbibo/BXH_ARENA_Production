# M2-1｜Card Album CSS 抽離

狀態：堆疊在 Management V2 M1 之上的隔離候選；未合併、未部署。

## 範圍
只抽離 index.html 中唯一的 Card Album 內嵌 style：
- M1 index：2,396,206 bytes
- M2-1 index：2,393,788 bytes
- 抽離 CSS：2,478 bytes
- CSS 內沒有 url()，不會因搬到子目錄改變圖片/字型相對路徑。

候選路徑：modules/card-album/styles.css
原 cascade 位置保持在 referee-score-v2.css 之後、title-reward-mail.css 之前。

## 固定邊界
- parent M1 commit：f5a890b831d3bb736df0022829c08a89987f6c1f
- parent index blob：f5c5d2205d26aeedd340c8a822b4f3fecefa377b
- candidate index blob：52a33590b3ca5a9d118aaeae70cd9d16f78baceb
- CSS SHA-256：034f6ce6fe55540c7a495d23480ad9723795df374a9e5bf1cde91afdde5f2789

不改 Card Album JS、資料、Functions、Rules、報名、計分、HC-00、Management V2 內容或部署 workflow。

## 驗證
在寫入施工分支前，先對 staging candidate 跑：
- exact-byte extraction contracts
- Production frontend verifier
- Critical Regression（包含 Card Album 19 項既有測試）
- Chromium 實際 HTTP CSS response + computed style：桌面 6 欄、390px 3 欄、owned/preview/form 規則

第一次 writer 只允許 index.html、modules/card-album/styles.css、manifest 三個檔案。完成後必須移除 writer 權限並重新跑唯讀 CI，才能考慮後續合併。
