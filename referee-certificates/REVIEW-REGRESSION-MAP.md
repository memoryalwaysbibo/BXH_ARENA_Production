# 原基準逐項測試對照與獨立審查修正

基準 346f34292ec28ea8a730fb7449d35a37d140b45b。以下由該 SHA 的實際 test() 宣告逐項列出，不用新總數代替對照。
已由基準 `.github/workflows/referee-certificates.yml` 確認原完整指令：`node --test referee-certificates/test/*.test.cjs tests/referee-license-*.test.cjs tests/referee-certificate-wiring.test.cjs tests/player-center-integration.test.cjs`。原基準71項包含個人中心20項；v2所報65項漏執行該20項，並非淘汰。v3完整指令85項全通過，20項未修改。

## referee-certificates/test/domain.test.cjs

1. 原：`nine approved ranks and ten hundred-person milestones stay independent`

   現：`nine approved ranks and ten hundred-person milestones stay independent`。L1唯一改0，其餘九級/成就保留。

2. 原：`148 people is one event and covers 64/96/128 and 100 without multiplying decisions`

   現：`148 people inclusively covers 64/96/128 and 100 without multiplying decisions`。保留包含計數。

3. 原：`at_least 96 does not imply 100; unknown adds only total events; revoked does not count`

   現：`lower bounds and unknown scales stay conservative`。保留下界及unknown；auxiliary test保留revoked。

4. 原：`backfill requires safe nonnegative integers and explicit lower-bound semantics`

   現：`backfill requires safe nonnegative integers and explicit lower-bound semantics`。保留。

5. 原：`photo validates canonical base64, magic bytes, MIME and payload bounds`

   現：`photo validates canonical base64, magic bytes, MIME and payload bounds`。保留。

## referee-certificates/test/service.test.cjs

1. 原：`disabled by default, authenticated self read only; test/inactive actors denied`

   現：`get is pure and private; logs/photo/backfills never issue; inactive self may read own qualification`。原 inactive/test 純讀拒絕改為允許本人資格純讀；mutation 拒絕另以 inactive deleted 與 photo transaction 測試保留。

2. 原：`get issues L1 once under concurrent transaction retries; numbers never reuse after withdrawal`

   現：`concurrent approval, lost reply replay and distinct identity contention do not duplicate numbers`。auto get 發號淘汰；改明確 grant 並驗永久號。

3. 原：`two referees concurrently receive distinct permanent numbers`

   現：`separate concurrent identities get permanent distinct numbers and stale revision fails`。保留併發配置。

4. 原：`empty self has null certificate and revision zero without fabricated counts`

   現：`get is pure and private; logs/photo/backfills never issue; inactive self may read own qualification`。保留無證純讀。

5. 原：`only super_admin mutates backfills; ordinary admin and self cannot`

   現：`only super_admin explicitly approves zero-experience L1 independent of target role/active`。保留授權；另 get is pure 與 cross-UID 測試認列。

6. 原：`backfill create/edit/revoke/restore counts only current active version and retains audit`

   現：`recognition deduplication, edit/revoke/restore audit and current cancellation revalidation`。以分型精確來源鍵替換舊任意總數。

7. 原：`receipt handles same-operation retries before revision check but rejects changed payload or revoked actor`

   現：`receipt rejects changed payload and server ignores forged client eligibility`。另 concurrent approval 與 L2 gate 測試重送及撤權。

8. 原：`concurrent revisions cannot both commit separate backfills`

   現：`separate concurrent identities get permanent distinct numbers and stale revision fails`。保留 stale revision 競態。

9. 原：`grant rechecks server totals and live authorization, not client-supplied eligibility`

   現：`receipt rejects changed payload and server ignores forged client eligibility`。另 twenty individually keyed 驗證真正達門檻。

10. 原：`actor revocation during a transaction aborts all receipt/profile/number writes`

   現：`privilege revoked mid transaction aborts number/registry/receipt writes`。保留。

11. 原：`chief is globally single with global revision; assignment never changes earned grade`

   現：`global chief contention uses shared revision; removal works after target becomes test account`。保留；真 emulator 同步保留。

12. 原：`inactive chief cannot be newly appointed but can be removed even after becoming a test account`

   現：`disabled qualification cannot acquire new global chief title; target account status stays independent`。target 帳號狀態改資格狀態；target tester 後解除保留 global chief contention。

13. 原：`self photo is allowed and cannot read/change another person; audit stores no image bytes`

   現：`photo before approval persists without issuance, rejects other target and invalid bytes, audit omits photo`。保留照片越權、稽核無影像與尺寸/MIME限制。

14. 原：`photo before the first decision stays readable without issuing a certificate or number`

   現：`photo before approval persists without issuance, rejects other target and invalid bytes, audit omits photo`。保留完整照片可讀、零發證。

