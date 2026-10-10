# BXH ARENA｜TW-03 UX-18 六款與 CX 配色來源稽核

> **後續狀態（2026-10-10）**：本文件保留 TW-03 當時的批次邊界；DB-01 原始 197 筆真實 Firestore Emulator 驗收已完成，請以 [DB01_REAL_EMULATOR_RECEIPT.md](https://github.com/memoryalwaysbibo/BXH_ARENA_Production/blob/b770b0ee3d75ed5688bbcce7688cb212cc947e46/docs/bey-catalog/DB01_REAL_EMULATOR_RECEIPT.md) 為準。來源不足的名稱／原配／配色仍維持 pending。

## 實際 DATA-01B 結果
- 來源資料：DATA-01B-20261009，197 個實體，原始 SHA-256 `2a53b4d0164d97a5f0607b4d4fd8a536a84b388530bca3eb371453f525cb7d42`，未覆蓋。
- UX-18：6 款，1 款有原廠商品文字列名（MummyCurse 7-55W），另 5 款原配組合只依商家清單，仍需原廠包裝／說明書複核。
- UX-18 的 03 與 04 款涉及 CX 多部件上盤，不能當作單一上盤或一般三件式；其零件型別分類來源不等於原配內容證據。
- CX 配色：1 款原廠具名（CX-00 透明黑版），另 10 款只有官方商品圖觀察，未經實物配色驗證。
- 不推論 UX-18 抽中機率，所有 probability 保留 null；不得將 CX-07/CX-13 的配色自動套用到 UX-18。

## 修正不確定的台灣翻譯
- `part_000034` 原文 Brush｜ブラッシュ，前一版寫成「九尾」，沒有足夠的台灣正式譯名證據，改為「Brush（台灣名稱待核）」。
- `part_000037` 原文 Sol｜ソル，前一版寫成「焰神」，沒有足夠的台灣正式譯名證據，改為「Sol（台灣名稱待核）」。
- `group_000008` 暫顯示「天馬 Brush M3-85W（台灣名稱待核）」；`group_000009` 暫顯示「Sol Brave C9-70TP（台灣名稱待核）」。
- 這是**避免誤導的暫用名稱**，不宣稱台灣官方商品名已確認。

## 程式
- `catalog-tw03-evidence-audit.cjs`：只讀稽核 UX-18 六款來源、組合與 11 個色版證據，全部不可自動發布。
- `catalog-tw03-corrections.cjs`：由原始 DATA-01B 衍生 TW-02 再疊加 TW-03，維持 197 個資料實體、ID 與外鍵不變，保留原始研究批次。
- `bey-catalog-tw03-evidence.test.cjs`、`bey-catalog-tw03-corrections.test.cjs`：測試商家來源不得自動升級、六款映射、配色不可套用、原始資料不變。

## 驗收邊界
- 離線真實資料已產出 TW-03 JSON、六款審核表及報告，原始 197 筆未修改。
- **尚未完成原始 197 筆 Firestore Emulator 真實寫入**；本批不是 DB-01 結案。
- 尚未合併 PR、部署正式 ARENA、開放玩家圖鑑或啟用自動更新。
