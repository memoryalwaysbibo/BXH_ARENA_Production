# Six-court contention lab

This diagnostic executes the original `mutateMatchTransaction` method using Firebase JS SDK 10.13.0 and a real local Firestore Emulator. It does not use a handwritten transaction model. No application runtime files are modified.

The baseline is pinned to `c125c750aed6e1e44d2347310ac06d02322242e3`, the pre-#673 base. It is a candidate historical baseline, **not a verified incident deployment**. The script checks Git blob hashes and records the methods' source hashes.

Cases: one court, six sequential courts, six naturally concurrent courts, six concurrent courts with a barrier after the first room read, and six separate-room control documents. Each case runs three times with fresh synthetic fixtures. The barrier deliberately creates overlapping read versions; it is not a claim about field timing. Default SDK transaction retry behavior is preserved. Failed writes are observed and classified rather than required for a passing test. A result in which six operations succeed is valid evidence.

We check every acknowledged operation persists exactly once, failed operations leave no score, all original unrelated matches remain intact, and private/public snapshots agree. Attempts and elapsed times are recorded per operation. Elapsed time is **Emulator-only**, not a production latency benchmark. Attempts beyond the first indicate SDK callback reruns; they are not raw backend ABORTED counts.

The mutation callback adds one synthetic spin point. The original UI queue, round-event generator, propagation engine, public projection, onsite/court fences, official Rules, three-seat handler, and confirmation/advancement flow are not certified here. These helpers are explicitly stubbed to isolate the common-document transaction mechanism. In the baseline core, `addScore` calls `persistRefereeMatchMutation`, which ultimately calls `mutateMatchTransaction`; `confirmResultWithCloudGuard` separately calls `confirmMatchTransaction`. Caller source excerpts are checked and fingerprinted, but the complete UI flow is not executed.

Safety: exact `demo-bxh-scoring-contention` project and `127.0.0.1:8187` emulator required before clients are created. Every client explicitly connects to the Emulator. Synthetic identities and lab-only document IDs are used. Minimal lab Rules are deliberately not production Rules and must never be deployed. No Cloud SDK credentials, secrets, OIDC, deployment or production access is used.

The original method executes in a Node VM. Its JSON-only write values and options are copied into the host realm before native SDK validation, avoiding a cross-realm Object prototype error. This preserves the lab payload values and document paths. The initial failed CI run hit this harness issue in the single-court control; it is not evidence of an application or contention failure.

CI installs dependencies in `/tmp`, runs with read-only repository permissions, and uploads `results.json` plus logs even on failure. `PASS` means the diagnostic completed and persisted-score assertions passed; it does **not** mean the incident is explained, the current architecture meets 12-court requirements, or the issue is fixed.

Follow-up: verify incident deployment and error logs, exercise actual UI/default helpers and full Rules, then test confirmation/advancement and isolated cloud-network behavior. Only after this baseline should a per-match storage candidate be compared under the same workload.

## Phase 2: front-end queue gates and confirmation

`queue.test.cjs` executes the original front-end queue and confirmation functions with controlled cloud-boundary responses. Seven diagnostic cases show healthy completion, historical whole-state failure blocking repeated confirmation before any request, successful match transaction not clearing that gate, fresh read not clearing it, a pending retry blocking score submissions, a new successful whole-state write recovering the gate, and a pending promise holding score submission until released. Injected failed/pending writes are test preconditions, not incident observations. These tests characterize old behavior and are not a runtime fix.

The queue and confirmation functions were also compared with current core blob `4b5023d21035cf9b5f12e0e7cdd619dcf9c38397` and are byte-identical. The ledger validator has an additional administrative-backfill exclusion; the canonical non-backfill fixtures do not trigger it. Device-level state and the incident's prior write failure are still unverified.

The `BXH_LAB_PHASE=confirmation` run exercises original `confirmMatchTransaction` with valid round ledgers, the pinned generated engine's real single-elimination validation/completion/propagation, and referee activity writes. A synthetic 16-player bracket has six ready 4:0 matches and two undecided first-round matches. It checks completed results, identity, analyzable ledgers and the next-round winner slots. It runs the same five timing/control scenarios three times. Public projection and onsite/lifecycle fences remain stubbed, lab Rules remain minimal, and this does not execute the complete browser UI, official Rules, production network or other tournament formats. Results are written separately to `results-confirmation.json`.
