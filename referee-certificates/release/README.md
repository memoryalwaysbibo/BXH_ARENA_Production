# 私人裁判證入口發布

本候選只開啟 index 的 BXH_REFEREE_CERTIFICATES_V1，BXH_REFEREE_PUBLIC_SUMMARY_V1 保持 false。Pages guard 接受明確布林旗標，拒絕公開摘要單獨開放及重複/缺失/非布林設定；私人 identities、initial-preview、測試樹排除與 UID bytes 掃描保留。發布沿既有 exact validated commit Pages workflow，不另建 manifest 或部署框架。

## 後端證據與授權範圍

使用者在 Cloud Shell 執行已核准的正式修改，回傳 step=done、servicePermission=confirmed、config=verified；systemConfig/refereeCertificatesV1 為 enabled=true、publicSummaryEnabled=false、initialRosterApproved=false。這是使用者提供的成功結果，非本地測試代替正式結果。Cloud Run 呼叫權限僅設定既有 refereecertificateservice 的 allUsers → roles/run.invoker，應用層 Firebase Auth、帳號/角色與交易內權限檢查不變。

enabled=true 不是唯讀模式：有效本人可保存/移除自己的照片，合格 super_admin 可執行既有管理操作，仍受來源、資格、一人一證、operationId、revision 等限制。initialRosterApproved=false 只阻擋序號<18時的初次發號，不是所有管理寫入的總鎖。此發布不執行18人初始化、正式發證、歷史認列、玩家資料修改或照片測試寫入。

主服務來源已核對：generation 1793352374920300，archive SHA-256 2eb596f886ba922bf671e9e359886e95f0ec1b4ce75303b88ecfa588ba666b78，161505 bytes；九個 runtime/package 檔與 main 8ba308f 完全相同。6770318 只改其他工作線的測試，裁判證來源不變。唯一額外 package-lock.json 為110101 bytes、SHA-256 b4aa7958a7ab411afece3cad50d9068742ded5ddfd6e37280ddaa126bcd17559、lockv3；root dependencies 及 firebase-admin 13.10.0/firebase-functions 6.6.0 pins 均符合。無須重部署既有主服務。

公開摘要在精確 project/region 查詢404，本方案不部署、不啟用，也不新增其 IAM。未修改 Rules、角色、九階、三席、UID 配號、QR 或四桶。Cloud Shell home 容量有限，不安裝大型依賴、不清理或競用其他工作線資源。

## 驗證與實際限制

本地單元/發布邊界測試涵蓋本人讀取、super_admin核定邊界、照片、登入切換、重送去重、一人一證，以及開放旗標下私人資料仍不進 Pages。full-host browser 額外驗證私人入口可用且名片無公開摘要呼叫；保留公開摘要候選隔離測試及關閉旗標/普通角色拒絕測試。

本地 Firebase transport/MockDB/Emulator 測試不等於正式登入驗收。發布後需確認實際頁面資產 parity、私人路徑404、正式登入本人讀取與角色邊界；不能以無證 null 分支宣稱有證名片已驗收。照片與管理寫入的測試只在隔離後端執行，不以正式玩家寫入驗收。

回滾入口僅將私人前端旗標改回 false，公開旗標維持 false；這不會停用已開放的後端 callable，若需後端停用，需另行明確更改 enabled，不能宣稱前端回滾已禁止API寫入。
