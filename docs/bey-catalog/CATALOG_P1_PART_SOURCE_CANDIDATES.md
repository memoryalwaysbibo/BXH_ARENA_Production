# 既有八項P1零件來源：官方候選證據

2026-10-10，台灣時間。只為既有TW-06的八項`PART_SOURCE_PENDING`整理來源，不新增批次或零件，不修改原始JSON、衍生資料、BOM、來源認證或審核狀態。以固定來源SHA的私有原始檔在記憶體重算清單，仍為31項pending（P0=5、P1=15、P2=11）；這是唯讀清單核對，不是重跑Firestore Emulator驗收。

## 逐項來源與支持範圍

下列PNG均由對應官方商品頁HTML的「パーツ詳細」圖像連結取得，實際下載後檢視；3-85沿用前次已逐頁檢視的8頁UX-18產品說明書，沒有重新下載。每項仍須兩名獨立人工審核者核對原始紀錄與contentClaims。

| 既有紀錄 | 原始名稱／類別 | 官方候選來源 | 實際證據位置 | 仍未支持的內容 |
|---|---|---|---|---|
| part_000033 | C／bit | [BX-34商品頁](https://beyblade.takaratomy.co.jp/beyblade-x/lineup/bx34.html)的[詳細圖](https://beyblade.takaratomy.co.jp/beyblade-x/lineup/_image/detail_bx34.png) | 下半部`ビット/C（サイクロン）` | 圖為另一商品的零件示例，不直接證明UX-18-02配色或原配；此C是軸心，不能與CX輔助刀刃C混用 |
| part_000036 | 3-85／ratchet | [UX-18產品說明書（8頁）](https://beyblade.takaratomy.co.jp/beyblade-x/manual/UX-18_manual.pdf) | 第5頁右上標示03的3-85固鎖；第7頁上半部為7-55／3-85組裝說明 | 不能由組裝示例自動核准UX-18-03的其餘CX部件或實物配色 |
| part_000040 | 9-70／ratchet | [UX-07商品頁](https://beyblade.takaratomy.co.jp/beyblade-x/lineup/ux07.html)的[PhoenixRudder詳細圖](https://beyblade.takaratomy.co.jp/beyblade-x/lineup/_image/detail_ux07_r.png) | 下半部`ラチェット/9-70` | 圖為UX-07示例，不直接證明UX-18-04配色或原配 |
| part_000041 | TP／bit | [BX-38商品頁](https://beyblade.takaratomy.co.jp/beyblade-x/lineup/bx38.html)的[詳細圖](https://beyblade.takaratomy.co.jp/beyblade-x/lineup/_image/detail_bx38.png) | 下半部`ビット/TP（トランスポイント）` | 圖為BX-38示例，不直接證明UX-18-04配色或原配 |
| part_000042 | G／bit | [UX-07商品頁](https://beyblade.takaratomy.co.jp/beyblade-x/lineup/ux07.html)的[PhoenixRudder詳細圖](https://beyblade.takaratomy.co.jp/beyblade-x/lineup/_image/detail_ux07_r.png) | 下半部`ビット/G（グライド）` | 此G是軸心，不能與CX輔助刀刃G混用；不直接證明UX-18-05配色或原配 |
| part_000043 | ヴァイスタイガー／blade | [BX-33商品頁](https://beyblade.takaratomy.co.jp/beyblade-x/lineup/bx33.html)的[詳細圖](https://beyblade.takaratomy.co.jp/beyblade-x/lineup/_image/detail_bx33.png) | 中段`ブレード/ヴァイスタイガー` | 日文名稱／刀刃類別不等於台灣正式名稱證明；不直接證明UX-18-06配色 |
| part_000044 | 4-80／ratchet | [BX-03商品頁](https://beyblade.takaratomy.co.jp/beyblade-x/lineup/bx03.html)的[詳細圖](https://beyblade.takaratomy.co.jp/beyblade-x/lineup/_image/detail_bx03.png) | 下半部`ラチェット/4-80` | 圖為BX-03示例，不直接證明UX-18-06配色或原配 |
| part_000045 | LR／bit | [UX-11商品頁](https://beyblade.takaratomy.co.jp/beyblade-x/lineup/ux11.html)的[詳細圖](https://beyblade.takaratomy.co.jp/beyblade-x/lineup/_image/detail_ux11.png) | 下半部`ビット/LR（ローラッシュ）` | 圖為UX-11示例，不直接證明UX-18-06配色或原配 |

這些候選資料支持零件代碼、日文名稱或零件類別的原廠對照，沒有自動把`verificationStatus`升級。UX-18完整名稱的獨立候選證據見[五項P0來源與更正](CATALOG_UX18_OFFICIAL_EVIDENCE_CANDIDATES.md)；逐件原配認證不能只靠完整名稱拆字或另一商品的同代碼零件。

## 實際下載檔辨識

SHA-256僅辨識本次讀取的位元組，不是官方簽章；沒有將完整官方圖檔或私有原始資料提交GitHub。若檔案改版或hash不同，須重新檢視，不能沿用觀察結果。

| 官方檔案 | 像素／頁數 | 位元組 | SHA-256 |
|---|---|---:|---|
| detail_bx34.png | 800×1932 | 755460 | dd84e1576fee5823ffaccc0b46b962e41407baa11327ad9444458749c20b1a49 |
| detail_bx38.png | 800×1652 | 481067 | d0a09eb132fe65b7d9673e80e2663819fc121038b2da3d085c807a3686856cc3 |
| detail_bx33.png | 800×1726 | 683284 | 5e4d58de077d1d235a908de50df5d2e9a65ba58b946344e53c047f8694590b91 |
| detail_ux11.png | 800×1932 | 842391 | 991e61d230a0b5e34c8014e9719dc61572218b9aa8015e5d0e60be9c29162c2b |
| detail_bx03.png | 800×2000 | 683588 | af4aed4466d45b12de787c5a8c0c752871f984ab1589968e68072a1bd852b497 |
| detail_ux07_r.png | 800×1726 | 749019 | 251bfe83a5dd19a31853cfa5cfa5c45b900368cf783183c383474ec7a08e532b |
| UX-18_manual.pdf（沿用已檢視檔） | 8頁 | 23570430 | 44a86aa631e279905046cc1544355ce476231f859b245194615a671c62806ae6 |

## 未取得的證據與界線

- 本次查閱的[麗嬰官方購物網陀螺分類](https://shop.funbox.com.tw/collections/%E6%88%B0%E9%AC%A5%E9%99%80%E8%9E%BA)僅顯示其他CX-00兌換品，未提供既有Brush、Sol、蒼龍透明黑特典等事項的正式名稱證明。搜尋到商家或社群慣用名稱不能代替代理商／包裝來源，也不能宣稱官方從未發布。
- 本次UX-08實際下載的商品頁與詳細圖標示3-80FB，因此沒有拿它支持9-70；9-70以已檢視的UX-07零件圖為候選。
- 五項P0逐件BOM、七項其餘P1名稱／色版歸屬與十一項P2實物配色仍待補證和雙人審核。沒有把另外商品的配色套用到UX-18，沒有核准相容性、比賽合法性或抽中機率。
- 本輪只有文件候選整理；DB-01既有真實197筆收據與私有UI缺少既有快照的限制保持不變。兩PR保持Draft，未合併、部署、發布或修改正式ARENA。
