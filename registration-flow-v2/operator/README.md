# 50 個專用測試帳號建立工具

建立 Firebase Auth Email/Password 帳號及完成個人資料的普通玩家文件，供後續「先登入、同時報名」使用。這不是註冊流程或選手編號分配的驗收，也不會建立房間、送出報名或自動開始壓測。

目前只完成本機工具準備；雲端建立需具權限的 Application Default Credentials。正式專案 `bxh-arena` 需要明確加上 `--allow-production`，且只建立帶 `loadTestRun` 標記的專用普通玩家帳號；不會觸碰現有玩家 UID。不得上傳金鑰或產生的帳密檔至 GitHub／聊天／Library。

在已登入且有權限的執行環境安裝固定依賴，再先規劃、後執行：

```sh
npm install --prefix "$HOME/bxh-loadtest-tools" --no-save firebase-admin@14.4.0
NODE_PATH="$HOME/bxh-loadtest-tools/node_modules" node create-test-accounts.cjs --project YOUR_TEST_PROJECT --run arena50-20261106
NODE_PATH="$HOME/bxh-loadtest-tools/node_modules" node create-test-accounts.cjs --project YOUR_TEST_PROJECT --run arena50-20261106 --apply --credentials-file "$HOME/bxh-loadtest-private/arena50.json"
```

把 YOUR_TEST_PROJECT 改為獨立測試專案的實際 ID。Auth 的 Email/Password 登入及 Firestore 必須先啟用；本工具不建立專案、不啟用服務、不改計費或 IAM。

如果要在正式 Arena 建立專用測試帳號，請在有正式專案管理權限的執行環境先用 `--project bxh-arena --run arena50-20261106 --allow-production` 看規劃，核對專案 ID 與數量後，再附上 `--apply --credentials-file` 執行。沒有這個額外旗標，工具會拒絕對正式專案寫入。建立帳號本身不會送報名或增加房間玩家；帳號建立後仍須以現行 Arena 的規則核對個人資料是否具備實際報名資格。

每個帳號有不同 UID、信箱與隨機密碼。帳密先寫入權限 0600 的檔案，再建立帳號；中途中斷後使用同一命令與原帳密檔重跑，不重設既有密碼。日誌只輸出數量與狀態，不輸出密碼。

建立成功後，還需部署與正式設定相符的測試 Arena、驗證登入／在線狀態與 50 個獨立會話，才能跑同步按鍵測試。不能把本機模擬帳號說成雲端實際玩家。