15. 原：`bounded search is super-only and returns only minimal identity fields`

   現：`bounded search is super-only, capped and minimal; exact historical UID remains available`。恢復上限、權限、白名單、精確歷史UID。

16. 原：`new record cap refuses overflow without making existing records uneditable`

   現：`record cap denies new row but existing row can be edited and revoked`。恢復，typed來源不可只改任意數字。

17. 原：`history display limit does not truncate counts, block grants, or block later revocation`

   現：`history display truncation does not truncate totals, block eligible grants or later revocation`。恢復歷程截斷不影響計數、授等、撤銷。

## referee-certificates/test/sources.test.cjs

1. 原：`forged self logs cannot create credit for a match actually confirmed by someone else`

   現：`operator UID and exact score audit are not evidence of responsibility`。操作人不是責任人，任何 operator 都不能自動計數。

2. 原：`old unavailable logs stay pending and are not silently deleted or counted`

   現：`unavailable and ambiguous authority stay pending, truncated logs mark incomplete`。另 missing authority 測試保留原因差異；唯讀不刪資料。

3. 原：`verified decisions count during play, while event size and achievements await completion`

   現：`final match in ongoing event remains eligible for explicit decision recognition`。計數改明確認列；service decision,event and auxiliary 驗證不等活動結束。

4. 原：`320 actual entrants cover lower thresholds once; capacity and bracket size do not substitute`

   現：`320 canonical entrants ignore capacity and padded bracket; unavailable roster never invents scale`。規模函式保留；domain inclusive 測試計數包含關係。

5. 原：`unconfirmed event scale stays unknown rather than using room capacity`

   現：`320 canonical entrants ignore capacity and padded bracket; unavailable roster never invents scale`。保留 unknown 不用capacity。

6. 原：`known test events, byes and withdrawn decisions do not become official credit`

   現：`test/cancelled/bye/revoked results excluded; role or seat never upgrades them`。保留。

7. 原：`trusted score audit fallback must match current confirmation time and score revision`

   現：`operator UID and exact score audit are not evidence of responsibility`。audit fallback 自動歸責已淘汰；exact audit 仍不得自動計數，故不再查 audit 亦無 audit分頁限制。

8. 原：`cross-document duplicate logs count one match only`

   現：`missing authority invalid identity and duplicate logs remain distinguishable without deletion`。保留去重，判決計數改認列後唯一。

9. 原：`source limits expose incomplete and prevent automatic L1 and official grant`

   現：`rooms and logs bounds report independent reasons; unread rooms remain pending`。恢復來源上下限；service incomplete sources 驗 L2拒絕且 L1可核定。

10. 原：`archived ranked event does not depend on ladder payment; byes do not block completion`

   現：`completed ranked event ignores payment and bye completion, but unfinished real match blocks event`。保留付款與輪空不阻擋活動完成。

## tests/referee-certificate-wiring.test.cjs

1. 原：`presentation rank requirements and milestone definitions match the authoritative service`

   現：`presentation rank requirements and milestone definitions match the authoritative service`。保留測試與原宿主adapter靜態/隔離模組邊界；不等同整站流程驗證。

2. 原：`an ordinary player can open their own duty certificate and referee achievements`

   現：`an ordinary player can open their own duty certificate and referee achievements`。保留測試與原宿主adapter靜態/隔離模組邊界；不等同整站流程驗證。

3. 原：`closed rollout falls back to overview without issuing a certificate request`

   現：`closed rollout falls back to overview without issuing a certificate request`。保留測試與原宿主adapter靜態/隔離模組邊界；不等同整站流程驗證。

4. 原：`only active, non-test super administrators get the management UI`

   現：`only active, non-test super administrators get the management UI`。保留測試與原宿主adapter靜態/隔離模組邊界；不等同整站流程驗證。

5. 原：`async context reads the current identity and cannot retain authority after account change`

   現：`async context reads the current identity and cannot retain authority after account change`。保留測試與原宿主adapter靜態/隔離模組邊界；不等同整站流程驗證。

6. 原：`logout and UID changes reset certificate cache alongside the shared session epoch`

   現：`logout and UID changes reset certificate cache alongside the shared session epoch`。保留測試與原宿主adapter靜態/隔離模組邊界；不等同整站流程驗證。

7. 原：`session restoration keeps enabled player routes and rejects disabled or unauthorized management routes`

   現：`session restoration keeps enabled player routes and rejects disabled or unauthorized management routes`。保留測試與原宿主adapter靜態/隔離模組邊界；不等同整站流程驗證。

8. 原：`management V2 only exposes referee management when core gives it the allowed tab`

   現：`management V2 only exposes referee management when core gives it the allowed tab`。保留測試與原宿主adapter靜態/隔離模組邊界；不等同整站流程驗證。

