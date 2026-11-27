# PTN referee integration acceptance — 2026-11-26

Scope: PR #894. Official, general/community, and partner ticket rooms share the seat and retirement core. PTN keeps its existing ticket lifecycle and ranking settlement. This is a candidate acceptance record, not a release authorization.

## Verified locally

- Shared retirement scenarios: live assigned zero-score work remains attached until completion or exit; pre-start unassigned seats may be removed; scores and history survive detach/claim; removed seat requests do not revive on expansion.
- PTN scoped session: owner invitation UI, staff direct entry, accepted-seat read, main-seat scoring and revision checks, standby handoff, account changes and room context isolation.
- UI regressions: populated pre-start seat labels, no false disabled hint, exactly one workstation per physical court with current assignment, closed and idle court views, public revision coalescing during an in-flight read.
- 299 local related Node tests previously passed. The preceding PASS candidate head 3c69475d43141d48efd7d20f54c7179bf89c860f passed all 26 GitHub workflows. Current candidate adds manager routing and previous-result correction; 300 related tests passed locally and current-head CI remains required. Candidate bb1bfa8 passed 25 of 26 workflows, including the real registration emulator and three-seat candidate. The production frontend workflow failed in two jobs: community guest confirmation (twice) and an unrelated catalog browser test teardown (`route.continue: Route is already handled!`). The former fixture drained the initially resolved roster chain before its first snapshot; align its wait with the passing multi-court fixture without bypassing the confirmation. The latter is reported separately, not modified in #894. The new candidate additionally exercises swap and correction against real Firestore emulator documents; its result is pending.

## Acceptance not yet complete

- Standard individual controls: fault (including pending fault undo), rematch, pause/resume, score log, left/right view swap and authoritative next-match preview are now wired. PASS defer and automatic return through PTN confirmation, plus manager manual return to an eligible court, are locally verified with preserved score history and public routing. Physical cross-court swap of eligible unplayed matches and correction (retain score/reset) now use the existing engine with PTN manager authority, room version fencing, public mirror projection, no forfeiture correction, and local tests for current-court play and downstream actual-play blocking. Browser/Firestore candidate acceptance and release packaging remain. Do not import a different dispatch policy or change settlement rules.
- Current candidate must pass all required GitHub CI, including actual Firestore and browser validation. Earlier green results are not a substitute for the current head.
- Production packaging: compare the live `registrationRosterQueueV2` archive (last operator-reported generation 1795672892869015) against the candidate and preserve every unrelated writer/binding; include the new ticket referee adapter and its shared service/core dependencies, retirement engine, and applicable lifecycle/mirror code. Official/general referee runtime must be independently compared with its live archive before applying shared retirement changes. Preserve the historical community-release bundle; it is not the new production package.
- No formal room mutations or production release flag changes during candidate validation. Verify matching frontend/backend publication and explicitly authorized activation before a real PTN room acceptance; test invitation, staff seat, handoff, score, exit, resize, re-expand, completion and unchanged ladder settlement.

## 賽事功能邊界（對焦表）

| 分類 | 官方賽 | 玩家一般賽 | 合作主辦 PTN |
|---|---|---|---|
| 標準個人賽：四分制、失誤、撤銷、重賽、暫停／恢復 | 共用 | 共用 | 候選版補齊，共用標準控制及失誤核心 |
| 三席裁判、退場、縮台、接管 | 共用核心 | 共用核心 | 共用核心，保留 PTN 房間權限 |
| 玩家邀請（名稱／信件／QR） | 不新增 | 既有 | 沿用一般賽邀請 |
| 工作人員直接入席 | 既有 | 既有 | 既有共用席位流程接線；不需邀請 |
| 左右選手顯示互換、比分紀錄、下一場預覽 | 共用 UI | 共用 UI | 候選版補齊；不變更真正派場 |
| PASS 跳過 | 既有依賽制和權限 | 既有依賽制和權限 | 候選版接通共用單淘汰引擎，比分保留；自動及管理手動回補已通過本地交易驗證及上一版 26 項 CI |
| 實際跨台換場／派場、上一場修正 | 既有依賽制和權限 | 既有依賽制和權限 | 候選版共用引擎接通，房主／代理／最高管理權限沿用 PTN；有實際得分或已開打的下游場次保護已驗證，待當前 CI |
| 快速判定 | 僅已啟用的快速模式 | 僅已啟用的快速模式 | 標準 PTN 不開放 |
| 團體、附魔、分組／多階段等賽制 | 僅現有適用賽制 | 依已支援賽制 | 本次單淘汰個人 PTN 不導入 |
| 票券、扣券、主辦資格及代理權 | 不套用 | 不套用 | PTN 專屬，既有流程保留 |
| 排名結算／天梯資格 | 依官方規則 | 一般賽不套用排名賽資格 | 既有已驗證規則保留 |

