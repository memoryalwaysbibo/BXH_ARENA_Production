# Auth / settings / draw emulator diagnosis

Base product: main `0471069df5a09a433c4c945aed119004043d82b6`.
Candidate: `fix/referee-stable-regions`. This follow-up changes test infrastructure
and tests only; no product code, Rules, IAM or production settings were changed.
Evidence lives in `/workspace/scratch/referee-stable-regions/`.

## Finding

The remaining timeouts share an App Check credential wait. Background `teamRead`
initializes ReCaptchaEnterpriseProvider on the same Firebase app used by Auth
and Firestore. This environment blocks the Enterprise reCAPTCHA script. App
Check's token promise remains pending, and Firestore waits for that credential
before starting a new write stream or transaction request.

This is distinct from the earlier blocked Firebase SDK CDN and broken bundled
Chromium. The same-version local SDK allowed App Check initialization to advance
far enough to encounter the next blocked dependency, reCAPTCHA.

Evidence, with unchanged assertions and timeouts:

- Signup: the initial `users` setDoc succeeds. The following lastLoginAt update
  and publicPlayers setDoc stay pending; `playerApplyBusy` stays true.
  `diagnostic-critical.log` records these individual operations.
- Settings: runTransaction enters its callback and stops at the first
  `get:tournaments/...`. There is no corresponding BatchGet network request.
- Draw: roster synchronization similarly waits at the first transaction read;
  the bracket is not generated. The wait is before scoring/rendering acceptance.
- Controlled negative test (`appcheck-negative.log`): teamRead calls App Check
  at 4010 ms, token request starts at 4118 ms and never resolves; the transaction
  read starts at 5197 ms and remains pending. The request for
  `https://www.google.com/recaptcha/enterprise.js` fails with
  `net::ERR_TUNNEL_CONNECTION_FAILED`. The settings test fails its original 30 s
  wait. This run disables only the synthetic provider.
- Positive test (`candidate-critical-appcheck.log`): token request at 3589 ms
  resolves at 3683 ms; all recorded Firestore operations finish and signup busy
  clears. With the provider, both candidate and main pass critical 1/1 and deep
  3/3 (`candidate-*-appcheck.log`, `main-*-appcheck.log`).

The earliest general console/network errors include blocked fonts and QR-code
CDN resources; those are not sufficient explanations for these timeouts. SDK
imports in peripheral registration/activity modules also remain blocked. The
workflow-specific causal evidence is the unresolved App Check token, absent
Firestore RPC, and success after replacing only the emulator credential source.

An experiment replacing Playwright routing with CDP URL blocking did not solve
the issue: candidate critical still failed and both deep suites remained 1/3.
Playwright internally enables Fetch interception for all requests even with a
narrow route pattern, but that observation alone was not the root cause. The
experiment was removed; the original production-Firebase request guards remain.
Likewise, the emulator's permissionTracesAsJsonArray exception is not established
as the cause: a failing signup run had no such exception, and the provider fix
works with the same emulator version and Rules.

## Test-only fix

`BXH_TEST_EMULATOR_APP_CHECK=1` enables a CustomProvider in the emulator test
server's transformed cloud runtime. It returns a synthetic token only when all
three conditions hold: hostname 127.0.0.1, project demo-bxh-arena-e2e, and query
bxh_e2e=1. Outside emulator server mode the runtime is served byte-for-byte
unchanged even if the flag is set. Production reCAPTCHA settings are untouched.

Two boundary tests verify the unchanged non-emulator bytes and reject wrong
host, project and query. Run them with no other E2E server occupying port 5001:

```sh
node --test tests/e2e-emulator-app-check.test.cjs
```

Optional `BXH_TEST_TRACE_FIRESTORE=1` records operation start/end/status,
transaction steps, App Check caller/token lifecycle, console errors and failed
network paths in a Playwright attachment. No document bodies or Auth tokens are
recorded. The final acceptance rerun disables this instrumentation. Results are recorded
in `candidate-critical-appcheck-final.log`, `candidate-deep-appcheck-final.log`,
`main-critical-appcheck-final.log`, and `main-deep-appcheck-final.log`.

Use a fresh emulator for each suite, with the existing version-matched local
SDK and system Chromium:

```sh
BXH_TEST_BROWSER=/usr/bin/chromium \
BXH_TEST_EMULATOR_APP_CHECK=1 \
BXH_TEST_FIREBASE_SDK_DIR=/workspace/scratch/bxh-test-sdk/browser-sdk \
FIREBASE_EMULATORS_PATH=/workspace/.cache/firebase/emulators \
XDG_CONFIG_HOME=/workspace/.config \
/workspace/scratch/bxh-test-sdk/node_modules/.bin/firebase emulators:exec \
  --only auth,firestore --project demo-bxh-arena-e2e \
  --config tests/e2e/firebase.json \
  'npx playwright test --config=playwright.e2e.config.cjs'
# Repeat in a fresh emulator with playwright.deep-e2e.config.cjs.
```

Unset BXH_TEST_EMULATOR_APP_CHECK and enable BXH_TEST_TRACE_FIRESTORE to reproduce
the negative control. The positive/negative tests do not extend timeouts, alter
Rules, suppress exceptions, or change the product's scoring/settings logic.

## Actual scope and remaining risks

Critical now explicitly signs out after successful registration, signs in with
email/password through the UI, verifies the same UID, and creates a room. This
avoids treating signup's automatic sign-in as proof of a second login.
Deep covers two-court settings and dispatch, a four-player community tournament
through all three completed matches/archive, public watching, and official
bronze-before-final ordering. Auth and Firestore use real local emulators and the
unchanged fixture Rules. Functions still use the existing constrained fixtures.

The blocked reCAPTCHA script is an environment condition. The shared App Check
credential dependency is also a product resilience risk: an unavailable token
can stall unrelated Firestore operations. It predates this UI change and is
reproduced on main. These tests do not prove whether production users encounter
it or verify real App Check attestation, enforcement, Google OAuth, external
Functions, production latency, or all mobile viewports. No production workaround
has been introduced. Real attestation and resilience hardening remain separate
acceptance work; local flow success must not be presented as that verification.

## Final acceptance results

Diagnostics disabled; original request guards and timeouts retained:

| Suite | Candidate | Unmodified main product |
| --- | --- | --- |
| Registration, explicit password re-login, room creation | 1 passed (6.4 s) | 1 passed (9.0 s) |
| Settings/two courts, full community tournament, official finals order | 3 passed (33.3 s) | 3 passed (33.6 s) |

Boundary tests: 2 passed. Community-summary fixture and public-artifact regression:
45 passed. Syntax and whitespace checks passed. Negative control: 1 intentionally
failed with the original unresolved App Check token; it is retained as causal
evidence, not counted as successful acceptance. No quota limit or approval denial
was encountered. No deployment, merge, production write or settings change occurred.