9. 原：`certificate calls use the existing authenticated callable bridge and timeout`

   現：`certificate calls use the existing authenticated callable bridge and timeout`。保留測試與原宿主adapter靜態/隔離模組邊界；不等同整站流程驗證。

## tests/referee-license-ui.test.cjs

1. 原：`inclusive scale previews, unknown sizes, exact limits and within-grade progress`

   現：`inclusive scale previews, unknown sizes, exact limits and within-grade progress`。保留測試與原宿主adapter靜態/隔離模組邊界；不等同整站流程驗證。

2. 原：`late account-A response cannot render into account B, including same-UID new epoch`

   現：`late account-A response cannot render into account B, including same-UID new epoch`。保留測試與原宿主adapter靜態/隔離模組邊界；不等同整站流程驗證。

3. 原：`get errors and malformed snapshots stay explicit, never become zero totals`

   現：`get errors and malformed snapshots stay explicit, never become zero totals`。保留測試與原宿主adapter靜態/隔離模組邊界；不等同整站流程驗證。

4. 原：`backfill keeps confirmed totals while saving and accepts only returned server state`

   現：`backfill keeps confirmed totals while saving and accepts only returned server state`。保留測試與原宿主adapter靜態/隔離模組邊界；不等同整站流程驗證。

5. 原：`ambiguous write failure retries the identical operation, never adds duplicate backfill`

   現：`ambiguous write failure retries the identical operation, never adds duplicate backfill`。保留測試與原宿主adapter靜態/隔離模組邊界；不等同整站流程驗證。

6. 原：`revision conflict rereads authoritative totals, preserves draft and requires a new explicit send`

   現：`revision conflict rereads authoritative totals, preserves draft and requires a new explicit send`。保留測試與原宿主adapter靜態/隔離模組邊界；不等同整站流程驗證。

7. 原：`incomplete sources block grants, excluded logs are labelled, and retained awards are visible`

   現：`incomplete sources block grants, excluded logs are labelled, and retained awards are visible`。保留測試與原宿主adapter靜態/隔離模組邊界；不等同整站流程驗證。

8. 原：`chief without a certificate can be cleared and a new global appointment invalidates other cached chiefs`

   現：`chief without a certificate can be cleared and a new global appointment invalidates other cached chiefs`。保留測試與原宿主adapter靜態/隔離模組邊界；不等同整站流程驗證。

9. 原：`self photo removal and identical retry are allowed; other-person photo and admin actions are blocked`

   現：`self photo removal and identical retry are allowed; other-person photo and admin actions are blocked`。保留測試與原宿主adapter靜態/隔離模組邊界；不等同整站流程驗證。

10. 原：`host achievement navigation keeps the real duty tab authoritative and reset drops cache`

   現：`host achievement navigation keeps the real duty tab authoritative and reset drops cache`。保留測試與原宿主adapter靜態/隔離模組邊界；不等同整站流程驗證。

## referee-certificates/emulator/service.emulator.cjs

1. 原：`real Firestore transactions issue once for duplicate gets and allocate distinct numbers`

   現：`real transaction get stays pure; explicit zero-experience approval retries only once`。淘汰 get 自動發號；明確核定併發驗證。

2. 原：`real receipt and backfill mutations are atomic, idempotent, and keep grants separate`

   現：`real recognition receipt survives dropped reply; cancellation withdraws counted experience without deleting evidence`。改typed認列，保留收據與撤銷恢復。

3. 原：`chief contention has only one winner and one global audit record`

   現：`real global chief contention has one winner and one global audit`。恢復真交易競態。

4. 原：`current private results override self-writable legacy logs, and pending events stay separate`

   現：`real recompleted result invalidates recognition and public experience until reverified`。舊confirmedUid自動歸責淘汰；unit operator UID/final match + service ongoing recognition 覆蓋新規則。

5. 原：`rules reject direct self and administrator SDK access to all server-managed paths`

   現：`rules reject direct self and administrator SDK access to every server-managed path`。保留並新增claims路徑。

## 瀏覽器驗證邊界

三個現行 browser scripts 仍是隔離fixture：版面/照片、UI-service契約、公開名片模組。contract 使用自造ctx/router；public攔截playerCard資料且使用替代render。它們沒有證明整站「玩家管理→核定」或真正名片宿主完整流程。原有frontend verifier/wiring unit不能替代此流程。v3另新增 `tests/referee-full-host.browser.cjs` 完成選定真宿主流程；原三組的隔離範圍不變，沒有重寫UI。

## 獨立審查修正

R1：伺服器保存每個match來源指紋（雙方、勝方、比分、結果方法、確認者/時間、完成時間、score revision）。get不更新指紋；有變化轉待認列，只有新的明確save可取得新指紋，前後版本在audit。restore不重新認列變更結果。