「左右互換」是本機畫面顯示，不等於真正跨台換場。上一場修正須沿用既有下游賽果保護，不得跨越已進行的對戰或已結算賽事。未確認的賽制專屬功能不因 UI 共用而啟用。

## Candidate backend package inputs (prepare only)

The source hashes below identify the reviewed candidate overlay, not a verified live archive or a complete deployable package. Never replace whole live packages with repository snapshots. PTN registration function uses the nested paths shown; the referee service has its own source root and must be independently matched to its active entrypoint/archive. Shared files require comparison in each target; do not assume both active archives contain identical copies.

| Candidate path | Target | SHA-256 |
|---|---|---|
| `registration-flow-v2/backend/bindings.cjs` | PTN (surgical binding merge) | `9ed0d1e3e3849cd8d216bca9d09bd1c9bb863715fbd2479a693fee9f4c9f93cd` |
| `registration-flow-v2/backend/lifecycle.cjs` | PTN | `595825287c62a9dad33060bebb723224296d70d17b300c22eba67a920e4ad65e` |
| `registration-flow-v2/backend/ticket-room-create.cjs` | PTN | `2a7fff862447a672b18dea2c4225eeccd809b453c6be0341cc9326b65e33c2fe` |
| `registration-flow-v2/backend/ticket-referee-seat.cjs` | PTN (new) | `01ac91f7f7d6bc76ee2b9292d0b25583328a22d72535ee2f6af36da6145f231f` |
| `referee-seats/functions/core.cjs` | Both | `701d8d46aeeead78b52cebef69ff6a020b722f70fe36e69d0a44a47e1f861092` |
| `referee-seats/functions/service.cjs` | Both | `6235be2154c2e794fd38e795b19a3eb8dec2be0ca33f7174bf03309705e3fe14` |
| `referee-seats/functions/scoring-core.cjs` | Both | `40e7559aaceed370894b185d254ea27ecf4ff216eee5a77ad56a01ab276fa50f` |
| `referee-seats/functions/dispatch-core.cjs` | Both (dependency) | `be4f67ffd20d797e34717f5b6553822cb31e5153a6cb3d36b8c0e03f9cf50b47` |
| `referee-seats/functions/event-staff-core.cjs` | Both (dependency) | `1287fb6e3dbc43c03e56cc133888ee5d874846939addff79df3b6b7f215218c6` |
| `referee-seats/functions/bucket-legacy-fence.cjs` | Both (dependency) | `0620fcf6f405b4c355043da59ac2c47976003010bec0d07d856f9e5bca1c9d12` |
| `referee-seats/functions/scoring-service.cjs` | Official/general | `cbb95653f78ff5b3574acc30b2a04926c3874ff4781f11f1a43c3dea47e19711` |
| `referee-seats/functions/bucket-scoring-service.cjs` | Official/general | `016a2d524b378a2b4fd12274b881ff9761d6e6721747f6310dd7c49577937b08` |
| `referee-seats/functions/engine/court-retirement.cjs` | Both | `632c40b5b2b0abbc73769ad85d0a8185030af4240b6ab6005d7c3e7b8d121653` |
| `referee-seats/functions/engine/manifest.json` | Both (engine provenance) | `1664a2d1ad82ed51fbf9f41ea8df471cbb17a190c29e6895ae036dd6505a1c70` |

Package preparation checks:

- Read the actual generation and entrypoint of each deployed function and compare its source inventory and fingerprints against these inputs; preserve unchanged live exports, codebase, package/lockfile, runtime settings and unrelated routes. In particular, the historical court-count script applied a surgical bindings patch to the live archive, so its deployed bindings digest is not assumed equal to repository main. Review actual differences before staging any replacement.
- Resolve the full relative `require()` closure against each staged archive, including the generated engine and its provenance; verify the service-scoped routes, actual transaction tests, and historical frozen community bundle. No flag activation, upload, deployment or live room mutation is part of this preparation.
- The current workspace has no `gcloud` CLI or live archives; a verified production-aligned package cannot yet be assembled. The hashes identify candidate inputs only.
