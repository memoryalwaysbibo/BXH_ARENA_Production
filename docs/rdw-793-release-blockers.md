# RDW #793 — Release blocking evidence (2026-11-12)

Scope: **Hunter License 2.1 shadow-only**, no V1 ladder scoring, XP or permanent-award writes.
Integration PR: #793. Source PR: #557.

## Evidence actually available
- CI run 43150982474: the **synthetic** RDW Firestore Emulator transaction test passed in Critical E2E.
- RDW eight-tier shadow logic, ungraded neutral behavior, snapshot/identity guards and no-output-write invariants have automated tests.
- In-memory and Emulator tests use injected synthetic `createReader`, not the actual deployed `syncHunterLicenseV21` reader.
- No RDW deployment, callable registration, or production start hook is part of #793.

## 2026-11-12 source-gate hardening
- Candidate source Git blob list expanded from 5 to **12** files, covering direct Hunter reader/service/callable/evaluator/recovery dependencies and the known vendored evaluation scripts at the backend repository `main` snapshot.
- `verifyCandidate` now always returns `ok:false` after those candidate fingerprints match, with `reason:live-artifact-identity-unverified`; a caller-supplied `expectedLiveGeneration` equal to its `liveGeneration` is **not independent runtime evidence**.
- These 12 Git blobs are not the same as a checked Cloud Functions source ZIP. Do not claim full source-chain verification or grant protection merely because this static source gate passes.
- The candidate backend Reader calls into vendored evaluation logic, so the precise deployed ZIP plus immutable archive hash, internal file inventory, dependency digests, Firestore Rules/IAM and actual end-to-end behavior remain release requirements.

## Hard blockers — do not merge/enable as a production RDW feature yet
1. Obtain the **actual deployed** Hunter 2.1 `reader.cjs` and its verified dependency bundle with immutable digests and matching deployed generation. The old #557 audit documents refer to generation `1792487233621570`; revalidate against current runtime, not a historical ZIP.
2. The independent backend repository `memoryalwaysbibo/BXH_ARENA_Functions_Production` `release/hunter-license-v21/reader.cjs` (Git blob `4d21a650585f21a55a04759c8894c4021989ceb4`) was reviewed at source level: its Reader transaction uses `tx.get` with `db.doc`/`db.collection` queries; the separate `service.cjs` contains grant writes. In #793, the injected reader constructor now receives only `doc()` and `collection()` functions, and the evaluator receives only `tx.get()`. **This is a narrower API, not enforceable read-only IAM**: returned Firestore references may still offer write methods and dependencies must be audited. Verify the *deployed* generation and entire vendored source tree, then enforce least-privilege or an isolated trusted read service before production.
3. Confirm canonical Hunter identity mapping in real registration and family cases. Guardian UID is never a substitute for the child's identity; virtual players are not verified accounts.
4. Implement and verify **server-sealed** pre-event tier snapshots. The current `rdw-hunter-match-shadow.cjs` only assembles an **ephemeral candidate pair**, which must never be called a persisted verified baseline.
5. Run real-source Firebase Emulator end-to-end cases (normal, ungraded, family/guardian, absent/stale history, duplicates, concurrency and retry) and compare all affected permanent award/audit, XP and V1 ladder records before and after.
6. Check latest PR HEAD CI, code review, rules/IAM and operational rollback; get explicit owner approval before merging or deploying. Keep runtime flag OFF throughout.

## 2026-11-12 immutable baseline reference (isolated)
- Added `scripts/lib/rdw-hunter-snapshot-seal.cjs`, with `enabled:false` by default and no deployed callable registration.
- Its reference transaction checks server-side authority, canonical roster/match revision, and two trusted Hunter current-tier evidences, then `tx.create`s a deterministic pre-event RDW-only baseline.
- A repeat returns the existing baseline only when the authoritative match identity and revision agree; mismatch is blocked. Missing evidence, post-start rooms, stale revision or unauthorized actors cannot write.
- Automated tests cover the reference contract; **this is not yet a validated production Firestore schema, server-authorized snapshot writer, or live Hunter Reader integration.** It must remain disabled until authoritative backend/Rules, idempotency and Emulator transaction tests are completed.
- The reference does not modify V1 ladder, XP, permanent Hunter awards or the real event start action.

## 2026-11-12 same-transaction Hunter tier-pair adapter
- Added `scripts/lib/rdw-hunter-transaction-tier-pair.cjs` with two-player current-tier evaluation inside **the caller-owned transaction**. It uses a restricted `tx.get` interface and checks both accounts, verified history/digests, and ungraded current tier. No lifetime highest-tier source is substituted.
- Added a direct integration test with the disabled-by-default immutable prematch sealer. The test asserts a single snapshot write, neutral ungraded handling, invalid UID/account rejection, and repeat idempotency.
- This **does not yet import the independently attested deployed Reader**, implement production tournament authorization, provision Rules/IAM, or register any callable. It is a reference dependency seam, not a releaseable server feature.
- Real-reader performance and Firestore transaction limits for event sizes 8/32/128/320, along with source generation provenance and permanent ledger integrity, remain open acceptance gates.

## 2026-11-12 combined Firestore Emulator integration
- Added `tests/rdw-hunter-pair-snapshot-emulator.cjs` and a dedicated Critical E2E step.
- It exercises `createTransactionTierResolver` + `createSealer` within the **same actual Firestore Emulator transaction**, including two simultaneous requests for one deterministic baseline.
- It checks neutral `ungraded` handling, that incomplete history or disabled player accounts do not produce an additional baseline, and that fixture lifetime awards, XP and ladder documents remain unchanged.
- The Reader remains **synthetic** in this automated test; the actual deployed Hunter Reader ZIP, production IAM/Rules and server authentication are not validated by this test. Do not interpret Emulator success as release approval.

## 2026-11-12 Reader reference capability isolation
- A new `rdw-firestore-reader-capabilities.cjs` layer issues **opaque frozen document/query handles**. It maintains the real Firestore reference privately in a WeakMap, exposing only document `path`, query `where/select/limit`, and a transaction `get` that rejects handles not issued by this layer.
- Both Hunter read-only bridge and same-transaction tier-pair adapter now use this layer; the Reader is no longer handed native write-capable DocumentReference or Query objects by these adapters.
- Unit tests cover fake-reference rejection, lack of document write methods, query shape and native-reference unwrapping. Emulator and real-source acceptance must still confirm compatibility.
- This is **not** a security sandbox for arbitrary third-party code. A malicious Reader may import its own Admin SDK or use a service identity's permissions. Independently verified source and restrictive IAM, plus emulator/runtime tests, remain mandatory before release.

## Release decision
**BLOCKED.** Passing synthetic tests is necessary but insufficient. Do not copy old #557 start-service or partner quota components into #793 merely to unblock this gate; those are separate behavior changes.
