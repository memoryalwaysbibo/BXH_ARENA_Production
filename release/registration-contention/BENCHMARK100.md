# 100 simultaneous registration comparison

Local Firestore Emulator 1.19.8; firebase-admin 14.4.0 / Firestore 9.4.0; Node 24.22.1. Synthetic identities, no production requests. Original is captured source generation 1793041271889373. Candidate source is unchanged from PR #730; hashes are in benchmark100-results.json.

100 unique active users begin preview together, then immediately join with its returned allocation. Two repetitions per scenario/mode, reversing mode order on repetition 2. Each wave uses a new room. No manual resubmission or frontend 8-second queries. Independent schedulers are separate module graphs in one process, not deployed Cloud Run instances. Timings include preview and join through final response or rejection. These results do not predict production success rates or latency.

| Capacity | Waitlist | Repeat | Mode | Schedulers | Successful | Confirmed | Waiting | p95 s | Max s | Retries | Failures |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 128 | 0 | 1 | original | 1 | 1 | 1 | 0 | 32.377 | 33.451 | 400 | 99 10 ABORTED: Transaction lock timeout. |
| 128 | 0 | 1 | candidate | 1 | 100 | 100 | 0 | 2.066 | 2.159 | 0 | none |
| 128 | 0 | 1 | candidate | 4 | 100 | 100 | 0 | 9.973 | 10.054 | 6 | none |
| 128 | 0 | 2 | candidate | 4 | 100 | 100 | 0 | 9.442 | 9.516 | 6 | none |
| 128 | 0 | 2 | candidate | 1 | 100 | 100 | 0 | 1.483 | 1.562 | 0 | none |
| 128 | 0 | 2 | original | 1 | 15 | 15 | 0 | 24.821 | 24.95 | 373 | 84 10 ABORTED: Transaction lock timeout.; 1 3 INVALID_ARGUMENT: Transaction is invalid or closed. |
| 64 | 36 | 1 | original | 1 | 13 | 13 | 0 | 22.904 | 23.039 | 380 | 87 10 ABORTED: Transaction lock timeout. |
| 64 | 36 | 1 | candidate | 1 | 64 | 64 | 0 | 1.349 | 1.401 | 0 | 36 allocation-changed |
| 64 | 36 | 1 | candidate | 4 | 64 | 64 | 0 | 7.304 | 7.357 | 5 | 36 allocation-changed |
| 64 | 36 | 2 | candidate | 4 | 64 | 64 | 0 | 6.908 | 6.968 | 7 | 36 allocation-changed |
| 64 | 36 | 2 | candidate | 1 | 64 | 64 | 0 | 1.376 | 1.425 | 0 | 36 allocation-changed |
| 64 | 36 | 2 | original | 1 | 4 | 4 | 0 | 20.758 | 21.918 | 392 | 96 10 ABORTED: Transaction lock timeout. |

All 12 data audits passed: private/public counters equal active registration rows, active rows equal successful responses, capacity is not exceeded. No duplicate rows appeared.

Capacity 128: candidate succeeds 100/100 in all four waves. Original succeeds 1/100 and 15/100; its other responses comprise 183 lock timeouts and one invalid/closed transaction. These are Emulator observations, not a live incident failure rate.

Capacity 64 plus waitlist 36: candidate records 64 confirmed and zero waitlist rows in all four waves. The remaining 36 receive allocation-changed because their preview offered confirmed slots; the existing contract refuses a silent downgrade. They must preview again and accept current waitlist allocation. These one-pass waves do not include that resubmission. Original records 13 and 4 confirmed; other requests end in transaction lock timeout.

No candidate wave hit the 128-pending bound or 45-second queue timeout. The known same-operation timeout/replay ambiguity, fleet-wide fairness, live source/config readback and authenticated cloud/browser acceptance remain unresolved. No deployment occurred.

Run release/registration-contention/run100.cjs with FIRESTORE_EMULATOR_HOST=127.0.0.1:8196 and GCLOUD_PROJECT=demo-bxh-registration40 while that local emulator is running. The runner checkpoints results100.json after each wave and fails on data-consistency assertions. Business rejections and SDK failures are measured outcomes. The existing CI covers forty-client tests; this hundred-client report is a local benchmark.
