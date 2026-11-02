# 裁判證候選：PR647 明確核定差異修正

基準：`346f34292ec28ea8a730fb7449d35a37d140b45b`。本目錄延續原 PR 的交易、收據、revision、九級、成就與介面，不是另一套裁判系統。

本次為獨立審查後的第四版本地候選；已新增實際 index 宿主流程驗收，使用本地 Firebase transport fixture，沒有連正式環境。

本次僅本地候選，沒有 push／merge／approve／deploy，沒有讀寫正式 GCP、修改 live rules 或實際發號。所有測試資料都是 mock／`demo-referee-certificates` emulator 資料；測試中的 R000019 不代表正式已發證。

## 預設關閉與核定

前端 `BXH_REFEREE_CERTIFICATES_V1`、`BXH_REFEREE_PUBLIC_SUMMARY_V1` 均為 false。後端只有 `systemConfig/refereeCertificatesV1.enabled === true` 才開放私有服務；公開摘要另需 `publicSummaryEnabled === true`。這份候選不寫任何啟用設定。

- `get` 永遠純讀，仍僅本人或 active、非測試的 super_admin 可讀。核定資格不依 target 的 users.role／active，自身登入帳號存在即可純讀自己的私有資料。所有 mutation（包含本人照片）仍在交易內要求操作者 D.active：停用、刪除、凍結、tester／測試帳號一律拒絕，重試也重新檢查。
- 只有 super_admin 的明確 `grant(level:1,personId,basis)` 能初始發證，零經驗亦可。log、get、照片、回補、帳號關聯均不發號。
- L2–L9 保留原判決與64／96／128包含式門檻，明確 grant 並由後端重算。已授等級不因撤銷經驗自動降低；停用的資格不能晉升。
- `qualificationStatus` 為 active／disabled；核定人／時間、personId、永久號一併保存。`disable`／`restoreQualification` 要求依據並保留 audit，不改 users.role、登入設定或任何三席權限。
- 所有 mutation 保留 operationId 收據與 expectedRevision。掉回應重送同一操作不再配置號碼、增加認列或寫第二筆歷程；新操作若已處於相同資格狀態，留下 unchanged 稽核而不改號。
- `setChief` 仍是全域唯一稱號，不是單場席位。新指定需已核定且有效證件；解除不要求目標帳號 active。

## 原18人：只有預覽，不執行初始化

`functions/initial-preview.json` 保存已定姓名、UID、身份識別碼與順序。林一棟仍為第9位；不因0 log取消候選，也不補造經驗。額外三個帳號不在初始名單。

```sh
node scripts/preview-referee-initialization.cjs
```

腳本只輸出 JSON，沒有 Firebase SDK、網路或寫入模式。`proposedNumber` 不是已發號證據。

若日後另行授權啟用初始化，後端還需明確 `initialRosterApproved === true`；配置序列必須逐一符合已定18人順序，提前點擊第9人會被拒絕。新名單外人員必須在序列完成18後才可能明確發第19號。已有序列但原18證件缺漏時拒絕自動補號，要求另行核對。此次沒有執行上述流程或更改旗標。

## 一人一證及帳號關聯

`refereeCertificatePersons/{personId}` 鎖定一個核實人員的 primaryUid；`refereeCertificateUidBindings/{uid}` 鎖定UID到該身份。發號、身份註冊、UID綁定、profile、audit、收據同交易完成。

已知吳健凱主號／黑爸2號以確切UID處理：小號不能另證，也不能以新 personId 規避。其他同人帳號需 super_admin 明確 `linkAccount(aliasUid,basis)`，拒絕已有證件或已綁到另一人的帳號。關聯只記錄身份，不讀入、不搬移、不自動合併小號歷史。不同名字或相同 email 不構成同人判定。

系統只保證已核實 personId 與 UID 的唯一綁定，不能自動證明全庫自然人唯一性。未列入已知關聯的人，仍需管理者核實並重用正確 personId。

## 責任判決、活動與輔助經驗

