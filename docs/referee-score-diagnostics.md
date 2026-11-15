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
