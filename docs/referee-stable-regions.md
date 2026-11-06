# Referee stable DOM regions — isolated candidate

Base: `0471069df5a09a433c4c945aed119004043d82b6` (fetched origin/main).
Branch: `fix/referee-stable-regions`. No deployment, remote push, Rules/IAM changes,
production Firebase writes, bucket activation, or integration of PR #719.

## Implementation

Standard individual referee screens in both administrative and community rooms
compute fresh markup on every render, including permissions, connection notices
and global tournament state. Generated templates are compared and changed DOM
nodes patched. Unchanged subtrees retain identity, focused controls, native
input drafts and pending confirmations. Actions are keyed by match/court/seat/
request identifiers. Room/user transitions remount; team and enchantment screens
keep their existing rendering path. Retained confirmation/checkbox bindings are
deduplicated.

Seat callbacks suppress only byte-equivalent merged metadata. Equal revision
with changed permission projection still renders; explicit access revocation
is handled before deduplication. Existing stale-model rejection remains intact.

This reduces DOM replacement, not room snapshot bandwidth, HTML generation cost,
backend contention, or Firebase write latency. No score update is delayed.

## Follow-up verification (2026-11-06)

Evidence directory in this checkout environment:
`/workspace/scratch/referee-stable-regions/`.
Main comparisons used `/workspace/bxh-referee-main`, with unmodified main product
sources and the same test-only SDK server, browser configuration and test fixes.

| Check | Candidate | Main comparison / evidence |
| --- | --- | --- |
| Affected referee/community/settings/lobby/queue and seat/scoring tests | 608 passed | `final-affected-all.log` |
| Critical regression core, production frontend invariants, artifact boundary | Passed | `followup-critical-regression.log`, `followup-invariants.log`, `followup-artifact-boundary.log` |
| Original six failing smoke cases | 6 passed | 6 passed with system Chromium; 6 failed with bundled Chromium |
| Full desktop smoke before final fixture fix | 107 passed, 1 failed | Snapshot burst counted unrelated/no-op flushes; reproduced on main |
| Full affected lobby suite after fixture fix | 27 passed | `candidate-lobby-settled.log`; main burst 5/5 in `main-burst-settled.log` |
| Existing preseat and seat browser suites | Passed | Both also pass on main with system Chromium |
| Referee recovery browser suite | 8 cases passed | `candidate-recovery-system.log` |
| Stable regions browser fixture | Passed | 12 courts, 200 other-court updates; zero local mutations, draft/focus preserved; score/undo, permission/global locks, revisions and binding dedup |
| Twelve independent browser pages + actual scoring transactions | Passed | Main also completes operations but replaces local DOM and loses focus; candidate preserves both |
| Authenticated critical emulator E2E, fresh emulator 1.22.0 | 1/1 passed with test App Check provider | Main 1/1; see follow-up diagnosis |
| Deep emulator E2E, fresh emulator 1.22.0 | 3/3 passed with test App Check provider | Main 3/3; settings/draw/scoring complete |

The original six smoke cases were two hunter leaderboard cases and four account/
profile cases (existing profile editor, signup required fields, Google profile
reminder, existing-account profile deferral). Minimal reproduction isolated the
bundled Chromium 140 failure: filling a plain input left it empty and Chinese
inline text had zero bounding boxes. System Chromium 154 renders and fills the
same HTML correctly. `BXH_TEST_BROWSER=/usr/bin/chromium` is an optional test
configuration; default browser selection is unchanged.

The lobby snapshot test now counts only pending, visible render work and settles
the preceding details toggle before measuring the next synchronous burst. Its
assertion remains exactly one flush and the final count 12; no production lobby
behavior was changed. The initial counter-only fix was insufficient (26/27), so
the final settle fix and full affected suite were rerun.

## Transaction and browser coverage boundaries

`tests/referee-multidevice.emulator.cjs` loads the shipped frontend into 12
independent Chromium contexts and invokes the unchanged scoring service against
loopback Firestore. It checks 11 other-device scores, local score/undo, duplicate
click prevention, two concurrent court transactions, unsent result confirmation,
offline write gating/recovery, live/referee tab switching, and authoritative seat
revocation in both UI and service. There are 17 callable invocations and no page
errors. Main reports `same:false, focus:false`; candidate `same:true, focus:true,
mutations:0`. Main's observer was attached to the detached old node, so its zero
mutation count is not evidence of stability.

Auth identities and callable transport are simulated in this test. This is real
transaction coverage, not full authenticated multi-user end-to-end acceptance.
Seat/court handoff behavior is additionally covered by the existing seat browser
suite; the 12-context test's switch is a navigation tab switch. Team/enchantment,
mobile gestures, production network latency and a sustained load soak are not
claimed. Community-specific route is included in the implementation and affected
regressions; its authenticated emulator E2E now passes through scoring with the test App Check provider.

## Historical failures and reproduction

