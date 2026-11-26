# PTN referee integration acceptance — 2026-11-26

Scope: PR #894. Official, general/community, and partner ticket rooms share the seat and retirement core. PTN keeps its existing ticket lifecycle and ranking settlement. This is a candidate acceptance record, not a release authorization.

## Verified locally

- Shared retirement scenarios: live assigned zero-score work remains attached until completion or exit; pre-start unassigned seats may be removed; scores and history survive detach/claim; removed seat requests do not revive on expansion.
- PTN scoped session: owner invitation UI, staff direct entry, accepted-seat read, main-seat scoring and revision checks, standby handoff, account changes and room context isolation.
- UI regressions: populated pre-start seat labels, no false disabled hint, exactly one workstation per physical court with current assignment, closed and idle court views, public revision coalescing during an in-flight read.
- 257 local related Node tests, shared retirement scenarios and frontend invariant verifier passed.

## Acceptance not yet complete

- Full official/live PTN score-panel parity: current PTN implementation still lacks the common PASS/pause/resume, fault, rematch, previous-result correction and equivalent swap/next-match workflow. Do not call it identical or expose unconnected controls. Review these against existing dispatch and scoring semantics, then implement/test compatible operations without changing settlement rules.
- Current candidate must pass all required GitHub CI, including actual Firestore and browser validation. Earlier green results are not a substitute for the current head.
- Production packaging: compare the live `registrationRosterQueueV2` archive (last operator-reported generation 1795672892869015) against the candidate and preserve every unrelated writer/binding; include the new ticket referee adapter and its shared service/core dependencies, retirement engine, and applicable lifecycle/mirror code. Official/general referee runtime must be independently compared with its live archive before applying shared retirement changes. Preserve the historical community-release bundle; it is not the new production package.
- No formal room mutations or production release flag changes during candidate validation. Verify matching frontend/backend publication and explicitly authorized activation before a real PTN room acceptance; test invitation, staff seat, handoff, score, exit, resize, re-expand, completion and unchanged ladder settlement.
