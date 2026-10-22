# Hunter License 2.0 × HC01 PK 接軌規劃
狀態：規劃草稿，尚未實作正式接入；禁止依本 PR 合併或部署。
核對日期：2026-10-08 UTC。附件名稱日期 20261009 是交接包標記，不代替查核日期。

## 核對基準
- 最新 main：`72d6f4e13d478ddbf6cf66cde0903666bd479758`，與 START_HERE.md B6 基準一致。
- PK：PR [#434](https://github.com/memoryalwaysbibo/BXH_ARENA_Production/pull/434)，仍為 open/draft，head `a23a32f19e02d670dc64042f11cfcd21f1fc990d`。不可將既有 PR 的過時描述當成最新驗收紀錄。
- 已讀 START_HERE、SOURCE_MAP、B2/B5/B6；核對 main 的 hunter-utils.js、cloud-runtime.js 與 PK head 的 service.cjs； domain 與手機頁工作副本亦供交叉查核。
- 此 PR 從上述 main 建立，只新增本規劃；沒有把附件快照或 PK 分支整份覆蓋主線。既有本機 PK 未提交修改保留。
- 主線查核的分類入口 `hunterRecordMode` 已支援 hunter-clash→pk；它是分類契約，並非正式來源開通。
- `hunterFilterByMode(...,"all")` 包含輸入的 PK，`hunterBuildGrowth` 對所有輸入戰績計 XP；故僅新增分類不足以阻止獎勵變動。
- B6 `hunterLicenseOverview` 的實力採 standard，但資歷取共用 growth；即使 PK 不增實力，誤接 XP 仍可能改變階級分。
- HC01 完賽是整房雙方確認，不是逐場裁判確認。後端標 `certificationSource:"SELF"`、`ratingStatus:"not_awarded"`。
- HC01 service 最後確認交易才寫双方 hc01PlayerRecords；receipt 重送在累加前返回。個人文件 matches 僅最近 50 場摘要，無 rounds，不是完整生涯來源。
- 完整 rounds 在 hc01Challenges 的 games 與當前末場；目前僅 sandbox。正式後端與正式歷史讀取仍 BLOCKED。
- 舊 PK 手機圖使用 50% 滿半徑；2.0 改 100% 滿半徑，後續最小差異修改，不沿用舊刻度。

## 建議範圍與階段
1. 建立純資料 adapter 與測試（無雲端讀寫）：把已驗證、整房完成的 HC01 帳本轉玩家視角；對稱、去重、更正、缺帳、來源隔離。
2. 測試站獨立 PK 列表／統計與 2.0 八軸：自成 pkRecords/cache，sandbox 明標；不送入正式 allRecords、growth、永久成就。本輪暫計與已确认存檔分開。
3. 正式後端驗收：可信 UID 映射、參與者授權、完整分頁帳本、更正／撤銷及重送一致性、來源版本與認證資訊。未完成前正式入口維持停用。
4. 才接 ARENA PK 模式与列表。全部畫面的展示 records、XP 輸入、正規實力樣本、永久成就輸入必須各有明確邊界，不能共用一個 allRecords 自動發放。
5. XP／成就政策另案確認與實作；合併、部署另取得指令。

## 玩家視角映射（提案，尚未發布 schema）
| 2.0 欄位 | HC01 真實來源／處理 |
| --- | --- |
| sourceType | 固定 hunter-clash；不得缺欄位走 standard fallback |
| sourceEnvironment | 持續保留 sandbox；正式來源另由可信後端提供，不能前端改旗標升格 |
| adapterVersion / sourceSchemaVersion | 提議 hc01-hunter-adapter-v1 / challenge.schemaVersion=1 |
| scoringVersion / sourceRulesVersion | 保留 rules.version；先白名單驗證 finish 分值與 targetScore，不冒用正規版本 |
| eventCode | 提議 pk:sandbox:<challengeId>；正式鍵另含正式來源命名空間 |
| matchId | 提議 game:<game.number>，不按顯示名稱或時間生成 |
| playerId / opponent.playerId | participants 中兩個穩定 Auth UID；正式 UID 對應須後端驗證，不用名稱合併 |
| completed / isBye | 僅整房 status=completed 且兩位参与者确认当前結果版本；正常完整對戰 isBye=false |
| isWin | game.winnerUid===本人 UID；驗證勝者属于參與者且符合比分 |
| scoreFor / scoreAgainst | participants[0] 對 score.a、participants[1] 對 score.b，換視角交換兩值 |
| roundsPerspective | game.rounds：winnerUid==本人為 for，另一人為 against；finish→type、points 原樣驗證 |
| eventId | 命名空間+場號+roundRevision；檢查唯一性，不能用易重用的 number 單獨作 ID |
| analyzable | rounds 完整、合法事件、canonical points、全帳核對雙邊最終比分後才 true |
| completedAt / matchStartedAt | game.endedAt / game.startedAt；整房確認時間與單場結束時間分開保留 |
| confirmedAt / sourceRevision | challenge.completedAt / challenge.revision；正式更正需可信 updatedAt／修訂順序 |
| certificationSource | 保留 SELF；不推定見證、裁判、正規資格 |
| corrections | 撤銷回合留痕不再次計分；目前已完賽後不可修訂，正式更正／撤銷 API 尚待設計 |

已歸檔 games 加上末場一次，依場號查重；末場不能在 games 与 current 同時計入。
四種 canonical 分值極限3／擊飛2／爆裂2／轉停1；fault=1僅核比分，不當四種有效回合。
僅比分摘要可顯示未驗證比分與勝敗，不能倒推 rounds 或填造八角圖。
不以前端帶入的 verified/certification 旗標證明來源可信；由受信任讀取路徑驗證。

## 去重、撤銷、讀取與完整性
- adapter 先按完整来源命名空間与 matchId 選可信最新整筆版本，再過濾撤銷、輪空与模式；相同修訂时间不同内容需冲突错误，不任由数组顺序决定。
- 新撤銷版本須以 completed=false 或明確 tombstone 排除，且不能讓舊完成版本復活；訂出正式契約後再採用共用去重函式。
- UID 自己的列表與 challenge 參與者詳情分開授權；未登入／非參與者拒絕。目前 getMyHistory 從 verified token UID 讀本人文件，getChallenge 限參與者，但不等於正式讀取验收通过。
- sandbox 只能走內測隔離服務，正式執照不讀 hc01* sandbox 集合。正式Firestore path、IAM／Rules、索引與Callable契約均待定，不在本 PR 開放權限。
- 50筆截斷摘要標 limited/partial 與範圍；不拿累計 total 配最近50筆 rounds 做生涯分母。需分页明细與完整性证明。
- 狀態至少 loading/error/partial/empty/ready/unconnected；尚未串接不是零戰績；讀取失敗不清空既有生涯。
- 缺分母顯示 —；部分帳本不做正式階級、戰型或強度結論；保留缺失原因与可分析／排除樣本數。
- 趨勢僅同來源、同版本、時間完整且可分析的最近20／前20；不夠40場不輸出差值。

## UI 與統計
- 保留 PK 自己的本輪評價与累計列表。八軸順序：極限、擊飛、爆裂、轉停、被極限、被擊飛、被爆裂、被轉停。
- 使用 2.0 共用 points/events 分布契約，得分与失分各有分母；提供次數／分數占比切換，100%滿半徑。缺分析樣本不畫假分布。
- 明列實際完成場次、有效回合、來源版本、帳本覆蓋、暫計/已存檔及PK参考用途。
- PK 本輪既有5場初步／10場評語門檻，与執照2.0的3場8有效回合門檻用途不同。是否統一是待確認產品政策；不得用本輪門檻改正式階級。
- 「失分」是記錄的結束結果；不能宣稱玩家操作失誤，也不能把有效記分順序叫作包含平手重賽的實際回合次序。

## 未確認政策（全部保持未開通）
| 項目 | 待確認內容／目前限制 |
| --- | --- |
| PK XP | 是否計入、每場/回合值、每日上限、時區、同對手上限、循環房場次與房間獎勵；不得直接套 +10/+2/+20 |
| 成就／稱號 | 可觸發項目、門檻、來源資格、撤銷後處理、永久成就保留；現有獲得紀錄不重置 |
| 階級 | 正規實力与A/S/國家級樣本維持生涯 standard；PK若未來給XP，其資歷間接升階是否允許須另確認 |
| 認證 | SELF以外有無見證／裁判流程、來源證明与资格；現有雙方確認不等於裁判認證 |
| 反刷 | 曾討論30分鐘10筆／1小時25筆、24小時停權，屬想法；計算場/回合、排除對練、處罰升級与申訴均未核定，不自動封號 |
| 分析門檻 | 本輪5/10与生涯3場8回合如何說明／區分；PK是否只分布与點評而無綜合實力分 |
| 歷史 | 正式起算日、留存、刪除、更正審核、舊sandbox是否永不匯入；預設不遷移sandbox |

## 驗收清單（此規劃 PR 尚未執行功能驗收）
- [ ] adapter 两位玩家对称、合法finish分值、分母與100%刻度。
- [ ] archived+末場一次、重送／重读／重複場次不重计。
- [ ] 最新更正覆蓋、撤銷不復活、source命名空間不撞正規賽。
- [ ] 缺帳、重複eventId、比分不符、未知版本、未完成／取消／爭議排除。
- [ ] 未登入、非參與者、被停用帳號、正式/sandbox跨來源拒絕。
- [ ] 跨50筆分頁与失敗頁範圍狀態；PK未接入不顯示零。
- [ ] 接入前後正規／附魔 XP、實力、階級、已授成就完全一致。
- [ ] PK/全部/來源筛选手機390px、明細與來源展開无溢出。
- [ ] 在最新main跑 START_HERE 六組命令（critical、frontend、grade、enchantment、B1–B6）與新增adapter/權限測試。
- [ ] 確認 CI配置涵蓋新增測試；真實雙手機驗收与正式後端取證，未做標BLOCKED。

此 PR 仅文件查核：無執行程式修改，因此未重跑全站功能回歸；不能將規劃驗收清單視為PASS。
Commit/PR 完成後仍是 Merge=未合併、Production=未部署。本 PR 不代表 PK 已串接2.0。
