# Deletion lease candidate — rollout remains closed

This package prevents a legacy room deletion from racing a bucket migration,
restore, or another deletion worker. It does not delete bucket rooms or enable
bucket scoring. It is a review package, not evidence of a live deployment.

The handler is based on the exact captured `deleteTournamentSafely` deployment,
with its `hosting-core.js` and `tournament-delete-core.js` dependencies preserved.
`restore-operations.js` changes only the early ownership check in
`restoreIdleTournament`; deploy only that named function, never the other exports
in this shared archive. `manifest.json` pins the original source archives,
candidate modules, Rules, and synthetic test dependency fixtures. No environment
file, credential, or production room data is included.

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
FIRESTORE_EMULATOR_JAR=/path/to/cloud-firestore-emulator-v1.19.8.jar python3 -B tests/four-court-buckets/deletion/rules-emulator.py
```

The 47 deletion and 16 restore checks use mocked Firestore SDKs and captured pure
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
3. Update only `deleteTournamentSafely`, replacing its reviewed module in its own
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
