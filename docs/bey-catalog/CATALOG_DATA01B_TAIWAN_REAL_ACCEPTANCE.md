# DATA-01B 真實資料 → 台灣繁中審核接軌驗收

2026-10-09。原始 197 筆已由 PR #462 在隔離 Firestore Emulator 驗收；最新提交 e6db567 的三項 CI 全部成功。

## 本次修正

真實資料揭露 localization 層遺漏 part_000022「蒼龍鎖定紋章」的 provisional_translation 狀態，導致實際審核佇列只有 30 項，而交接的 TW-05 衍生資料與 31 項審核清單均要求保留此名稱待核工作。補回狀態，不新增已驗證名稱或自動發布。

## 真實接軌結果

新增 `tests/bey-catalog-emulator/data01b-taiwan-real.cjs`。必須私下注入 SHA 鎖定的原始 DATA-01B JSON，沒有合成資料替代或缺資料時跳過的路徑。

- 原始 SHA：2a53b4d0164d97a5f0607b4d4fd8a536a84b388530bca3eb371453f525cb7d42。
- Manifest：e8fa4337fa76bd13ebc372ff91e611d03fcd4ccd5ec91623be21f5dabc5992f0。
- 隔離空集合寫入 197 筆，Admin SDK 從九類 Firestore 集合讀回完整 payload 並逐筆核對。
- 以讀回資料執行 TW-01～TW-05，產出 P0=5、P1=15、P2=11，共 31 項 pending。
- HTTP handler → 授權契約 → 真實 Admin SDK Firestore → 私有研究載入器，分頁取得 31 個唯一 queueId。
- 五次管理員查詢成功並稽核，第六次 HTTP 429；玩家 HTTP 403 且不載入研究資料；無效 App Check 拒絕。
- 原始檔位元組與原始 Firestore payload 在接軌後全部不變；原配更正僅存在衍生副本。
- Brush/Sol 名稱維持待核，不引入「九尾」「焰神」別名；色系無虛構 Hex，零件與色版不可選用。
- published=0、cloudWrites=0、emulator=true；實際程序 exit code 0。

Auth、App Check、onRequest 仍是明確測試替身；HTTP 使用程序內 handler。此結果不是正式身分驗證、App Check 或已部署 API 驗收，也不代表任何審核項目已核准。

契約回歸 78/78 成功。Emulator 使用 Java 21.0.12.1、firebase-tools 15.30.0、firebase-admin 13.5.0。首次新 runner 執行因測試 Bearer token 少於既有 HTTP 契約要求的十字元而失敗；修正測試 token，未降低授權或格式規則，重跑成功。

## 重現

私下提供原始 JSON，設定 BXH_CATALOG_DATA01B_FILE，使用乾淨 demo Emulator：

```sh
firebase emulators:exec --only firestore --project demo-bxh-catalog-db01 --config tests/bey-catalog-emulator/firebase.json 'node tests/bey-catalog-emulator/data01b-taiwan-real.cjs'
```

公開 CI 只檢查這個私有 runner 的語法；沒有原始資料時，不得將 CI 視為此真實接軌驗收。公開 PR 不包含原始或衍生研究 JSON。

PR 保持 Draft；未合併、未部署正式 ARENA。與最新主線的相容性須在正式整合前重新核對；本次未合併任何分支。
