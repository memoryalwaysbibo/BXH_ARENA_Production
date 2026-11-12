# CALL lifecycle polling repair candidate

Scope: frontend only, based on main 00b0201ff45843b096c2a0a3600964e8c55c5955. No backend permission changes, room mutations, deployment, or registration-flow changes.

## Behavior
- Do not invoke the side-effecting CALL `list` for known waiting, closed, cancelled or completed rooms. Dates never decide whether a room is live.
- Reuse the current manager room's realtime state or legacy / UID-first schedule summaries. If needed, read the existing public summary at most once per 30 seconds per room. UID-first deep-cloned snapshots use lifecycle/authority signatures and their receivedAt timestamp, not object identity.
- Bound supplemental summary reads to 3 seconds and isolate room polling so a stalled room cannot block another live room.
- Keep live CALL cadence at 2.5 seconds after completion; no changes to notify/prepare/respond or backend PASS recall logic.
- Pause a room on permission-denied. Resume on lifecycle or meaningful authority/participation changes, account/session changes, explicit successful schedule refresh, push navigation, or successful explicit CALL operation. Ordinary score changes do not resume denied calls. An older failure cannot undo a newer explicit resume.
- Transient CALL failures use capped exponential backoff (5, 10, 20, 40, 60 seconds). Offline browsers issue no CALL. Missing public metadata does not falsely end an established live channel.

## Evidence and limits
20 focused local VM tests cover waiting-to-live, both schedule readers, timeout/concurrency, permission pause and explicit recovery races, offline/reconnect, capped backoff, account changes, terminal states, and ordinary live cadence. Existing CALL/PASS, queue and lobby tests pass. `scripts/verify-production-frontend.cjs`, syntax and diff whitespace checks pass.

A broad Node run on this environment has baseline failures: initial candidate (18 new cases at that point) 1772 passed / 24 failed / 22 cancelled / 2 skipped; unchanged main baseline 1754 passed / 24 failed / 22 cancelled / 2 skipped. Failure labels are identical. This is not a full regression pass. Latest focused and broad final rerun results are reported with the handoff.

No live calls, production test data, role/permission changes, or room operations were used. VM cases do not establish real Firebase Auth, browser timing, push delivery, network transport or production acceptance. Preserve normal post-start notify/prepare/PASS acceptance and real device checks before deployment. This repair intentionally does not change the separately observed backend empty-visible-matches permission response.

## Review preparation follow-up
- Rechecked remote main on 2026-11-12: still 00b0201ff45843b096c2a0a3600964e8c55c5955. Existing CALL-related draft #709 is backend ownership fencing, not this frontend lifecycle repair; registration draft #787 is separate feedback logic.
- Final broad candidate: 1822 tests, 1774 pass, 24 fail, 22 cancelled, 2 skipped. Unchanged main: 1802 tests, 1754 pass, the identical 24 failure labels / 22 cancelled / 2 skipped.
- Isolated Chromium launch was attempted normally and with the supported elevated execution path; both failed before page creation with `socket() failed: Operation not permitted`. Browser/device acceptance remains unrun. No connection to production or room operation was attempted.
- Publication is draft review only. The repository's production Pages workflow is gated to a successful validation of a main push; this feature branch / PR must not be merged or deployed from these local results.
