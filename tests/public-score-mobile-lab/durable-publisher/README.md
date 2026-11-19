# Revision 2: score-safe projection failure, real Firestore emulator

This section supersedes the historical revision-1 description below.

Implemented: score transaction now stores ONLY schema/epoch/revision marker, with no public projection or schema validation. Worker transaction reads current authoritative room and latest revision, calls original publicProjection and narrow validation, then publishes. Gaps coalesce to a checkpoint; no private snapshot in outbox. Disabled/invisible room skips enqueue and worker rejects it. Original full legacy writer remains untouched.

`dispatcher.cjs::dispatchOnce` is a bounded server polling unit: reads latest durable revision and invokes worker. After failure the cursor stays behind and next invocation retries. It is NOT yet a registered background service or timer. No cloud trigger or account permission was created.

Actual local results:
- 11/11 unit tests pass after update.
- REAL Java Firestore emulator 1.19.8 on loopback 18886 + firebase-admin 13.10.0, demo-bxh-arena-e2e, actual original scoring handler (isolated hash-pinned adapter).
- Injected worker schema failure: authorized score persists at 1, original legacy public score persists at 1, minimal marker durable, new public cursor absent. Removing failure and dispatching again recovers without re-scoring.
- Duplicate original operation and duplicate dispatch do not increment revision/score.
- Two different courts concurrently score through real Firestore transactions; both persist at 1 and room publication revision is 3. Worker emits checkpoint across the coalesced gap; older event cannot regress it.
- Disabled/invisible states: authorized score still commits, no new publication revision, worker rejects publication. No claims about browser revocation or legacy read rules: old public documents remain and still require appropriate rules/access enforcement.
- Worker never changes authoritative score.
- Emulator stopped by EXIT trap after completion. No cloud calls/deploy/push/billing changes.

Evidence: emulator-result.txt, emulator-server.txt, test-result.txt.

Exact remaining gaps: not actual onCall HTTP/Auth emulator entry this round; not a two-context browser chain with new worker; not automatic polling lifecycle/start-stop/backoff/reconciliation; not live rules visibility revocation; no outbox/delta TTL/retention. Actual handler receives synthetic request.auth in this test, not an authenticated network request. Earlier passing callable/browser tests used the OLD manual publisher, so cannot be combined into a claim of new end-to-end pass. Real emulator concurrent transactions verified, but process crash/restart recovery remains simulated unit evidence, not real killed-emulator recovery. No deployment readiness.

Prior implementation notes below are historical and may describe replaced behavior (full snapshot events / schema failure in score transaction).

---

# Isolated durable-outbox publisher prototype

Status: local implementation and 11 passing tests; NOT deployed, NOT Firestore-emulator verified in this change, NOT a replacement of the prior browser harness yet.

Files:
- publisher.cjs: dependency-injected server transaction outbox + idempotent publisher. No SDK initialization/network/trigger registrations.
- scoring-adapter.cjs: hash-pinned, isolated compiled copy of actual scoring-service.cjs, inserts enqueue in original score transaction after original authorization/transition, before writes. Original production file untouched. Existing score receipts, score state, audit and full legacy public publication retained.
- publisher.test.cjs: actual handler against deterministic AtomicStore transaction double (copy-on-write, atomic commit, read-before-write enforcement). Tests are not evidence of Firestore conflict retries, transport or durable disk survival.
- test-result.txt: Node v24.22.3 local output (no new dependencies).

Data contract:
- Only hardcoded demo project / synthetic room allowlist accepted; bxh-arena-staging is deliberately rejected at this offline stage. Creating that project does not authorize network access/deployment.
- Per-room revision increment and immutable event creation are in the same transaction as score and original receipt. Failed score transaction leaves neither change. Duplicate operation returns original handler's replay path without enqueue.
- Projection created server-side by original publicProjection and validated through strict public-schema. Does not use client payload or blindly expose private room fields.
- Worker reads immutable event, publisher cursor and current room visibility in a single transaction. It never writes tournament score or operation receipts.
- First event or gap emits checkpoint; consecutive version emits delta when shape permits. Older delivery is no-op; same-version conflicting hash rejects. Epoch changes require explicit migration, not automatic reset.
- Public checkpoint + packet + private cursor commit atomically. Lost acknowledgement retry is a no-op. Latest checkpoint is always available; still no bounded retention job.
- Unknown schema, oversized event (>800KB), corrupt hash, invisible room, invalid revision and target fail closed.

11 tests:
original scoring authorization; atomic score/outbox; score crash before commit; score lost ack; score dedupe; worker crash before commit; worker lost ack/recreation; initial/gap/out-of-order/consecutive packet; privacy/hash/missing/revocation; receiver parity; epoch rejection. Some combined in one test.

Run: node --test tests/public-score-mobile-lab/durable-publisher/publisher.test.cjs

Exact next gaps:
1. Run new adapter with REAL Firestore emulator transactions, including simultaneous different courts, transaction retry and restart. Current AtomicStore does not implement contention and is intentionally not used for concurrency claims.
2. Install a lab-only server trigger/worker dispatcher with retry/reconciliation for pending events, and connect original Callable/browser test to it instead of browser-host publish(). Current publish(revision) must still be invoked explicitly; no autonomous scheduler/trigger implementation is claimed.
3. New worker writes labRooms packet documents compatible with bridge, but does not create room metadata, legacy baseline, tester rules, or enforce public page auth. Integrate one-project Auth and room seed/eligibility outside worker; never ship current guest-readable lab rules.
4. Public-schema validation currently runs inside score transaction: unsupported projection aborts score instead of silently leaking data. Before staging pilot choose/test versioned known schema or an explicit score-safe failure/fallback policy. This prototype must NOT replace official scorer unreviewed.
5. Outbox stores full public snapshots for reliable gap checkpoint recovery, and worker rewrites checkpoint each publish. No claim of reduced backend writes/cost; retention/compaction (deltas 128 window + outbox acknowledgement/recovery policy) remains unimplemented. No event expiry until recovery is defined.
6. Visibility rechecked at publish; previously published data needs rules-based deny and lifecycle clear on revoke. Worker does not erase prior projections or change permissions.
7. This change tests normal scoring only. Undo/PASS/confirm/advancement and new writer must be retested together even though prior independent handler/lab tests passed them.
8. Refactor isolated source injection to explicit staging-only dependency/build integration only after source review. Parent preflight pins existing artifacts; these new files are additional and not yet in that manifest/remote branch.

No GCP call, cloud write, deploy, billing/IAM change, remote GitHub push, or production source change occurred.
