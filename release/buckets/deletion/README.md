# Deletion lease candidate — rollout remains closed

This package prevents a legacy room deletion from racing a bucket migration,
restore, or another deletion worker. It does not delete bucket rooms or enable
bucket scoring. It is a review package, not evidence of a live deployment.

The handler is based on the exact captured `deleteTournamentSafely` deployment,
with its `hosting-core.js` and `tournament-delete-core.js` dependencies preserved.
`restore-operations.js` changes only the early ownership check in
`restoreIdleTournament`; deploy only that named function, never the other exports
in this shared archive. The roomAccess candidate is separately pinned to its
own captured archive; never substitute the restore archive for it. `manifest.json` pins the original source archives,
candidate modules, Rules, and synthetic test dependency fixtures. No environment
file, credential, or production room data is included.

The selector candidate is based separately on source set 13 captured on
2026-11-03 (`93b4e9e1d5c7605b98474ce3d192c0623bc94dd170e977bc1be638e182805014`).
`registration-selection.patch` is the exact diff against that deployed module.
It replaces the alternate `manageRegistrationSelection(action=delete)` recursive
parent deletion with the same audited worker as `deleteTournamentSafely`.
The selector supplies its original `operations-core.canManage` policy, original
code/operation-ID syntax, lottery-enabled/drawing restrictions, and onsite
ownership checks. It does not gain the ordinary endpoint's orphan cleanup.
Its original staff scope is retained, including unassigned staff where the
existing selector policy permits them; ordinary deletion authorization is unchanged.

The shared worker checks foreign ownership markers before parsing selector state,
and reauthorizes before final deletion. Both endpoints share canonical operation
IDs and worker tokens, including cross-endpoint retries. A legacy
`registrationSelection.status=deleting` with no matching audited lease stops with
`deletion-legacy-worker-requires-review`; it is never assumed safe to restart.
The public marker omits actor/operation information. Selector configure, draw,
promotion, lottery admission/cancellation, each draw chunk/finalization, and draw
lease cleanup also reject bucket/deletion ownership in their write transactions.
Cleanup leaves the old draw lease untouched if ownership has transferred.

Deploy only the named selector function from its own exact archive, overlaying
`registration-selection.js`, `tournament-delete.js`, `hosting-core.js`, and
`tournament-delete-core.js` with the pinned package bytes. Keep the original
`operations-core`, onsite/QR guards, package lock and every other dependency.
Do not deploy the sibling `lotteryRegistration` export merely because it shares
this source file: that endpoint needs its own exact deployed-source review.
The additional guarded code in this module does not prove its live deployment.
Inventory/drain old selector deletion requests before updating this endpoint;
never infer absence of a still-running old worker from a successful source update.
Update this alternate endpoint before treating the main deletion rollout as safe.
The prior Cloud Shell preflight helper predates these changes and is insufficient
to validate or deploy this expanded package. No new deployment helper is supplied.

Validation adds 417 selector cases (ownership presence, original authorization,
onsite policy, cross-endpoint pending/retry, reused room codes, and migration
injected after freeze/plan/row chunks). `selection-native.cjs` uses the real Admin
SDK and captured QR transaction proxy on a loopback demo Emulator, with synthetic
auth context. The full-host browser tests continue to cover the ordinary delete
UI; there is no selector-delete button in the reviewed current UI, and server
compatibility is retained for older or direct callers. Neither synthetic auth
nor Admin SDK tests establish real production Auth/App Check acceptance.

## Behavior

- A transaction authorizes the operator and claims the original room's creation
  identity. Any bucket marker (including null/malformed values), migration lease,
  or remaining match bucket rejects legacy deletion.
- The parent and public entry remain fenced until child cleanup and staff cleanup
  settle. Only child collections reach recursiveDelete; final parent/public/audit
  changes commit together after authorization and lease checks.
- Each active operation has exactly one worker token. Retries return pending
  without starting another traversal. A settled error pauses that worker; the
  same operator can resume the same canonical operation, including older clients
  that accidentally submit a new operation ID. Other operators cannot adopt it.
- A killed or timed-out worker stays active. Elapsed time alone never permits
  takeover. This avoids an old in-flight delete removing children of a reused code.
- Browser intents persist per account and room before the request. Lost responses,
  reloads, and failed public confirmation retain the intent. Success requires
  the public entry to be absent. Account changes stop the flow. A completed
  operation cannot delete a recreated room; it requires a separate explicit action.