舊 confirmedByUid／score audit.uid 只證明操作帳號，不足以證明責任裁判。現有系統 log 完成基本正式／測試／取消／輪空／最終結果檢查後，列 `responsibility-unverified`；不靠最後席位猜舊歷史，不新增三席權限。

明確認列繼續用 `saveBackfill`、`revokeBackfill`、`restoreBackfill`，新增：

- `kind: decision`：正式責任判決；每個唯一 sourceKey 對應一場。單筆可帶最多200個 `sourceKeys`，decisions必須等於鍵數。沒有逐一來源鍵的總數不能冒充精確去重。
- `kind: event`：一場活動經歷；events固定1。原生賽事須整場完成才計活動，規模由 canonical bracket／players核對，不能填大數字提升門檻。
- `kind: auxiliary`：輔助經驗；auxiliary記次數，decisions／events必須0，不計正式判決、活動規模或晉級門檻。
- 必填 `basis`（責任／經歷認列依據）、`sourceKey`，保留期間與備註。來源鍵格式：`match:BXH-XXXX:matchId`、`event:BXH-XXXX`、`historical:管理核實來源編號`。批次decision可省略單一sourceKey而提供sourceKeys。
- `sourceUid` 留空表示本人；跨UID必須已有明確身份綁定，且本次認列仍需獨立依據。關聯不等於認列。

原生 match 認列會重新讀保留賽事，正式、非測試、未取消、非輪空、雙方與勝方有效、當前完成才能計判決；不要求整場活動完成。伺服器認列時保存該 match 的雙方／勝方／比分／結果方法／確認者與時間／完成時間／score revision 指紋。後續撤銷，或重判後重新完成但指紋不同時，該筆認列轉待核對，不繼續加總。get 及 restore 不刷新指紋；需要新的明確 save 認列並保存前後 audit。客戶端不能自行提供有效指紋。批次有任一原生來源不明時整筆保守待核對，可拆分修改。

歷史來源由管理者明確核實、留下依據與穩定識別碼；不偽造日期或原生紀錄。不同外部識別碼是否其實同一場仍須人工核對。舊未分型回補保留原文與audit，但不直接計入；需逐筆明確核實後認列。

正式 decision 來源鍵另由全域 refereeCertificateDecisionClaims 交易鎖跨 UID 去重；同一來源已被另一筆責任認列占有即拒絕。須原認列明確撤銷／修改釋放後，新人另行認列；原人恢復若衝突會拒絕，兩邊保留 audit，不自動轉移經歷。重判待核對不會自動釋放責任鍵。

正式來源鍵在有效回補間去重，並與已認列系統鍵去重；輔助來源另算且不轉成判決。修改／撤銷／恢復保留歷程，恢復也重新驗證去重與現行原生來源。148人依舊同時涵蓋64／96／128與百人成就，不會把一場拆成多場。

來源掃描仍以個人log定位保留賽事，不能宣稱全部歷史或已刪除賽事涵蓋。缺log可由管理者提供確切原生來源鍵明確認列，不進行全庫推測。

## 公開摘要是獨立邊界

新增 callable `refereeCertificatePublicSummary`，只接受 targetUid作為定位輸入；不改私有get的授權。回應 `summary` 僅白名單：`name`、`number`、`level`、`status`、`experience`（已認列判決／活動／規模／里程碑／輔助數）。不含UID、email、電話、照片、personId、操作人、核定人、備註或audit。

無核定證件回summary:null；停用顯示disabled，既有expiresAt已過時顯示expired。帳號active／role不覆蓋證件資格。公開來源有界讀取不完整時experience為null，不用零冒充完整數據。

既有玩家名片成功取得目標帳號後才載入獨立摘要；無證不顯示。重新開啟即重新讀取；最多保留30秒，之後清除並標示需重新核對。失敗不展示舊有效狀態，切換名片／帳號後晚回應丟棄。沒有公開申請或公開名冊。

## 測試與審查

