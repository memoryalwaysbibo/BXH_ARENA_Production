# Admission recovery hardening

Current candidate supersedes the prior backend candidate. Earlier evidence remains historical and is pinned to its older candidate hashes. This report uses the handler/admission hashes in hardening-results.json. No production deployment or live request occurred.

Changes: queue saturation/expiry now return registration-admission-pending, not ABORTED. The existing frontend therefore retains unconfirmed state, persists the original request and reads current registrations. Identical user/room/operation/payload submissions share pending work within a module, including separate handler factories. Conflicting payloads are refused, other users/rooms remain isolated, and settled results are not cached. SDK attempts refresh the business clock after initial reads.

Eight admission tests passed, including the exact 128-pending limit, the 129th refusal, failed/timed-out predecessor fencing, same-operation coalescing and cache release. Six real Admin SDK/Firestore Emulator plus actual frontend-controller checks passed: saturation and timeout can retry the same operation; a peer can commit after a local scheduler times out without showing failed; coalescing across factories preserves cancellation readback; expired deadlines and accounts disabled while queued are rejected. Test-only admission waits are 25ms; the controller clock is advanced past its existing 3-second query throttle. This is not a live callable or a real 45-second wall-clock test.

The test harness uses a random namespace per process so sequential suites in one emulator do not reuse old registration documents or receipts. The CI orchestrator now runs recovery, forty-client comparison and the two-round hundred-client benchmark in sequence.

Local post-hardening hundred-client results (100 unique users start preview together, then each joins with the returned allocation, no manual retries or frontend polling):

| Capacity | Repeat | Schedulers | Successful | Confirmed | Waiting | Max s | Failures |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 128 | 1 | 1 | 100 | 100 | 0 | 1.77 | {} |
| 128 | 1 | 4 | 100 | 100 | 0 | 6.962 | {} |
| 128 | 2 | 4 | 100 | 100 | 0 | 6.56 | {} |
| 128 | 2 | 1 | 100 | 100 | 0 | 1.486 | {} |
| 64 | 1 | 1 | 64 | 64 | 0 | 1.334 | {'allocation-changed': 36} |
| 64 | 1 | 4 | 64 | 64 | 0 | 7.313 | {'allocation-changed': 36} |
| 64 | 2 | 4 | 64 | 64 | 0 | 8.877 | {'allocation-changed': 36} |
| 64 | 2 | 1 | 64 | 64 | 0 | 1.282 | {'allocation-changed': 36} |

All capacity, private/public counter and uniqueness audits passed. Forty-client candidate waves also passed. Separate scheduler models are independently loaded modules in one process, not actual Cloud Run instances. Emulator timings are not cloud capacity or latency guarantees. A 64-slot preview becoming stale still returns allocation-changed and requires explicit reconfirmation of waitlist allocation.

Remaining release work: capture current live familyRegistration source plus full configuration, rebase/compose only its reviewed patch, verify actual runtime/adapter semantics and multi-instance authenticated cloud behavior including browser recovery, then exact deployment/readback and rollback. The per-process limiter is not a distributed queue or global FIFO. The collector script performs two read-only gcloud operations and writes a local capture; its CLI flow is tested with a synthetic gcloud stub only, not live credentials.
