# Hunter License 2.0 — B4: sample context and recent history

B4 extends analysis and growth tracking after B1–B3. It adds sample maturity, preliminary loss-method descriptions, recent-20 selection, comparable recent/previous windows, and current calculation metadata. It does not change score formulas, license grades, XP or introduce cloud collections.

## Sample maturity

- 資料累積中: fewer than 3 analyzable matches or 8 validated finish events.
- 初步分析: reaches the existing 3-match / 8-event gate; never implies statistical confidence or final calibration.
- 部分資料缺失: overrides the above when B1 detects an incomplete read. Trend deltas and loss conclusions are suppressed.
- 穩定分析: not enabled yet. The original plan requires historical backtesting to set this threshold. The UI explicitly discloses pending calibration; even 100 matches do not automatically earn an unsupported stability claim.

Sample context displays included/total/excluded matches and finish events. The preliminary main loss description uses B2 base-point distribution, preserves ties, distinguishes no loss from insufficient/mixed data, and links conceptually to the existing inline source evidence below. It is descriptive rather than a causal diagnosis.

## Window contract

The analysis selector keeps lifetime/season/month/week/today and adds 最近20場. This selection uses currently selected source-category records, canonicalizes corrections/reversals before sorting, excludes records without usable timestamps, then selects at most 20.

A separate comparison panel always uses lifetime history within the active source category, independently of the period selector (explicitly labeled). It sorts newest-first by completion/confirmation/event-date fallback and uses a deterministic event+match key tie breaker. Recent is positions 1–20 and previous is 21–40. The windows never overlap; neither is artificially shortened to enable a comparison.

Comparison deltas require two complete windows of 20 records, complete reads, known ordering, one scoring version and one source mode, and every match's complete trusted finish ledger. Legacy unversioned standard records use the existing standard contract. Missing timestamps, incomplete/quick ledgers, unknown or mixed scoring versions are disclosed and block differences. Raw per-window statistics remain visible with their actual sample counts.

The panel shows analyzable matches, finish events, analyzable win rate, base-point share, and raw loss-method distribution. Changes use percentage points, not relative percentages. Two-window differences describe those records, not a guaranteed improvement/decline in player strength. Faults and card adjustments remain outside the base-point share as in B2.

## Metadata

Each freshly built analysis returns `hunter-analysis-v1-b2-base`, computedAt, actual match/round samples, and source rows. The successful loader records loadedAt separately from calculation time. The UI displays Taiwan-local calculation and data-verification timestamps, the selected chart metric, source scoring versions and `hunter-trend-v1`.

Older source records are recalculated with the current engine. B4 does not compare old persisted analysis scores or silently cross scoring versions. These are current-view metadata and session cache fields, not a new persistent analysis-history service.

## Acceptance

1. Below 3 matches/8 rounds, show accumulation and no strong main-loss conclusion. At the existing gate show preliminary, with the pending stable-threshold note. Partial reads override both.
2. Check latest corrections and revocations before selecting recent records. Verify all six period controls remain usable alongside B2 categories and B3 metrics.
3. At 40 complete same-source records, show disjoint 20/20 windows and correct percentage-point deltas. At 39 records or any incomplete read/ledger/time/version, display a reason and no delta.
4. Compare percentages against actual current sample counts and B2 base points; card-reduced zero finishes retain base points while fault awards do not contribute.
5. Confirm tied loss methods are preserved, zero losses are distinct from missing data, and original match evidence remains accessible in the existing statistics.
6. Verify displayed formula/scoring versions and distinguish calculation time from last successful data verification. Source corrections recompute the current view.
7. Verify no change in combined score, grade/XP formulas, B1 status safety, B2 classification or B3 graph behavior.

## Verification

6 B4 behavior cases and 20 critical regression groups passed; frontend verifier, license-grade regression, enchantment ledger, JavaScript syntax and whitespace checks passed. Mobile production-renderer/CSS fixtures covered both metrics, 3 categories and 5 data states at 390px, plus complete 40-record comparison windows, without document overflow. Test fixtures are not authenticated production-account acceptance. Chinese fonts are unavailable in this runtime, so screenshots do not replace real-device text/visual acceptance.

B4 is prepared as a review PR. It is not merged/deployed by the implementation request. Stability calibration remains explicitly pending historical backtesting.
