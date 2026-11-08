# Raffle rollback continuation, 2026-11-07

Base: PR #734 commit `20113b37611810395879694b6d89bb57ca1bbd6f`.
This checkout reconstructs the native rollback matrix after the previous local
checkout was no longer available. Results below are fresh local runs, not the old
remote CI run 42352960832 and not a claim that missing local commits were pushed.

## Changes

- Added 200 native Firestore SDK rollback checks covering ordinary storage and
  4/6/12-court buckets, both legacy and participant-v1 identity versions, and
  claim/forfeit/replacement across a switch in the server's default version.
- Compare all bucket documents plus rooms, ledger, raffle/activity/operation
  records, and creation/update timestamps. Replays and rejected requests do not
  write. Old receipts still require current authority and room identity.
- On deterministic SDK ABORTED retry, revoke the actor before callback two; the
  call rejects with no raffle, ledger, activity or operation-log write.
- Existing assembled-callable Chromium flow now also clicks Claim from a stale
  management screen after server authority is revoked. It shows the existing
  permission error and leaves all records unchanged. Draw/update receipt replay
  also rejects after revocation and after public-room recreation.
- Native CI invokes the new test, and the integration manifest pins the exact
  changed workflow/test bytes. Runtime services and callable build code unchanged.

## Fresh results

- Playwright 1.56.1 / Chromium 141.0.7390.37: assembled browser flow passed,
  including existing lost-response/fallback/replacement/claim cases and the new
  stale-screen/recreated-room guards.
- firebase-admin 14.4.0 / Firestore Emulator 1.19.8: input 39, writer 30, new
  rollback 200 checks passed. Script and CLI exited 0 after normal shutdown.
- Existing fixture suites: input 25, identity 19, preview 20, writer 48 passed.
- Source provenance verifier passed. Integration verified 328 pinned files and
  ten components, preserving all current-main script parameters. Syntax,
  workflow YAML and git diff whitespace checks passed.

The earlier browser failure used Playwright 1.55 / Chromium 140. Matching the
known CI version (1.56.1 / Chromium 141) resolved the minimal page and the full
flow in this environment: paragraph height 24, input value abc, and an input event
were observed. This comparison does not establish a general Chromium 140 defect.
System Chromium separately failed to create its process socket, even through the
supported escalation attempt; it was not used for the successful result.

## Limits

Local Node is 24.22.1; remote workflow specifies Node 22. Tests use fixture Auth;
Emulator Rules are permissive in the inherited server-SDK harness. No real
Firebase Auth, App Check, actual deployed revision switch, natural-contention
capacity or production acceptance is claimed. New candidate has no remote CI
result yet. No deployment, production activation or production data access/write.

## Reproduce

```sh
NODE_PATH=/tmp/bucket-integrated/node_modules \
PLAYWRIGHT_BROWSERS_PATH=/tmp/bucket-browsers \
node tests/four-court-buckets/raffle/operations.browser.cjs

GCLOUD_PROJECT=demo-bxh-bucket-raffle \
NODE_PATH=/tmp/bucket-integrated/node_modules \
/tmp/bucket-integrated/node_modules/.bin/firebase emulators:exec \
  --only firestore --project demo-bxh-bucket-raffle \
  --config tests/four-court-buckets/raffle/native.firebase.json \
  'node tests/four-court-buckets/raffle/native-input.cjs && node tests/four-court-buckets/raffle/native-writers.cjs && node tests/four-court-buckets/raffle/native-rollback.cjs'

python3 -B tests/four-court-buckets/integration/verify-integration.py
```

Use writable HOME and XDG_CONFIG_HOME/XDG_CACHE_HOME when the shell home is
read-only. Install the exact browser dependency versions from the integrated
workflow; do not weaken visibility assertions to accommodate a broken browser.

## CI-runtime parity verification

The same candidate was rerun locally with Node 22.23.4, matching CI's Node 22
major version, and the exact Playwright 1.56.1 browser dependency:

- Assembled Chromium browser flow, stale-screen permission denial and
  recreated-room receipt rejection passed.
- Native input 39, native writer 30 and rollback 200 checks passed; the complete
  Emulator command exited 0 and shut down normally.
- Fixture suites 112, inherited recovery/real-name policy 28, and derived title
  event 10 checks passed.
- Nine backend package families verified; writer-discovery 13, follow-up 5 and
  raffle-readonly 5 tests passed. All 328 integration pins verified again.

The remote workflow route is technically suitable: the current production Pages
workflow deploys only successful main-branch push runs, not candidate PR runs.
Publication of this candidate still requires explicit owner approval. No branch,
pull request, or new remote CI result was created. The only remote CI success
cited above remains the older 20113b base; all new results are local.

## Winner-update retry interruption coverage

Added 48 native SDK scenarios: ordinary storage and 4/6/12-court buckets,
legacy/participant-v1 ledgers, claim/forfeit/replacement, and either authority
revocation or public-room recreation between callbacks. The first callback queues
writes then receives deterministic ABORTED. The second sees the changed context
and rejects. Snapshot equality after the intentional fixture change proves no
additional writes; the raffle revision, winner status/count, winner ledger and
missing operation receipt are checked separately. No partial claim, forfeiture or
replacement remains after rejection.

Fresh Node 22 run passed: input 39, writer 30, expanded rollback 248 checks
(317 total native checks), with normal CLI exit 0 and Emulator shutdown. Fixture
112, builder 12 and provenance checks passed unchanged; 329 integration pins and
whitespace checks passed. No runtime service changes, upload, deployment or live
reads/writes occurred. The remaining release gates are unchanged.

## Latest-base integration, 2026-11-08

Integrated #734 `70a73cabb7eb3e1d17944288cd3edc5d7c0b2c83` into #743
`9b5ccb78c0895d2e9e96d6564df211f2ea989bc7` in a fresh isolated checkout.
The combined workflow retains both review-builder and offline deployment-probe
checks. Its manifest pin was recomputed; all 332 component pins pass. The diff
against #734 remains the eight approved test/workflow/manifest/documentation
paths. The inherited deployment script and its probe are byte-identical to #734;
no production deployment command was executed.

Fresh Node 22.23.3 / Playwright 1.56.1 / Chromium 141 checks passed:

- 112 raffle fixture, 12 review-builder and 6 offline cutover checks.
- 317 native SDK checks: input 39, writer 30, rollback 248.
- All other integrated-workflow fixture, package, boundary, recovery, My Events,
  activity/settlement bridge and derived-event checks.
- Full-host deletion browser 20, settlement browser bridge 24, offline browser
  11, offline wiring, assembled raffle rollback/authority/recreated-room flow,
  and the targeted lobby snapshot-coalescing browser check.
- Workflow YAML parsing, changed JavaScript syntax and whitespace checks.

The combined native command reached the final authenticated HTTP Callable test,
but the Functions Emulator could not bind its local Unix socket (`listen EPERM`).
A supported elevated execution retry of that test encountered the same restriction.
The test therefore remains locally blocked; the successful SDK checks do not
establish an HTTP endpoint pass. No assertions or emulator runtime were modified
to bypass the restriction. Fresh remote CI is still required for this integration.
These fixture/emulator results are not real Auth, App Check, production revision
switch or live-room acceptance. No merge, deployment or live-data write occurred.
