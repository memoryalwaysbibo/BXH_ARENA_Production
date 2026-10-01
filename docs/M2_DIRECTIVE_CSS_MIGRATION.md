# M2-2｜Directive 極限指令主題 CSS 抽離

狀態：隔離施工規格；堆疊在 M2-1，未改 index、未部署。

## 固定父層
- M2-1 head: `1f78c090fa6e444d158f3896d724860260b7b0bb`
- M2-1 已完成 Card Album CSS 抽離與唯讀 CI。

## 候選範圍
M2-1 後 index 仍有三個 inline style 區塊：
1. 主樣式：約 296 KB
2. mobile override：約 10.5 KB
3. Directive／極限指令：約 2.4 KB

本批只處理第 3 個。它以 `.directive-warning-layer` 與 `:root[data-bxh-theme="directive"]` 開頭，屬主題覆寫；盤點未發現 `url()`。

## 不變條件
- 原 CSS bytes 搬出，不順便美化或重寫。
- 保持原 cascade 位置。
- 保持 selector、media query、animation 與 !important 語意。
- 不碰主樣式與 mobile override。
- 不碰 Management V2、Card Album JS、HC-00、報名、計分、Functions、Rules、Firestore。
- 不修改正式部署 workflow。

## 驗證閘門
實際抽離前固定 parent index blob 與 Directive CSS SHA-256；來源漂移即 fail closed。
候選需通過：
- re-inline exact-byte reconstruction
- Production frontend verifier
- Critical Regression
- Chromium HTTP stylesheet response
- directive theme desktop/mobile computed-style smoke
- 非 directive theme 不應套用 directive root 規則

第一次寫入只允許 index、Directive stylesheet、manifest；成功後撤除 writer，再對最終 head 跑唯讀專項與既有全套 CI。
