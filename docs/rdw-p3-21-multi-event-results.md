# RDW P3-21 — Multi-event Reader verification (2026-10-23)

Verified user-uploaded deployed Cloud Function ZIP (SHA-256 `90c00efb537b216771f157b9ceff4cfaa11d6abb0d3a4aba6978b0600d779963`) locally; extracted `reader.cjs` invoked with isolated canonical Firestore-shaped data.

## Observations from local actual Reader execution

| Synthetic official completed tournaments | Reader complete | Current tier | Source evidence |
| --- | --- | --- | --- |
| 1 | true | ungraded | 1 recorded match |
| 5 | true | ungraded | 5 recorded matches |
| 10 | true | ungraded | 10 recorded matches |
| 30 | true | ungraded | 30 recorded matches |
| 5 (score-winner conflict) | false | pending | 5 winner-score-conflict issues |

A string of wins in tiny 2-player tournaments is **not** sufficient to simulate rank promotion; authentic minimum-attendance eligibility must be modeled, not bypassed.

## Added to repository

- `tests/rdw-hunter-multi-event-history.test.cjs`: deterministic provenance and mixed-history fail-closed probes using genuine private Reader when available.
- CI runs syntax/test harness even without the private ZIP. When `RDW_HUNTER_BUNDLE_ROOT` is unset, full Reader assertions are **skipped**, not passed.

## Still required

1. Accurate official >=32 participant event fixtures and all Hunter rank eligibility thresholds.
2. Family identity / archived account / ambiguous registration rejection.
3. Real Firestore Emulator transaction + immutable tournament baseline with bounded batches for 128/320 participants.
4. Backend callable wiring; no launch button or production deployment before all previous gates are proven.

No Firebase production writes or deploys in this task.
