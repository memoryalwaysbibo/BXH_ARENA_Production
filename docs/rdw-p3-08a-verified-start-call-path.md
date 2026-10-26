# RDW P3-8A — Verified production start-button call path

Status: **frontend source located; backend atomic hook not yet implemented**.

## Source evidence

Read `modules/main-app/core.js` (blob `073d4c90a85a2c7432f82d31e1424816745d683f`) from the production repository branch.

The `if(action==="start-tournament")` handler has distinct team and individual branches. For individual matches it:

1. Rejects already-started tournaments and missing brackets.
2. Calls `syncLatestOnlineRosterBeforeLock()` and `bracketRosterIsCurrent()`; optionally `verifyBracketBeforeStart()`.
3. Opens confirmation modal (early-start or ordinary confirmation).
4. In `actuallyStart`, **repeats** roster synchronization and bracket freshness checks.
5. Copies previous state, sets `state.startedAt=Date.now()`, calls `rebuildCourtAssignments()`, locks roster and registration, and calls `saveState()`.
6. On explicit `saveState()===false`, restores prior state and attempts `saveRecord(state)`.

Team battle follows a separate branch and should be excluded from first RDW rollout until separately audited.

## Critical integration implications

- The browser `Date.now()` is not a trusted server pre-match timestamp.
- A separate snapshot write next to `saveState()` would NOT be atomic with start and risks split-brain state.
- Current code has no verified server-side atomic start+RDW snapshot transaction at this location.
- A true backend start endpoint must check authoritative roster/draw revision, seal snapshot or RDW PASS audit, and transition started state in one transaction. The UI should only reflect the acknowledged server result.
- PASS must never bypass roster/bracket/auth safety checks, and a failed/unknown response must trigger readback before retry.
- `saveState()` cloud write behavior and its storage schema still need inspection before replacing this path.

## Next gates

1. Trace `saveState()` through `modules/main-app` and cloud runtime to canonical Firestore document and transaction permissions.
2. Implement a feature-flagged backend atomic start endpoint (OFF by default) only after matching deployed backend and rules are identified.
3. Emulator tests for standard individual bracket, concurrent start, duplicate request, stale roster, snapshot failure/PASS, and no mutation to lifetime awards.
4. Browser E2E: clicking start produces a single server-confirmed baseline, or an explicit RDW-only PASS; no production deploy without owner approval.
