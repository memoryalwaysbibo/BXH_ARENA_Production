# BXH ARENA｜台灣繁體中文圖鑑命名規範（zh-TW）

## 預設顯示
- 產品包、零件、色版及原配組合均優先使用台灣繁體中文名稱；型號、固鎖與軸心代碼（UX-03、1-60、FB、ATr 等）原樣保留。
- 日文原名（officialNames.ja / originalName）、英文名稱、原顯示名及使用者常用稱呼保留於別名搜尋；不可因漢化更改 partId、productId、groupId、variantId 或產品包內容。
- 資料庫仍記錄 market=JP 及官方原始商品資訊；zh-TW 只是顯示語系，不代表改成台灣販售版或取得官方命名授權。
- 台灣繁中名稱來自台灣社群資料交叉核對，並非全部有代理商官方名稱證明；待核對資料需標示狀態，不可虛稱已確認。

## 首批 9 個產品包
- UX-03 魔導神杖 5-70DB
- UX-19 彈丸獅鷲 H（搜尋別名：子彈獅鷲 H）
- UX-20 榮耀武神 LF（搜尋別名：榮耀女武神 LF）
- CX-07 天馬爆擊 ATr
- CX-13 龍王閃擊 BK1-50I
- UX-18 隨機強化組 Vol.8
- BX-01 蒼龍神劍 3-60F
- BX-20 蒼龍利刃改造組
- CX-00 蒼龍鎖定紋章・透明黑版特典（暫定，待核對台灣完整商品名）

## 台灣繁中參考來源（社群，非製造商官方證明）
- https://beyblade.phstudy.org/index.zh-TW.html
- https://beyblade.phstudy.org/p/zh-TW/SR-PRD-956976-00.html
- https://beyblade.phstudy.org/p/zh-TW/SR-PRD-097259-00.html
- https://beyblade.phstudy.org/p/zh-TW/BL-PRD-097167-03.html
- https://beyblade.phstudy.org/p/zh-TW/BL-PRD-913078-01.html
- https://beyblade.phstudy.org/p/zh-TW/SR-PRD-096139-00.html
- https://beybladehub.app/parts/combos/UX-18
- https://beybladexwiki.com/zh-tw/blades/dransword

## 需要特別修復的原始資料
1. BX-20：底稿 group_000014 記載鮫鯊鋒鰭 3-80LF，但台灣資料記載 3-80F；需要對照原廠說明書後修正**零件資料**，不得只改中文顯示名稱。
2. CX-07：variant_000010 的 1-50 圖示版本來源指向 CX-07，但 1-50 與 CX-13 關聯更明確，需核對實物圖片及來源產品。
3. CX-00 特典：完整台灣商品名稱尚未獲官方證明，暫用繁中顯示名並保留待查。
4. UX-19、UX-20：既有 BXH 稱呼與台灣參考來源不同；保留兩種別名，不合併或刪除舊稱。

## DB-01 真實資料驗收的安全原則
- 原始 DATA-01B 197 筆 JSON 的 SHA-256 必須維持 2a53b4d0164d97a5f0607b4d4fd8a536a84b388530bca3eb371453f525cb7d42。
- **不可直接拿已漢化 JSON 取代原始 DATA-01B 驗收 fixture**；先完成原始資料 Emulator 寫入驗收，再把 zh-TW overlay 作為獨立名稱版本套用並測試。
- 此 PR 只提供純函式名稱轉換，未修改正式 Firestore、玩家資料、賽事、配裝或自動更新。

## 台灣版修正批次 TW-01（2026-10-09）
- BX-20-02：台灣繁中資料與 BeybladeHub 均列為「鮫鯊鋒鰭 3-80F」。將 zh-TW 顯示層改為「鮫鯊鋒鰭 3-80F（台灣資料；原始零件待核對）」；原始 research contentClaim 仍為 LF，未擅自覆寫。待對照原廠實物或說明書後，以新資料修正批次調整底層 BOM。
- CX-07：原廠說明書為天馬爆擊 ATr，含三部件上盤及 Tr 一體式下半部，沒有 1-50。原本 variant_000010 的「1-50｜CX-07 圖示版本」移除誤導性 CX-07 歸屬，改為「1-50｜產品與配色歸屬待核對」；需進一步確認是否為 CX-13 配色版本，不能僅憑 1-50 型號直接轉移配色來源。
- 修正候選集中於 `TAIWAN_CORRECTION_CANDIDATES`，保留來源 URL、原始名稱、建議值及待驗證狀態。
- 本次沒有變更原始 DATA-01B 的 SHA-256、零件 ID、產品包原配清單或正式 Firestore；仍不允許研究資料自動發布。