## Review and validation

From the repository root:

```sh
python3 -B scripts/build-bucket-release-rules.py --check
python3 -B tests/four-court-buckets/deletion/verify-package.py
node tests/four-court-buckets/deletion/deletion-probe.cjs
node tests/four-court-buckets/deletion/restore-probe.cjs
node tests/four-court-buckets/deletion/client-probe.cjs
node tests/four-court-buckets/deletion/access-probe.cjs
FIRESTORE_EMULATOR_JAR=/path/to/cloud-firestore-emulator-v1.19.8.jar python3 -B tests/four-court-buckets/deletion/rules-emulator.py
```

The 47 deletion, 16 restore and 34 room-access checks use mocked Firestore SDKs and captured pure
helpers; they are not full deployed SDK acceptance. The 16 client checks execute
the actual runtime method in a VM with synthetic transport/storage, not a full
browser UI. The real Emulator runner uses only a fixed loopback demo project and
compares the captured currently deployed Rules against the candidate. It checks
173 permissions/contention cases. No test writes production data.

## Controlled deployment order (not performed by this PR)

1. Re-read live Rules (expected hash in manifest), both functions' full source
   archives and configuration, and confirm all bucket/runtime/room gates remain
   closed. Stop and reconcile any drift. Save private source/config receipts.
2. Deploy and read back the candidate Rules first. Then update only
   `restoreIdleTournament` with its expanded lease guard, preserving the current
   fenced source and every dependency/configuration. Verify exact source readback.
3. Before the deletion handler, update only `roomAccess` from its own current
   fenced archive using `room-access-service.js`. This also blocks password
   verification from adding accessGrants/attempts during a retained deletion or
   migration lease; normal unmarked verification remains unchanged, with one
   extra public-document read in its transaction. Verify source/config readback.
   Then update only `deleteTournamentSafely`, replacing its reviewed module in its own
   exact deployed archive. Preserve runtime, environment, trigger, service account,
   scaling and dependency bytes; read back the source and configuration.
4. Release the browser intent change through the normal frontend validation path.
   Verify authenticated operator flows, lost responses, retries, rejected bucket
   rooms and permission revocation on an explicitly designated disposable room.
5. Complete the wider Admin writer inventory and multi-referee six-court
   cutover/rollback acceptance before enabling any bucket room.

Do not blindly roll back the Rules or restore guard while a deletion/migration
lease exists: that would reopen writes during cleanup. On an error retain the
lease and canonical operation ID. A paused worker is retryable by the same
operator after checking the failure. For a still-active worker, inspect the
operation receipt, function request/log state and all in-flight cleanup first;
no reset, expiry-based takeover, or destructive un-fence command is supplied.
Clearing an active lease requires a separate reviewed recovery plan. Do not
replace this with an operator instruction to retry arbitrary new operation IDs.


## Deployed restore/access source reconciliation — 2026-11-05

The uploaded read-only capture observed at 2026-11-05 01:14:50 UTC
(09:14:50 Taiwan) pins restoreIdleTournament revision
`restoreidletournament-00009-zej` and roomAccess revision
`roomaccess-00034-red`. Their complete archive, build configuration and service
configuration hashes match the capture report. Exact source generations,
configuration digests and dependency/QR-guard hashes are recorded in
`manifest.json.deployedSourceReadback`; no environment values are published.

Both deployed entrypoints already reject scoreStorage/scoreBucketProjection.
The refreshed fixtures retain these guards byte-for-byte. The candidate restore
patch expands the marker list with bucketMigration/deletionStatus; room access
also reads the public peer and rejects a retained migration/deletion lease before
issuing a password grant. The candidate runtime files did not change in this
reconciliation. Existing operations-core, room-access-core, release controls and
all three QR proxy dependencies match their pinned fixture hashes.

The package verifier now derives each patch from its exact deployed guarded
baseline. The 41 restore and 58 access Node checks preserve deployed score fences,
deny lease-marked writes, and compare ordinary unmarked behavior. These are local
synthetic checks, not real Auth/App Check, production latency or cutover acceptance.
The candidate is still not deployed or activated. Preserve each target's complete
live archive and configuration during later source-only packaging; the older Rules
fixture is not a live Rules deployment target. Use the separately reconciled
current community Rules boundary for release planning.
