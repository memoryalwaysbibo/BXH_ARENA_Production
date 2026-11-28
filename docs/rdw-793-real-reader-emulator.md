# RDW #793 — Real Hunter Reader Emulator acceptance (manual gate)

This is a **manual, isolated** test against the **actual backend `reader.cjs` source tree**, not a simulated `createReader`. It is not registered for CI as a production-equivalent integration, because the actual backend source bundle must be independently acquired and attested first.

## Input and preparation
1. An authorized operator obtains the CURRENT deployed `syncHunterLicenseV21` function source ZIP and runtime metadata (Cloud Function name, region, project, source bucket/object/generation and revision).
2. Audit the ZIP separately with `scripts/lib/rdw-hunter-zip-audit.cjs` against an **independently measured** archive SHA-256. That only establishes the candidate ZIP is consistent with pinned Git blobs; it does NOT verify it was deployed.
3. Extract the ZIP to a trusted private test directory (not into frontend Pages assets), containing `reader.cjs`, `service.cjs`, `evaluator.cjs`, `recovery-window.cjs` and the exact vendored dependencies.
4. The harness validates the SHA-1 Git blob hashes for 12 pinned files. It refuses absent/different source files.
5. Run against an isolated **Auth and Firestore Emulator** project, never production credentials:

```bash
HUNTER_READER_SOURCE_DIR=/absolute/private/hunter-release \
npx firebase emulators:exec --only auth,firestore --project demo-rdw-real-reader \
  --config tests/e2e/firebase.json "node tests/rdw-hunter-real-reader-emulator.cjs"
```

The harness requires Firestore project ID `demo-rdw-real-reader` and an isolated UID. With no event history, it checks that the *real* Reader returns a neutral ungraded current tier via the restricted read facade. It compares selected fixture documents **and every document in the isolated `hunterLicenseAwards` collection** before/after, including on reader failure, and returns `releaseApproved:false` even on success. This collection-wide check is intended only for the small dedicated Emulator dataset, never a production collection.

**Limitations:** This is a starter smoke test, not complete career-history E2E. It does not certify source-generation matching, IAM, Rules, concurrency, guardian/child mapping, a persisted server-sealed prematch snapshot, or all possible award ledgers. Those remain release blockers. Do not merge or deploy until complete release acceptance and explicit owner confirmation.

## Manual two-player transaction acceptance

After the single-player Reader test, use a **fresh empty** demo Emulator database and an independently audited, unpacked backend source tree:

```bash
HUNTER_READER_SOURCE_DIR=/absolute/private/hunter-release \
npx firebase emulators:exec --only auth,firestore --project demo-rdw-real-reader \
  --config tests/e2e/firebase.json "node tests/rdw-hunter-real-pair-emulator.cjs"
```

This invokes the genuine source-pinned backend `createReader` on **both** new ungraded players through `createTransactionTierResolver`, then creates **one** immutable prematch baseline via `createSealer` in the same Firestore transaction. It checks no changes to fixture lifetime awards, XP or ladder records. This is **manual-only** because the backend source files are not present in the frontend repository or the CI runner.

A passing result is **not live deployment attestation** and **not approval**. It does not prove privileged IAM, actual backend wiring, per-match authorization, historical tier progression, load at 320 players or production ledger invariants. Failure must block release, not be bypassed by synthetic evidence.
