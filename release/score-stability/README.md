# BXH816 captured-source overlay — review only

This package is built from the operator's read-only 2026-11-18 source capture, rather than replacing production with the generic laboratory source tree. It performs no cloud writes, deployment, feature enablement, or room migration.

## Verified baseline

Capture: `referee-seats/reference/BXH816_bucket_sources-20261118.zip`, SHA-256 `aefe79320490411e4fc8b2f4b91c5a2fb8f710b98ecb59d52a727a31731d5eac`.

| Function | Captured revision | Source generation |
| --- | --- | --- |
| commitBucketRefereeCommand | commitbucketrefereecommand-00006-won | 1794722128839589 |
| manageBucketRefereeSeats | managebucketrefereeseats-00002-jay | 1794722195891401 |
| projectBucketPublicScore | projectbucketpublicscore-00002-hol | 1794722273213484 |

Both captured pilot rooms, BXH-SCR4AA (4 courts) and BXH-SCR2AA (2 courts), use `bxh-match-buckets-v1`, each with one score bucket. Native per-court storage and deferred PASS publication are not enabled in the captured configuration. These pilot settings do not establish the storage route of historical incident rooms.

The separately supplied legacy command engine, dispatch, and scoring hashes match the reviewed #817 release overlay. Their differences from an older capture are expected. This package does not replace or deploy either legacy function.

## Scope and preservation

`release-plan.json` records every selected file's before/after hash. The offline builder preserves captured entry points, package metadata, core authorization, event staff authorization, legacy scoring service, seat service, Callable entry, and legacy fence byte for byte. The captured scoring and dispatch modules receive small anchored changes for the reviewed round/PASS guards and PASS return projection; unrelated community authorization additions from the generic laboratory are excluded. The generated engine and its PASS return helper are explicitly changed files, not byte-identical legacy files.

Bucket storage, transaction, public projection, migration, and diagnostics modules come from the reviewed candidate. The resulting selected source maps for all three functions are identical. This verifies the selected source subset; the capture is not a complete deployable source archive.

The Rules overlay starts from the captured live Rules, SHA-256 `23f7acd2e06c428f3a628d1dad02d703b746cd28d1f48e6caf8c606248982e68`. It changes only the score-bucket schema predicate to recognize v2 when `perCourtStorageEnabled` is true. Registration V2 guards, community referee policies, and every other byte remain unchanged. Result SHA-256: `c3bd501001bcfb5f7bd7d727800e694bb97f68c364164ca7ad5dfe63ac4909f9`. Do not substitute `release/buckets/firestore.rules` for these current-live policies.

## Reproduce offline

From the repository root, use an output directory that does not exist:

```sh
python3 -B tests/score-stability-scoped-release.test.py
python3 -B scripts/build-score-stability-release.py \
  --bundle referee-seats/reference/BXH816_bucket_sources-20261118.zip \
  --output test-results/score-stability-scoped
```

The builder rejects a changed capture, source hash, generation, Rules baseline, or patch anchor. `scoped-release-loader.cjs` validates all staged file hashes before routing tests to that source. The scoped Callable fixture replaces only its emulator entry point and never contacts production.

## Verification and remaining limits

Local captured-source checks on 2026-11-18 passed:

- Four Python tests: protected source preservation, matching staged packages, Rules preservation, and tamper rejection.
- 45 staged-runtime tests: routing, dispatch, transactions, migration, and projection consistency.
- Firestore Emulator: v2 activation, 6/12-court scoring, PASS, replay, resize, rollback, final progression, and asynchronous PASS with concurrent score/pause/confirm.
- Web SDK Rules checks using the live-policy overlay: authorized reads, revocation, cross-room isolation, private receipt denial, direct write denial, and feature shutdown.

One mixed-load emulator run (128 players/5 courts and 320 players/12 courts) completed 62 operations with zero failures and 21 retries: p50 525 ms, p95 5,322 ms, maximum 12,640 ms. This is not a controlled comparison and does not establish production latency. Multi-second contention remains; deferred publication alone is not a complete fix. PASS still reads all buckets and changes shared scheduling/root state.

CI now includes the full original page and real Firestore-trigger publication against the staged source and live-policy Rules. These newly added checks are pending on this revision; local Functions/browser execution was not available. The earlier generic bucket suite passed after merging #817, but separate global Deep E2E checks had unresolved guest-modal and PASS-button failures. Do not report all checks green or production readiness until those are assessed.

## Publication boundary

Before preparing any actual deployment, freshly verify live generations, feature flags, room epochs, and the Rules hash; download each full immutable source archive, verify its original hash, and apply only this reviewed file overlay while retaining uncaptured files. Review the resulting full archives and run the scoped native/page/event checks. Keep rollout, per-court enablement, pilot migration, and rollback as explicit separate operations. No production release is performed by this package, and `deployableWithoutFreshReview` remains false.
