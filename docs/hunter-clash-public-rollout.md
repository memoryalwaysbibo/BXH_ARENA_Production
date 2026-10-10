# 獵人交鋒一般玩家開放

有效 ARENA 玩家（player/staff/admin/super_admin）登入後即可使用；不再需要 hunterClashA1 custom claim 或 allowedUids 白名單。測試、停用、凍結、刪除與非玩家角色仍被拒絕。enabled 總開關、App Check、雙方確認、分頁帳本核對均保留；練習 XP 接軌規則見 [練習 XP 發布說明](hunter-clash-practice-xp.md)；PK 專屬徽章見 [PK 成就說明](hunter-clash-pk-achievements.md)，不計既有永久成就、正規實力或階級。

## 發布順序

1. PR 的 CI 通過後，先在具 bxh-arena 部署權限的 Cloud Shell 部署本分支後端。
2. 用未列入舊白名單的兩個有效玩家，驗證建立、加入、完賽、雙方戰績；若前端尚未合併，可待前端發布後做完整實機驗收。
3. 合併 PR，由既有 Pages 流程發布前端。舊內測 custom claims 和 allowedUids 可保留但不再參與授權。

Cloud Shell（新的獨立稀疏 checkout，減少磁碟用量）：

```bash
git clone --depth 1 --filter=blob:none --sparse --branch codex/hunter-clash-public-20261009 https://github.com/memoryalwaysbibo/BXH_ARENA_Production.git "$HOME/arena-pk-public-20261009"
cd "$HOME/arena-pk-public-20261009"
git sparse-checkout set hunter-clash/arena
cd hunter-clash/arena
npm ci
npx firebase-tools@14 deploy --only functions:arena-internal-pk --project bxh-arena
```

成功標準：hunterClashCommand 更新成功、Deploy complete。此指令只部署 PK codebase；不部署其他 Functions、Hosting 或 Firestore rules。現有 systemSettings/hunterClash 的 enabled、environment 與 rules 不必更改。

## 回退

若需立即停止服務，可由有權限的管理員將 systemSettings/hunterClash.enabled 設為 false。要恢復內測限制，可重新部署開放前版本的 hunter-clash/arena/service.cjs，並回退本 PR 的前端；既有白名單與 claims 未刪除，PK 帳本未移動或刪除。
