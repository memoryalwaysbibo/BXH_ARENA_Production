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

CI now includes the full original page and real Firestore-trigger publication against the staged source and live-policy Rules. On d426e2f, the full frontend, general referee, three-seat, and Rules workflows passed. The bucket workflow exposed two blockers: real-event deferred PASS publication failed to converge after snapshot changes/lock contention, and the scoped emulator Rules path was outside its config project directory. This follow-up moves the scoped config to the repository root, queues same-room publications within a process without dropping later events, and re-captures changed snapshots up to three times before rejecting for durable platform retry. Five trigger tests and four offline-source tests pass. Full page/event CI must pass on this follow-up before readiness is claimed; local Functions/browser execution was not available. In-process queueing does not serialize different production instances or guarantee a latency bound.

## Publication boundary

Before preparing any actual deployment, freshly verify live generations, feature flags, room epochs, and the Rules hash; download each full immutable source archive, verify its original hash, and apply only this reviewed file overlay while retaining uncaptured files. Review the resulting full archives and run the scoped native/page/event checks. Keep rollout, per-court enablement, pilot migration, and rollback as explicit separate operations. No production release is performed by this package, and `deployableWithoutFreshReview` remains false.

## Read-only full-archive preparation

`python3 operator/BXH816_prepare_trial.py` runs from a clean pinned repository checkout in the operator's authenticated Cloud Shell. It validates the captured baseline and the reviewed overlay plan, checks live function generations, Rules, flags, allowlist and room storage, downloads the three immutable full source archives, verifies their original hashes, and preserves uncaptured files while building local candidate ZIPs. It rechecks live deployment/policy after preparation. Original ZIPs and Rules are retained in a mode-0700 local directory; no deployed code is executed, no dependencies are installed, and no deployment or room mutation command exists in the tool.

Only a successful run creates `READY_FOR_REVIEW` and reports its directory. That marker is not deployment authorization. If preparation fails, incomplete local files must not be used. The operator can share the printed summary and `review.json` for the next review; source archives remain local.

At candidate f660feb, all five workflows passed, including the original page with scoped runtime/Rules and real-event automatic publication with asynchronous PASS. This verifies tested behavior, not a production latency guarantee. The preparation tool is a separate follow-up and requires its own offline protection checks.

## Source-only release tool (not executed by this PR)

`operator/BXH816_release_trial.py --directory PREPARED_DIR --function NAME` defaults to read-only live checks. `--apply` uploads the pinned full candidate ZIP and calls the Functions v2 PATCH API with **only** `updateMask=buildConfig.source`; runtime/service configuration, environment variables, event trigger, IAM, Rules, rollout flags, and room documents are not patched. Publisher, seats, and score can be reviewed and applied one at a time. This updates existing bucket services; it is not a new isolated shadow service, and the currently allowed pilot rooms can execute the new code. It does not enable v2 or deferred PASS flags, migrate rooms, or publish frontend changes.

The exact candidate archive hashes are pinned to the operator-verified preparation. Original deployment identities and archive hashes must match the immutable capture. Live gates, policies and storage manifests are checked again. The tool fingerprints protected cloud settings (without storing secrets), journals each operation, polls its completion, re-reads the deployed immutable archive, verifies its bytes, and checks protected settings stayed unchanged. Cloud source copying is allowed only when the resulting full archive hash is exact.

`--rollback --apply` restores the captured original source for a successfully recorded release, after verifying the live revision is still the one this tool produced. It cannot silently overwrite a later release. These are three separate cloud deployments, not an atomic multi-function change; partial completion is possible. There is no server-side compare-and-swap on the source PATCH: exclusive operator coordination is required. The tool rechecks updateTime immediately before submission but cannot eliminate that race. If a PATCH result is lost, the journal blocks another mutation until the operator investigates; a recorded pending operation can be polled again without resubmission. A settings/hash verification failure also requires inspection rather than a blind retry.

References: [Functions v2 upload protocol](https://cloud.google.com/functions/docs/reference/rest/v2/projects.locations.functions/generateUploadUrl), [source field-mask update](https://cloud.google.com/functions/docs/reference/rest/v2/projects.locations.functions/patch).

Five mocked release tests cover cloud-read-only default, source-only update, protected settings, idempotent completion, original-source rollback, ambiguous network outcomes, and signed-upload host validation. They do not represent an actual production deployment test. Existing runtime CI remains tied to f660feb until the operator-only follow-up completes its own checks.
