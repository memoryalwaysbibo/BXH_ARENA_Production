# Prior-round dispatch gate

Reported room: BXH-TERKHS, 2026-11-14. This change is based on the reported behavior and repository code; no live room snapshot was accessed or modified.

## Result

Single-elimination official ranked, general and community/player-created rooms share one dispatch rule: an earlier non-bye match must be completed or in_progress before a later-round match can be dispatched. Pending, ready, paused and deferred PASS matches block new later-round assignments. Every earlier round is checked, so a waiting older match cannot be bypassed by a still-later round. Both participants must still be available under the existing queue rules.

Per-court advancement, authoritative idle fill, ready promotion, preassigned pending/ready current pointers, reconciliation, manual assignment/swap and explicit start/ready commands honor the gate. Server start/ready commands recheck the current transactional state. Already ongoing play is preserved if an earlier match subsequently pauses or is reopened. Existing notified-next reservations and same-round PASS ordering remain intact. Bronze-before-final remains a stronger gate. Double elimination and round robin retain their existing format-specific rules.

No new Firestore reads, writes, subscriptions or stored fields are introduced. The generated trusted engine and its manifest are regenerated from the client source. The frontend entrypoint has a new core cache parameter.

## Local verification

- `node --test tests/round-dispatch-gate.test.cjs`: 36 pass. Exercises production client functions and the generated server engine; includes complete deterministic 24-player/4-court, 128-player/6-court and 320-player/12-court synthetic brackets.
- Initial 33-case regression suite run against exact main d5a8e7a04f725df2a88e09de16f8f038626e4c18: 23 fail, 10 pass; failures reproduce the old early-round dispatch behavior. The same cases pass on the candidate.
- `node scripts/run-regression-core.cjs critical`: all 41 groups pass (including the new round gate suite).
- Referee core/service/cloud/scoring/dispatch/bridge, PASS/next preparation, court retirement/expansion: 132 tests pass.
- Bucket scoring/dispatch: 9 tests pass. Scoring/bridge/dispatch, next preparation and tournament completion: 60 tests pass.
- `node scripts/verify-production-frontend.cjs`, syntax checks and `git diff --check`: pass. The previous static check requiring cross-round fallback was replaced with checks for the shared round gate.
- Trusted engine generated with acorn 8.15.0 and acorn-walk 8.3.4; a second generation is byte-identical.

These are local synthetic/in-memory tests, not a production room replay, Firestore Emulator concurrency test, or live browser acceptance test. GitHub CI and release validation remain to be checked. Frontend and backend engine changes must both be released; a frontend-only release does not update server-owned dispatch. No production deployment or room migration is included.

## Integration with management navigation update

Integrated main 7f1f012a5e41b0fc5f783b2f7dfa985f9bf1fbc5 (PR #810). The sole textual conflict was the core script URL in index.html: preserved all new management cache parameters and appended round-dispatch=20261116.1. The shared core merged without overlapping behavioral edits; trusted engine regeneration remains identical. Combined dispatch, management loading/service and host identity checks: 83 pass. Production frontend static verification passes. Previous 37 GitHub checks apply to head d29107328cfb3daa2c19da4b6a054c8dc034e708; the integrated head requires a fresh CI run.
