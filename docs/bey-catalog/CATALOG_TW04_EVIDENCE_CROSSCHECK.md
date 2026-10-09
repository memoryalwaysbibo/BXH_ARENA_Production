# BXH ARENA｜TW-04 UX-18 來源交叉佐證與 CX 零件繁中類別

## 真實資料盤查
- 原始 DATA-01B：197 個研究實體，SHA-256 `2a53b4d0164d97a5f0607b4d4fd8a536a84b388530bca3eb371453f525cb7d42`，保持不變。
- TW-04 另存衍生版 `DATA-01B-20261009-ZHTW-TW04`，仍為 197 筆。
- UX-18 01：原廠產品頁明列 `マミーカース7-55W`；標示 manufacturer_named_stock，不等同於已核對所有包裝照片。
- UX-18 02–06：分款原配名稱有獨立產品資料庫／零件商交叉佐證；來源等級提升為 independent_catalog_corroborated，**但原始 verificationStatus 仍 supplier_pending**，必須補原廠說明書／包裝佐證。
- UX-18 六款抽中機率仍是 null，不能依排列推算。
- CX 零件類別加上台灣繁中名稱：紋章、主刀刃、輔助刀刃、覆蓋刀刃、金屬刀刃、上盤、固鎖、軸心與兩種一體式；原 category 不變，並非改寫物理相容規則。
- 11 款色版中的 10 款商品圖候選仍待實物驗證，不跨商品套用。
- 所有零件 selectable=false，所有批次 productionWritable=false、autoPublish=false。

## 交叉佐證來源
- 原廠 UX-18：https://beyblade.takaratomy.co.jp/beyblade-x/lineup/ux18.html
- UX-18 產品選項：https://beyblade-toys.com/products/random-booster-ux-18
- UX-18 零件清單：https://www.1999.co.jp/11228862
- UX-18 02：https://beyblade.phstudy.org/p/en-US/SR-PRD-097167-02.html
- UX-18 05：https://beyblade.phstudy.org/p/ja-JP/SR-PRD-097167-05.html
- UX-18 06：https://beyblade.phstudy.org/p/en-US/SR-PRD-097167-06.html

## 本批程式
- `modules/bey-catalog/catalog-tw04-corrections.cjs`
- `tests/bey-catalog-tw04-corrections.test.cjs`
- GitHub Actions `bey-catalog-zh-tw.yml`

## 上線限制
- 未發布正式 ARENA；尚未完成原始 DATA-01B 真實 197 筆 Firestore Emulator 寫入。
- TW-04 只是來源佐證與繁中類別標示，不能將資料當成原廠原配完整認證、賽規合法性或任意改裝相容性。
- 此 PR 保持 Draft，不合併、不部署。
