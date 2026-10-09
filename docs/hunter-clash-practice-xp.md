# 獵人交鋒練習 XP v1

沿用已確認方案：正規對戰完成獎勵 10 XP 的 50%，即每場 5 XP。每日依結案先後取前 10 場；同對手前 3 場每場 5 XP，第 4～6 場每場 2.5 XP，第 7 場起 0 XP。兩人的額度獨立計算，勝敗同額。第 11 場起不發 XP，但仍保存比分、逐回合紀錄與分析資料。未另加回合 XP 或賽事 XP；不改正規賽的 +10/+2/+20。

只有新版後端建立、帶 `arena-practice-xp-v1` 標記的房間可發放。舊測試、生涯與上線前未結案的房間均不補發。整房最後由雙方確認後一次發放，場數按每個 game 計算，不按房間計算。所有本房場次採最後結案的台灣日期，00:00 重置每日額度。未結案、取消或爭議不發 XP，沒有單方自動結案。

練習 XP 累積獵人等級（LV）；正規實力、階級資歷、階級有效樣本、天梯及永久成就仍只採既有來源。這是尚未定案的升階政策的隔離處理；練習 XP 不進入現行階級的資歷加分。完整 PK 分頁核對前不將缺漏 XP 當成 0；發放累積量與完整有效帳本逐場 XP 合計不符時，暫停練習 XP 顯示。

## 發放與撤銷

- 使用 Admin SDK 交易，同時寫入雙方逐場 reward、玩家 XP 累積、每日／同對手次數、challenge 與冪等 receipt。客戶端不可提交 UID、XP 或額度。
- 以半 XP 為整數單位儲存，避免 2.5 XP 精度問題。
- 不同房間同時結案共用玩家／每日交易衝突檢查，不會穿透第 10 場上限。最多 100 場的房間仍在單一交易保存。
- super_admin 撤銷完整房間時依原 reward 扣回雙方 XP，保存 tombstone；不歸還當日額度，避免撤銷重開刷取。撤銷操作同樣冪等。當日已獲 XP 顯示原已發量，生涯總額顯示扣回後的量。
- `systemSettings/hunterClash.practiceXpEnabled=false` 可停止新發放，既有 XP 保留。未設此欄位時新版後端預設啟用。停發時的場次不消耗 XP 額度。
- 不重置任何既有玩家資料；不產生站內信、稱號或成就。

## 發布

PR 驗證通過後先部署後端，再部署前端。若先發布前端，舊後端仍可正常保存 PK；前端明示 XP 尚未核對，直到後端更新，不聲稱已啟用。

部署僅限 `bxh-arena` 的 `arena-internal-pk` codebase。在含 Firebase 部署權限的 Cloud Shell，用本次通過驗證的 commit checkout：

```bash
git clone --filter=blob:none --no-checkout https://github.com/memoryalwaysbibo/BXH_ARENA_Production.git "$HOME/arena-pk-practice-xp"
cd "$HOME/arena-pk-practice-xp"
git sparse-checkout init --cone
git sparse-checkout set hunter-clash/arena
git checkout <本次通過驗證的 commit SHA>
cd hunter-clash/arena
npm ci
npx firebase-tools@14 deploy --only functions:arena-internal-pk --project bxh-arena
```

不部署 Hosting 或其他 Functions；新 `xpDays` 位於原 PK 私有玩家帳本下，客戶端只能用 callable 讀自己的摘要。rules fragment 列出禁止直接存取的路徑；不以 fragment 覆蓋正式 rules。Firebase 的未匹配子集合預設拒絕存取。

驗收：兩個一般帳號建立新房，雙方確認 1 場後兩人各 +5 XP；同對手 6 場共 22.5 XP；每日第 11 場及同對手第 7 場仍有戰績但 +0 XP；重送不重複；切換帳號不殘留前帳號 XP；撤銷後總額扣回；正式實力、階級與成就不變。

回退先設 `practiceXpEnabled=false`，保留新版後端的帳本保存方式。開始發 XP 後不要直接部署會整份覆寫玩家 meta 的旧版 service，以免抹除 XP 累積欄位。

## 驗證

單元／交易測試涵蓋 5／2.5／0 XP、跨房同對手計数、非對稱額度、不同房 concurrent 結案、台灣午夜、舊房隔離、停發、撤銷、腐損交易回滾、100 場分頁及正規階級隔離。真實 Auth／Firestore Emulator 驗證 51 場交易、並行確認、分頁 XP、撤銷重送與用戶端直接存取拒絕。實際雙手機瀏覽器測試檢查兩人完賽 +5 XP、個人額度、Skin 繼承與 320／390／430px 版面。
