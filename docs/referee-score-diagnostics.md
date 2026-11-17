# Referee score timeout diagnostics

On 2026-11-14, the operator supplied Cloud Run request logs for three POSTs to
`commitrefereecommand` starting around 10:10 UTC. Each returned 504 after about
30 seconds. Their correlated logs contain Callable verification success but no
application phase information. These traces alone do not establish room identity,
Firestore contention, transaction retry counts, or whether a timed-out operation
eventually committed. Cloud Run request timestamps must not be treated as response
completion timestamps.

The legacy scoring handler emits structured diagnostic records with room code,
bounded action/station, a hash of the operation ID, and a validated Cloud trace ID.
It records read, authorization, optional partner read, transition/projection,
write preparation, and transaction commit phases. Callback invocations count
transaction attempts; a second invocation is explicitly logged as a retry.
`complete` is emitted only after `runTransaction` resolves. A non-blocking, unref'd
20-second watchdog records the last stage reached while a request remains pending.
Timers are cleared on success and rejection. Logging exceptions are swallowed.

No UID, names, player IDs, auth headers, request payloads, score snapshots, or raw
dependency error messages are logged. Dependency error codes are numeric or from a
fixed allowlist. Logs do not bypass authorization, alter writes or receipts, change
the 30-second service timeout, or switch room storage. The watchdog does not cancel
the transaction and does not prove failure. A timeout can still have an uncertain
commit outcome; check authoritative state and the operation receipt before retry.

## Validation

Failures also expose `errorReason` from an explicit allowlist of engine `seatCode`
values (for example `score-stale`, `dispatch-stale`, `seat-stale` and
`pass-protected`). `errorCode` continues to identify numeric/allowlisted dependency
codes. Unknown values remain `unclassified`; error messages are never used as a
fallback. This distinguishes a stale request rejected during transition from a
database rejection during commit without changing scoring or transaction retries.
It only improves future logs after deployment; it cannot reconstruct reasons
missing from previously recorded failures.

The 2026-11-17 BXH-Z85SEZ screenshots show operation `275fc18f7ff8702b`
re-entering the callback at 21,618 ms and 44,458 ms, after commit-labelled waits of
20,743 ms and 22,757 ms. The final outcome is not visible. Later screenshots show
overlapping score retries on courts 1, 3 and 5 and failures in both commit and
transition. This supports investigating shared-document contention, but does not
prove a particular lock holder, dependency error, successful commit or the reason
for any transition failure. The retry interval includes SDK backoff; it is not an
exact measurement of Firestore server lock duration.

`node --test referee-seats/score-diagnostics.test.cjs referee-seats/scoring.test.cjs`
checks retry accounting, stage timing/watchdog cleanup, private-field exclusion,
logging failures, and real handler behavior with a transaction adapter. The existing
scoring engine regressions run alongside it. This is not a production capacity test.

## Release and investigation

This patch is prepared for review only. Before a backend release, read the currently
deployed source/revision and compare it with the reviewed source. Preserve any live
community/partner repairs and engine changes; do not deploy the repository function
directory wholesale. Include `score-diagnostics.cjs` in the reviewed source archive.

After an authorized release, query `jsonPayload.component="referee-score"` and
`jsonPayload.room="BXH-X3T8MJ"`. Correlate hashed operation and trace with Cloud Run
request logs. A slow `read-documents` means the initial read has not completed; a
slow `commit` means the callback queued its writes but `runTransaction` has not
resolved. A retry establishes callback re-execution, not its underlying cause.
Use the phase evidence to decide the next investigation or fix. Keep diagnostics
only as long as needed; phase records increase log volume and should be evaluated
after capture. Do not claim these new records reconstruct historical missing spans.

## Bucket scoring

The bucket scoring handler uses the same diagnostic helper with a fixed `storage="bucket"` field. It records root/auth/config/receipt reads, authorization, bucket reads, materialization, optional structural public reads, transition, optional new-bucket reads, write preparation and commit. Receipt replays use `commit-replay`. Local score operations still do not read or write the public document or write the root. No additional Firestore request, retry or wait is introduced.

`node --test tests/four-court-buckets/diagnostics.test.cjs` checks the actual handler with a deterministic transaction adapter, including a delayed bucket read, delayed commit, retried callback, receipt replay, dependency failure, broken logger, privacy and watchdog cleanup. Source registration and packaging must include `score-diagnostics.cjs` alongside the bucket handler. Phase logs increase volume; keep them scoped to the controlled pilot and review retention/cost afterward. Correlate backend phases with the Callable request and frontend completion; backend elapsed time alone is not end-to-end latency.
