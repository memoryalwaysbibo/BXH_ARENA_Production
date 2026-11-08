# Simultaneous registration contention candidate

Incident: BXH-W5WR86, reported 2026-11-05. Approximately 40 players submitted together. The user's result remained unconfirmed; explicit same-operation resubmission later showed one confirmed registration. The screenshots do not establish whether the first or replayed request committed.

This directory is an **offline source candidate**, not the active Functions implementation or a deployable archive. Production logs, live source/configuration and authenticated load acceptance have not been obtained. No production registrations, settings, Rules or functions were changed.

## Change

- Registration mutations now use the existing transactional user snapshot for account validation instead of making an additional user read before admission. `mine` and `history` keep their pre-transaction account checks. No registration document, public/private count, roster projection, QR check-in, or start-of-match writer changes are part of this patch.
- Preserve the captured live read-only preview; this optimization already exists in generation 1793592677411039.
- Preserve the live initial getAll and reuse of the self-registration snapshot; selected child reads and the QR adapter remain unchanged.
- The module shares a bounded admission scheduler for join/cancel/syncSummary per room in one process. Only one mutation per room enters its database work at a time. Auth, time, capacity, operation receipts and allocations are evaluated after admission.
- The original database transaction remains authoritative across processes. Same-operation receipts, family identities, capacity, public/private counts, explicit allocation checks and cancellation behavior remain unchanged.
- A waiter expires after 45 seconds before executing and pending admissions are bounded at 128. Timeout/full return `registration-admission-pending`, retaining the frontend's unconfirmed status and same-operation recovery instead of claiming a definitive failed registration. Failure/timeout cannot remove a predecessor's fence or poison later requests. No new durable queue or guaranteed global FIFO is claimed.
- Identical user/room/operation/payload requests in the same module share the pending execution; conflicting payloads are refused. No result is cached after completion: a later replay still authenticates and consults the database receipt, and the frontend reads current registrations after cancellation. Separate instances retain database idempotency and conservative pending/readback semantics.
- The business clock is refreshed after the initial transactional reads on each SDK attempt, so an admission/read wait cannot reuse an expired pre-wait deadline check.

## Evidence and limits

The current baseline is live-source-20261105.json, generation 1793592677411039, verified from the user capture. See LIVE_REBASE.md for archive/config hashes and exact differences. It includes the actual family.js error wrapper. The benchmark compares one and five independent module graphs with real Emulator/SDK and synthetic Auth/project/onCall transport. These are not deployed Cloud Run instances. Prior evidence.json, benchmark100-results.json and hardening-results.json refer to older source/candidate hashes and are historical; their old/new success rates must not be attributed to this current live baseline.

Tests assert count conservation, capacity and mirror agreement. Scarce-capacity previews may become stale: `allocation-changed` is preserved, not silently converted to waitlist. Additional checks exercise explicit waitlist acceptance, full rejection, same-operation duplicates and conflicting payloads, cancellation then historical receipt replay, inactive accounts and independent family registrations. Admission tests cover unrelated rooms, failures, overflow and a timed-out waiter between an active predecessor and a later request.

Hardening adds eight admission unit checks and six real Emulator/frontend-controller integration checks for overflow/timeout recovery, a peer committing after another scheduler timed out, shared execution across factories, cancellation after coalescing, deadline expiry after waiting and account disablement while queued. Test-only queue wait uses 25ms; the controller clock advances past its existing 3-second query throttle. They do not measure actual 45-second wall-clock behavior or a live callable adapter. Each test process now uses a fresh random room namespace to prevent cross-suite fixture collisions.

Exact-head CI artifacts results.json / results100.json describe the current rebase. LIVE_REBASE.md documents source provenance; earlier hardening/benchmark reports remain historical. Do not apply old latency numbers to the new source hash.

## Run

Use Node 22+, Java 17+, firebase-admin 14.4.0 (Firestore 9.4.0) and Firestore Emulator 1.19.8. CI installs its pinned Firebase tools independently. Run from repository root:

```
node --test release/registration-contention/admission.test.cjs
FIRESTORE_EMULATOR_HOST=127.0.0.1:8196 GCLOUD_PROJECT=demo-bxh-registration40 node release/registration-contention/check.cjs
```

The emulator must run locally on that exact port and demo project; the harness refuses different environment selectors. `CANDIDATE_ONLY=1` skips the slow baseline comparisons. CI uses the full comparison. Baseline contention failures are observations, while under-capacity candidate failures fail the run. Each baseline/candidate uses a newly seeded room. Backend previews start together and each client immediately submits the returned allocation, modeling the two-call frontend sequence.

## Release gates

Before considering this additional read optimization for release, run the roster/check-in regression suites and verify a newly confirmed self/child registration is present in the authoritative room roster and manual/QR check-in lookup. An empty or stale player list blocks release even if admission latency improves.
The candidate workflow runs the preparation roster and check-in suites on every PR update, then the Firestore Emulator scenario reads the official staff roster after the three participant registrations commit.

1. Recapture the **live** familyRegistration archive and full service configuration. Require the pinned handler/dependencies or rebase/revalidate the patch; do not deploy the old fixture as a whole Functions source tree.
2. Compose only candidate handler + admission module into that freshly captured archive, retaining current dependencies, entrypoint, QR adapter, environment variables, runtime options and My Events proof configuration. Source review and CI do not satisfy this gate.
3. Verify actual per-process module lifetime/entrypoint behavior, concurrency, CPU, max instances and timeout. The limiter reduces intra-process contention; independent instances still compete in Firestore. It is not a fleet-wide solution. If fleet-scale contention remains, use a separately reviewed durable admission architecture.
4. Run controlled authenticated 1/10/40-request cloud acceptance outside active events, including callable timing, 8-second result reads, application recovery, same-operation replays, full/waitlist behavior and cancellation races. These frontend/recovery paths are not measured by this backend-only harness.
5. Publish only the familyRegistration entrypoint with exact pre/post source/config readback and a rollback to the captured live source. No release approval or production acceptance is implied by this draft.