```sh
node --test referee-certificates/test/*.test.cjs tests/referee-license-*.test.cjs tests/referee-certificate-wiring.test.cjs tests/player-center-integration.test.cjs
node scripts/verify-production-frontend.cjs
```

Emulator測試拒絕非loopback host及非demo project：

```sh
FIRESTORE_EMULATOR_HOST=127.0.0.1:8089 GCLOUD_PROJECT=demo-referee-certificates node --test referee-certificates/emulator/service.emulator.cjs
```

瀏覽器測試：`tests/referee-license-browser.cjs`（既有版面／字型／照片）、`tests/referee-certificate-contract.browser.cjs`（真UI配本地service）、`tests/referee-public-summary.browser.cjs`（公開名片邊界）。全數使用本地mock／攔截請求，無正式帳號。

`firestore.rules.fragment` 是審查用候選片段，新增身份集合亦server-only；不覆蓋整份規則、不代表live rules已修改。前後端功能預設關閉；發布、初始化、正式發證均需之後另行授權。本次亦未改九級名稱／L2–L9數值／字型／配色檔、原導航與本人入口。

## 獨立審查回歸對照與剩餘驗收

逐項原測試→新測試及合法規格變更見 `REVIEW-REGRESSION-MAP.md`。已恢復 bounded search、record cap、history truncation、照片越權與資料限制、chief競態、來源logs/rooms限額。新版新增來源指紋、全域責任鍵、操作者撤權測試。

原三組browser scripts是隔離模組／契約測試，仍保留。新增 `tests/referee-full-host.browser.cjs` 載入實際 index 及其原始 scripts：SDK auth事件 → 真主程式路由 → 帳號管理玩家分類 → 展開玩家詳情 →「管理裁判資格」直接選中該UID → 0經驗L1核定 → 排行榜尋找玩家 → 真名片overlay → 公開摘要 → 關閉。沒有替換 render、ctx、router、事件處理或 engagementService。名片步驟斷言 playerCardService → refereeCertificatePublicSummary 呼叫次序且不呼叫私有裁判服務。

Firebase SDK transport/帳號/查詢及 playerCardService 回應使用本地fixture；裁判私有/公開 callable 分派至實際候選 service + MockDB。選定流程並未驗證正式Firebase SDK連線、正式帳號、playerCardService後端本身或未選定的整站功能。所有外部請求均攔截，不進正式GCP。測試只在傳回的index副本開兩個功能旗標，原檔仍false。無系統中文字型環境用真鍵盤Enter展開原details，不覆寫宿主render。

可重跑指令（需本地安裝 Playwright；非部署）：

```sh
node tests/referee-public-summary.browser.cjs
node tests/referee-full-host.browser.cjs
```

`NODE_PATH` 或 `CODEX_PRIMARY_RUNTIME_NODE_MODULES` 可指向本地 Playwright 目錄；`BXH_TEST_BROWSER` 可指定 Chromium。候選workflow已加入公開摘要及真host測試，沒有推送或觸發CI。完整原CI單元指令85項通過，包含原樣保留的個人中心20項；emulator8項及4組browser scripts通過。

## v4玩家詳情入口補齊

現有宿主名稱是「帳號管理」，其中玩家分類清單可展開玩家詳情。v3測試曾從此返回首頁再搜尋裁判，不能視為已完成承諾入口。v4在該詳情內新增「管理裁判資格」，只在功能旗標開啟且操作者為符合資格的super_admin時顯示。host事件亦檢查目前帳號管理頁、當前session、已展開清單中的精確UID；既有裁判UI再檢查權限並選中該UID，沿用原管理頁與後端授權，不改role或三席權限。

更新full-host測試實際展開詳情並點此按鈕，斷言沒有再次搜尋callable；完成L1核定及名片摘要。另延遲甲UID的get、從乙玩家詳情進入後才釋放甲回應，確認畫面仍僅乙UID；旗標關閉／普通admin／player下入口不存在，偽造點擊也不產生裁判服務請求。85項原完整CI測試與全部原browser scripts保留並重跑通過。
