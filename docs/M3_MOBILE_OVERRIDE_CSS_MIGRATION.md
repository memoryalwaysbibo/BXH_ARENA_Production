# M3-1｜Mobile Override CSS 抽離

狀態：M3 第一批隔離施工規格；堆疊在 M2-2 final head，未改 index、未部署。

## M3 定位
M2-2 後 index.html 為 2,391,466 bytes，剩餘：
- inline CSS 主樣式：296,664 bytes
- inline CSS mobile override：10,516 bytes
- 最大 inline JS：約 1.82 MB

M3 不直接碰 1.82 MB 核心 JS。M3-1 先抽離 10.5 KB mobile override，建立較大 CSS 模組的安全模式；之後再評估 296 KB 主樣式。

## 固定父層
- M2-2 final head: `473a4521f9dc2e24b71a73aec3b0470e6f482fc5`
- parent index blob: `ac4ae95673e4d96546f1fa9683fb3557de93164f`

## 候選邊界
第二個、也是最後一個非主樣式 inline style，開頭：
`/* v13.38.1: prevent mobile landing card CTA from being clipped */`

本批只搬原 CSS bytes，不順便重寫 media query、selector、spacing 或 CTA UI。

## 禁止範圍
不碰 296 KB 主樣式、不碰 1.82 MB inline JS、不碰 Firebase config、報名、計分、結算、HC-00、Functions、Rules、Firestore、Management V2、Card Album、Directive CSS 或正式部署 workflow。

## 驗證閘門
- 固定 parent index blob + extracted CSS SHA-256
- 掃描 url() 並處理相對路徑語意
- re-inline exact-byte reconstruction
- cascade 位置不變
- Production frontend verifier
- Critical + Warning regression
- Chromium desktop/iPhone/Android computed-style smoke，聚焦 mobile CTA/role cards 與此區塊實際 selector
- 寫入白名單後撤 writer，再對 final head 跑唯讀專項 + 全站 CI
