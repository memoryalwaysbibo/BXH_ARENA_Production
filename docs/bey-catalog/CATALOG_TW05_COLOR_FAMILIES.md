# TW-05｜台灣繁中色系標準化與實物配色安全閘門

## 修正
- 以 9 個色系 ID（black、yellow_green、white、teal、blue、yellow、pink、silver、purple）統一台灣繁中主顯示名稱，保留英文／短稱別名供搜尋。
- 修正原始黑色紀錄只有 `name=黑色`、沒有 `displayName` 的欄位不一致。
- 11 個色版新增 `colorFamilyLabelsZhTW`，沿用既有 `colorIds`，不更動任何色版與零件、商品的關聯。
- `displayHex=null`、`manufacturerColorNumber=null`、`physicalColorVerified=false`：這些只是搜尋用色系，不是原廠正式色號、精確色票或實物驗證。
- 所有色版 `selectable=false`、`canAutoPublish=false`，禁止在未確認實物前直接讓玩家選用。
- 原始 DATA-01B 197 筆、SHA-256 `2a53b4d0164d97a5f0607b4d4fd8a536a84b388530bca3eb371453f525cb7d42` 不變。
- TW-04 衍生為 `DATA-01B-20261009-ZHTW-TW05`，仍是 197 個資料實體。

## 驗證
- 純函式測試：9 色系繁中、英文別名、未確認色票阻擋、197 筆保留、錯誤外鍵與誤連正式批次阻擋。
- 本機以真實 TW-04 JSON 衍生 TW-05，核對 197 筆、9 色系、11 色版、0 發布、0 正式寫入。
- 以上是本機資料驗證，**不等於 Firestore Emulator 真實 197 筆寫入驗收**。

## 待辦
- 取得各色版的原廠配色名稱、實物照片、來源、商品批次與透明度／塗裝證據後再審核。
- 台灣版商品與零件命名仍須逐筆與正式代理／原廠資料比對；暫定名稱不宣稱官方。
- PR #463 保持 Draft，未合併部署；DB-01 真實 Emulator 全量匯入屬獨立 PR #462。
