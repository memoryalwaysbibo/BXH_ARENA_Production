# UID-first current events: isolated candidate

Date: 2026-10-15. Frontend source checked against released main `42d5e4a4a7cca06b9de2af383e99d83fb4cdabf4`; local snapshot baseline `7cd26ce`. Backend contract research source: `BXH_ARENA_Functions_Production@9368be49750c47b37a26c9af4f76ddef77279b4d`. This document does not certify that backend source as the currently deployed artifact.

## Result

The new optional current-events entry reads the signed-in account's candidate room memberships, then at most K authorized public rooms, with four concurrent room reads and a hard 64-room limit. Its normal successful read shape is two state documents + K membership documents + K public room documents, O(K), rather than an application-wide tournament scan. Firestore empty-query minimum billing and retries are not represented by that simple document count. No production latency in seconds was measured.

Default feature flag is OFF. To opt in only in an isolated fixture, set `window.BXH_FEATURE_FLAGS={uidActiveEvents:true}` before loading the application. A missing module with the flag requested fails closed with a reload message. It never silently falls back to a broad scan. History/Hunter and `queryMyRegistrations` retain their existing semantics. This prototype is not the separate Hunter-achievement or ladder performance fix.

The UI distinguishes current, waiting, finished and unknown participants. It preserves unknown identity/format/read states, including incomplete double-elimination/team data. Family participants in the same room remain separate. It never binds accounts by name. It reads publicTournaments only, requires server reads and explicit public visibility, and never falls back to a private room. Cross-day rooms are not excluded by a date filter. Closed rooms and reopened rooms are projected from current authority.

Readiness requires state→memberships→state agreement on status, generation and revision. UID and auth epoch scope every request/cache; old account results are discarded. A ready empty snapshot is described as synchronized snapshot information, not a guarantee that asynchronous writes have caught up. Missing readiness, denied/failed reads, an over-limit index and pending mutations are not empty success. Same-session mutations stay pending until a genuine matching receipt arrives; old callables do not yet provide that receipt. Timeouts avoid overlapping the still-running Firestore read; the UI offers reload while blocked and re-enables explicit refresh after that read settles.

## Main files

- `modules/main-app/active-events.js`: validation, conservative classification, bounded single-flight controller, rendering.
- `modules/cloud/active-events-reader.js`: server-only fenced reader and public-room boundary.
- `modules/main-app/core.js`, `modules/cloud/cloud-runtime.js`, `index.html`: optional entrypoint, visible-tab refresh, flag-aware mutation hooks.
- `court-call-ui.js`, `enchantment-ui.js`, `registration-invitations-ui.js`: indexed discovery and account/epoch isolation when enabled.
- `backend/membership.cjs`, `backend/firestore-adapter.cjs`: pure authoritative projector and injected transaction adapter; handlers default disabled.
- `backend/backfill-dryrun.cjs`: synthetic dry-run only; no readiness writer.
- `backend/firestore.rules.candidate`: standalone owner-only read rules, not a replacement production ruleset.
- `tests/active-events.test.cjs`, `tests/active-events-review.test.cjs`: unit, reader and actual-core VM checks.
- `tests/e2e/active-events.spec.cjs`, `playwright.active-events.config.cjs`: four browser scenarios across desktop/mobile Chromium (eight cases).
- `backend/membership.test.cjs`, `backend/rules.emulator.test.cjs`, `backend/run-rules-emulator.sh`: projector/adapter and real standalone Rules validation.
- `scripts/run-regression-core.cjs`: registers new frontend suites; existing queue/lobby VM harnesses include the new optional wiring dependencies without removing old assertions.

## Validation and reproduction

Final local results: 67/67 focused frontend/reviewer/backend tests passed (26 + 19 + 22), 37/37 critical regression groups passed, production frontend verification passed, syntax and whitespace checks passed. Independent review also ran a 92/92 candidate-plus-collateral selection. These overlapping totals must not be added together. The standalone real Rules Emulator suite passed separately.

Run from repository root:

```
node --test tests/active-events.test.cjs tests/active-events-review.test.cjs backend/membership.test.cjs
node scripts/run-regression-core.cjs
node scripts/verify-production-frontend.cjs
git diff --check
bash backend/run-rules-emulator.sh
```

The standalone Rules suite ran against a real loopback Firestore Emulator using a demo project, isolated HOME/config and no production credentials. It validates owner read/list and denial for other users, anonymous clients, client writes and reverse projections. This is not merged-production-Rules validation.

Browser launch was attempted but blocked by the environment's Chromium socket policy before any assertions ran. The eight browser cases therefore have NO browser acceptance result, and no visual/screenshots evidence exists. VM tests are not a substitute for this check. The browser fixture blocks non-loopback requests and mocks cloud APIs.

After separate authorization to submit a branch/run remote CI, a standard GitHub Linux runner can run the existing regressions plus `npx playwright test -c playwright.active-events.config.cjs` with an approved/pinned `@playwright/test` install and its Chromium browser. The emulator helper currently defaults to a previously installed local Firebase CLI path; CI should provide `FIREBASE_CLI_JS` pointing at an official pinned firebase-tools installation and Java 21. The frontend browser cases must pass before any rollout discussion. The release build must also update cache-busting versions for changed entrypoint scripts.

## Production gates still open

1. Confirm deployed writer, schema and Rules baselines. Merge and test overlapping existing Rules; standalone Rules allow/deny success does not prove the merged result.
2. Implement and verify a real bounded backfill/readiness writer with a source fence and change-drain verification. The included receipt validator is local-contract-only. Include users with genuinely zero rooms; never mark ready from an incomplete scan.
3. Integrate retrying triggers with external lag/availability gating. Error marking exists, but a total database failure may retain a stale ready snapshot. Trigger eventual consistency cannot promise no transient omissions, especially organizer additions and other devices.
4. Decide how production mutation responses provide trustworthy receipts. No fabricated receipt and no recurring full-library fallback.
5. Handle scale above 1,000 registrations or 200 affected owners per room; current code fails closed rather than unsafe chunking.
6. Resolve family-transfer policy and trustworthy linked onsite identities. Synthetic teammate IDs and unlinked guests cannot be mapped to accounts. Unsupported individual elimination states remain unknown until authoritative support exists.
7. Complete real desktop/mobile browser acceptance and stage end-to-end deployed-trigger tests. No live data or live authenticated player service was exercised.
8. Obtain explicit approval for remote submission/CI, then separately for deployment, production Rules changes, bounded production backfill and cohort enablement. None occurred in this task.

Rollback remains an explicit flag change. Turning this feature off restores the existing application behavior; the feature never automatically flips itself off in response to missing modules or read errors.