**Follow-up:** The three emulator timeouts below are now isolated to an unresolved
App Check token after blocked reCAPTCHA loading. Main and candidate pass with the
explicit emulator-only provider. See [diagnosis and latest acceptance scope](referee-emulator-diagnosis.md).
The historical failures below are retained as investigation evidence.

Firebase's CDN is blocked by the environment network policy (HTTP 403). The
optional test server serves locally bundled, version-checked Firebase 10.13.0
from an npm scratch directory instead. It never modifies shipping assets. Build
with `node scripts/build-local-emulator-sdk.cjs <scratch npm directory>` after
installing firebase@10.13.0 and esbuild there, then set
`BXH_TEST_FIREBASE_SDK_DIR=<scratch>/browser-sdk`.

Run each emulator suite against a fresh emulator, separately:

```sh
BXH_TEST_BROWSER=/usr/bin/chromium \
BXH_TEST_FIREBASE_SDK_DIR=/workspace/scratch/bxh-test-sdk/browser-sdk \
FIREBASE_EMULATORS_PATH=/workspace/.cache/firebase/emulators \
XDG_CONFIG_HOME=/workspace/.config \
/workspace/scratch/bxh-test-sdk/node_modules/.bin/firebase emulators:exec \
  --only auth,firestore --project demo-bxh-arena-e2e \
  --config tests/e2e/firebase.json \
  'npx playwright test --config=playwright.e2e.config.cjs'
# Repeat with playwright.deep-e2e.config.cjs in a fresh emulator.
```

- Critical: account shell appears but `playerApplyBusy` does not clear in 30s.
  Main had one earlier successful run; latest same-version main and candidate
  runs both fail at this exact completion wait. Shell visibility alone is not
  signup-write completion, so tests now wait for the operation before navigation.
- Deep multi-court: settings-save condition (`stations===2`, no saving flag or
  write gate) times out after 30s. Controls remain disabled.
- Deep tournament: four-player roster is present, but drawing never produces
  `bracketSize>0` within 30s. Admin-finals-order passes on both branches.
- Emulator logs contain `ArrayIndexOutOfBoundsException` in
  `EmulatorRequest.permissionTracesAsJsonArray`; browser traces show unresolved
  Firestore write channels. This is diagnostic evidence, not a proven root cause.
  Narrowing route interception, forcing long polling experimentally, and using
  emulator 1.22.0 instead of 1.19.8 did not resolve all failures. The long-polling
  experiment was reverted. No Rules or production write logic were weakened.
- Detailed failures, screenshots and traces: `main-critical-122*`,
  `candidate-critical-122*`, `main-deep-122*`, `candidate-deep-122*`.

For the transaction/browser fixture:

```sh
BXH_TEST_BROWSER=/usr/bin/chromium \
NODE_PATH=/workspace/scratch/bxh-test-sdk/node_modules \
FIREBASE_EMULATORS_PATH=/workspace/.cache/firebase/emulators \
XDG_CONFIG_HOME=/workspace/.config \
/workspace/scratch/bxh-test-sdk/node_modules/.bin/firebase emulators:exec \
  --only firestore --project demo-bxh-dom12 --config tests/e2e/firebase.json \
  'node tests/referee-multidevice.emulator.cjs'
```

Baseline uses the same driver with `BXH_TEST_REPO=/workspace/bxh-referee-main`
and `BXH_EXPECT_STABLE=0` to record identity without expecting the new behavior.

The original broad Node run was 1681 passed/24 failed with environment and
extracted-fixture problems; a follow-up broad run stalled and was terminated.
The scoped 608 tests and critical regression passed afterward. Full 324-case
multi-viewport smoke and broad Node acceptance have not completed cleanly.
The specific emulator flow failures are resolved in the test environment.
Remaining production attestation, full smoke and broader acceptance scope still
prevent claiming complete release acceptance.

## Mobile and review follow-up (2026-11-07 Asia/Taipei)

Desktop smoke completed 108/108. Android touch-mode twelve-context transaction
coverage passed (17 commands, preserved local DOM/focus, zero unchanged-court
mutations, 412 px viewport with 412 px document width). The fixture now supports
`BXH_TEST_DEVICE=iphone` (WebKit) and `android` (Chromium), native taps, duplicate
touch activation and horizontal-overflow checks. The screenshot fixture includes
indexInRound so labels represent valid generated match data.

The optional Chromium executable override is scoped to Chromium projects; it
must not launch Chromium for the iPhone WebKit project. WebKit dependencies were
missing in this managed host; packages were extracted into the scratch workspace
and the cached launcher was made to preserve LD_LIBRARY_PATH. No system or
product files were changed. Its ldconfig-only optional-library check cannot see
scratch libraries, so host validation was skipped only after a real WebKit
launch/input smoke verified runtime loading. Full phone smoke and isolated
WebKit transaction results are pending at this intermediate commit.

The existing read-only referee CI workflow now runs the stable DOM browser test,
emulator App Check boundary tests and twelve-context actual transaction test.
No deployment trigger was added.
