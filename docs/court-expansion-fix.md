# Safe court expansion candidate

Base: memoryalwaysbibo/BXH_ARENA_Production main 7af506971150454daeefe540522622ffc98a7620.

## Scope and cause

A bracket generated with one court keeps all pre-generated matches on station 1. The previous resize path only moved matches above a reduced target. Authoritative idle fill could then move the same candidate repeatedly in one loop because it did not immediately reserve the destination.

This candidate fixes a future explicit increase in court count. It does not migrate or automatically rebalance rooms already set to six courts. It does not change court-call pending recovery, send notifications, modify permissions, deploy code, or write production tournament data.

## Safety behavior

- Expansion balances only genuinely unstarted queued matches, including future bracket placeholders. It changes station, dispatchRevision and updatedAt for actual moves, never bracket IDs, sequence, round, slots, results or dependency edges.
- Conservatively reserves every current and displayed next because the browser lacks authoritative call records. Zero-score current matches are reserved too.
- Excludes started/paused/completed/results/confirmation/offline-pending work, score/log/fault data, detached/closed courts, PASS/skip/resume work and referenced PASS/skip predecessors.
- Expanding a still-draining plan also persists protected high-court IDs so the following legacy shrink/reconcile pass cannot move them.
- Idle fill uses the same exclusion policy and reserves its destination immediately.
- A valid existing next remains next and advances to current. Explicit manual priority, resumed matches and the existing PASS dependency priority retain precedence. Invalid, completed or blocked next pointers are not pinned.
- Same-target resize is a routing/plan no-op. Updated callers capture the plan revision before asynchronous flushes, and the transaction rejects a missing or stale revision, including an ABA count change.
- Existing private/public writes and lifecycle, QR and onsite fences remain in the same transaction. No new courtCalls reads or notification calls are added.
- Plain shrinking retains its existing drain/transfer semantics. This is not a redesign of notified-next handling during an explicit decrease.

## Validation and boundaries

The added tests extract the production functions and use the original retirement/match helpers and single-elimination propagation. No scheduling helpers are stubbed. Cloud tests run the original transaction/fence/mirror code with an in-memory Firestore boundary and an unrelated event-info formatting stub. Transaction retries are simulated; these are not real Firestore Emulator concurrency tests.

Commands:

- node --test tests/court-expansion.test.cjs
- node --test tests/court-retirement.test.cjs tests/idle-court-dispatch.test.cjs tests/court-call-pass-queue.test.cjs tests/court-call-next-prepare-ui.test.cjs
- node scripts/run-regression-core.cjs critical
- node scripts/run-regression-core.cjs warning
- node scripts/verify-production-frontend.cjs
- node --check modules/main-app/core.js
- node --check modules/cloud/cloud-runtime.js
- node --check modules/main-app/court-retirement.js
- git diff --check

The new suite can be run against a separate exact-main source directory with COURT_RESIZE_TEST_ROOT. The baseline fails the new behavioral cases; keep red and green outputs separate. The earlier read-only reproduction is unchanged outside this candidate.

This candidate has not been merged, published or deployed. No live-room snapshot has been used. A current six-court room needs a separately reviewed, room-specific read-only preview before any repair authorization. The new client revision check is not a claim that old deployed clients are server-side blocked. Real browser/Emulator validation and release cache/build coordination remain release gates.