R2：全域refereeCertificateDecisionClaims交易鎖，涵蓋正式decision來源鍵；不同UID不能同時取得同場。撤銷或修改移除來源才明確釋放，另一人可另行核實取得；原人恢復遇衝突拒絕。舊owner和新owner各保留audit，claim保留上一UID；無自動歷史移轉。auxiliary不占正式責任鍵。尚未部署，沒有執行既有正式ledger遷移。

R3：所有mutation交易內重新檢查D.active(actor)，拒絕inactive/deleted/frozen/tester/isTestAccount；本人get仍純讀。target資格不依target帳號狀態。

UI：incomplete訊息改只暫停L2以上；L1仍須明確核定。18 gate與順序保留，另測外人不得佔號、counter不一致需reconciliation。

## tests/player-center-integration.test.cjs — 原20項原樣保留並重跑

1. `audited test room remains in the test archive despite stale official metadata` — 原檔未修改，完整CI指令執行通過。

2. `saved maximum is labeled permanent only with a valid server response; incomplete or malformed responses retain replay labeling` — 原檔未修改，完整CI指令執行通過。

3. `event groups share Hunter canonicalization: corrections replace wins, revocations and byes stay excluded` — 原檔未修改，完整CI指令執行通過。

4. `overview uses its own source and period without touching Hunter filters; PK and enchantment excluded from headline` — 原檔未修改，完整CI指令執行通過。

5. `S1 boundary keeps Loft results official and prelaunch or undated records separate` — 原檔未修改，完整CI指令執行通過。

6. `explicit test metadata separates archived test matches without classifying by title` — 原檔未修改，完整CI指令執行通過。

7. `hunter journey milestones use official records and show partial grade honestly` — 原檔未修改，完整CI指令執行通過。

8. `loading, errors and missing season never show zero victories as verified stats; partial history is explicit` — 原檔未修改，完整CI指令執行通過。

9. `career preserves nonstandard sources and unknown dates without inventing placement or leaking markup` — 原檔未修改，完整CI指令執行通過。

10. `career history initially limits full event cards and reveals the rest on demand` — 原檔未修改，完整CI指令執行通過。

11. `active schedule excludes completed and cancelled entries, keeps family participants distinct` — 原檔未修改，完整CI指令執行通過。

12. `profile keeps basic data and title paths while new account defaults to overview` — 原檔未修改，完整CI指令執行通過。

13. `settled evidence preserves real zero points and exact placement rather than guessing` — 原檔未修改，完整CI指令執行通過。

14. `public podium requires finished state and one resolved participant ID; names and family IDs cannot grant placement` — 原檔未修改，完整CI指令執行通過。

15. `no receipt, partial failure and multiple receipts never become zero points or settled self results` — 原檔未修改，完整CI指令執行通過。

16. `lazy result reads deduplicate, can retry failure, and never write after account/session changes` — 原檔未修改，完整CI指令執行通過。

17. `late result from previous login epoch cannot populate the same UID cache` — 原檔未修改，完整CI指令執行通過。

18. `event evidence is always self-only across roles and seasons, without querying admin-wide audit logs` — 原檔未修改，完整CI指令執行通過。

19. `missing and ambiguous transactions return explicit states, malformed points never become zero` — 原檔未修改，完整CI指令執行通過。

20. `authentication, event identity, test isolation and session epoch guard event evidence` — 原檔未修改，完整CI指令執行通過。


## v3真宿主流程補驗

實際 index → SDK auth事件 → 帳號管理玩家分類 → 主選單裁判管理 → 搜尋與零經驗L1核定 → 排行榜玩家搜尋 → 原player-cards overlay → engagement playerCardService → 獨立refereeCertificatePublicSummary → 關閉，全流程通過。沒有自造ctx/router/render，也沒有替換engagement adapter。全部本地Firebase transport fixture；證件兩個callable執行候選真service，playerCardService後端回應則是fixture，不宣稱驗過該後端。公開步驟斷言不呼叫私有裁判get。

本地環境修復：SDK fixture補getApp、以現存ladder control fixture避免無關的初始化路徑、回傳本地伺服器時間Date標頭；尋找玩家details透過原生Enter展開，沒有直接改DOM open屬性或繞過事件。產品檔未為測試改動。

完整原CI指令：85 PASS；原三組隔離browser PASS；新增full-host PASS；emulator8 PASS沿用v2（本輪未修改後端）。

## v4承諾入口更正

v3主導航測試並未證明玩家詳情入口，該聲明由本節更正。v4最小產品修改為core玩家詳情按鈕與事件guard、referee-license UI共用選人函式及受權限保護的openAdminTarget。真host改走玩家分類→展開指定玩家詳情→管理裁判資格→直接選中UID，無搜尋呼叫；保留核定→名片流程。新增真host晚回應跨UID隔離及關閉旗標/admin/player拒絕。其餘85項測試不刪除、不改案例，三個原browser scripts重跑通過。
