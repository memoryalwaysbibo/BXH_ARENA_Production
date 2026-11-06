# Referee stable DOM regions (isolated candidate)

Base: `0471069df5a09a433c4c945aed119004043d82b6` (fetched origin/main).
Branch: `fix/referee-stable-regions`. No deployment, remote push, Rules/IAM changes,
production Firebase writes, bucket activation, or integration of PR #719.

The standard individual referee screen still computes fresh markup on every
render, including permissions, connection notices and global tournament state.
It compares generated templates and patches changed DOM nodes. Unchanged court
subtrees retain their DOM identity, focused controls and native input drafts.
Action keys include match/court/seat/request identifiers so a new action cannot
reuse an old target. Room/user/view transitions remount; team and enchantment
screens keep their existing rendering path. Confirmation and force-exit checkbox
bindings are deduplicated for retained nodes.

Seat callbacks suppress only byte-equivalent merged metadata. Equal revision
with a changed permission projection still renders; explicit access revocation
is handled before deduplication. Existing stale-model rejection remains intact.

This reduces DOM replacement, not room snapshot bandwidth, HTML generation cost,
backend contention, or Firebase write latency. No score update is delayed.

## Verification

- PASS: `node --check` on both changed production scripts; `git diff --check`.
- PASS: `node scripts/verify-production-frontend.cjs`.
- PASS: `node scripts/run-regression-core.cjs critical` (all suites).
- PASS: 232 tests across referee tests, seat core/service/scoring/bridge, queue
  dashboard and stable lobby regressions.
- PASS: `PLAYWRIGHT_BROWSERS_PATH=/workspace/.cache/ms-playwright node tests/referee-stable-regions.browser.cjs`.
  Real Chromium, all network blocked, production patch/score/confirmation/seat
  code with simulated state/transport. Twelve courts, 200 other-court updates:
  zero mutations under the unchanged local court. Checks focus, unsent input,
  score/undo display, connection recovery, disabled permission/global-start
  controls, changed action identity, duplicate/new seat revisions, equal-revision
  permission changes, revocation, and one confirmation callback after 20 renders.
- FAIL: existing referee-preseat browser test reads only newlines from the
  confirmation text. Reproduced at the same assertion on pristine main in a
  separate temporary fixture. Existing seat browser suite also fails its
  handoff-dialog text assertion; baseline comparison for that suite not run.
- INCOMPLETE/FAIL: full 324-case smoke stopped after 6 failures and 26 passes;
  292 not run. Failures cover leaderboard and account/profile screens, not the
  new isolated rendering test. Do not interpret this as full browser acceptance.
- Firestore Rules suites could not run in the initial direct invocation because
  firebase-admin and @firebase/rules-unit-testing are absent. No Rules changed.

Critical/deep emulator and broad test logs are supplied with the handoff. Initial
emulator failures from cache paths and a shared test-server port were corrected
by using FIREBASE_EMULATORS_PATH/XDG_CONFIG_HOME and serial emulator suites.

## Remaining acceptance scope

The new browser fixture executes production rendering and binding functions but
simulates score state changes; it is not an end-to-end callable transaction test.
Full authenticated 12-device score/undo/switch workflows and viewport/gesture
acceptance must pass before rollout. Existing score/callable transaction logic
is unchanged. Global/keyed structural changes can legitimately remove focus or
replace controls. The change is not production-ready while integration checks
remain failing or incomplete.

The broad `node --test tests/*.test.cjs` first run completed with 1681 passed and
24 failed (including missing browser binaries and one extracted binding fixture
regression that was fixed and retested). A run with the correct browser path
still showed catalog browser/admin cleanup failures and stopped making progress;
it was terminated after approximately four minutes. This broad run is incomplete.
The final 232 affected tests and Critical regression passed after the fix.

Final isolated emulator results: critical E2E 0/1 (signup title hidden); deep
E2E 0/3 (all timeout waiting 90 seconds for cloudAuth.isReady before the tested
competition flows). Emulators shut down normally. These failures did not reach
referee scoring; full transaction acceptance remains unverified.
