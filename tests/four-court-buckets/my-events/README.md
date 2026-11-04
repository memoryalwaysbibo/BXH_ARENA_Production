# My Events lifecycle split-state reproduction

The exact captured deployed normalizer from the 2026-11-04 priority writer
source archive is `deployed-lifecycle.cjs` (SHA-256
`e04fd69c5c3e1a4df8673722693620fed6e3e5cfb3e500db43badc2b6c28c65f`).
The capture contains eight entrypoints in six source sets and made no
production writes. This fixture copies only the backend lifecycle module;
the reader and detail copies have the same file hash.

`node tests/four-court-buckets/my-events/probe.cjs` replays the six-court
settlement lab against that normalizer. Before settlement, the private root
still has the split-score base state and `tournamentPhase: live`, while its
serialized matches are marked complete. My Events returns
`invalid/contradictory-private-phase`. After candidate settlement materializes
the canonical state, it returns `supported/done`. Bucket documents can change
without changing this pure normalizer's result because it reads no buckets.

This is a demonstrated synthetic classification gap, not evidence of a live
customer incident. The repair engine, per-user list and detail reader all
call this lifecycle normalizer or their byte-identical copy. An operational
adapter must read the current private root, public projection and bucket
versions in one consistent view, verify epoch/incarnation and migration
markers, and derive the phase from authoritative bucket matches. Validate
waiting/live/settling/done and 4/6/12-court changes, stale jobs, retries,
room deletion and code reuse in the read and repair paths before a live cutover.
No source deployment or runtime activation follows from this reproduction.

The offline candidate `release/buckets/my-events/lifecycle.cjs` uses the
existing bucket completion loader and certificate checks inside the caller's
single read-only transaction. It materializes the authoritative matches,
permits `live` root phase while completed buckets await settlement, and
requires both private and public completion certificates for `done`.
`node tests/four-court-buckets/my-events/candidate-probe.cjs` covers 4/6/12
courts, settlement, partial ownership and missing/corrupt buckets. It is not
wired into the deployed My Events reader, detail reader or repair engine.
Those integrations and their latency, retry and user-facing tests remain open.

## Exact reader integration points

The captured deployed `vendor/reader/auth-reader.cjs` runs a read-only
transaction and currently calls `normalizeRoom(room.data())` after checking
the membership incarnation. The detail reader does the same after checking
room create/update/read times. A bucket-aware adapter must run *inside those
same transactions*, using the already-read root, and must preserve the
existing account, bootstrap, membership, pagination and stale-room checks.
Legacy rooms still use the deployed normalizer. An invalid split-state proof
must produce an unresolved result, never a ready card or an inactive room.

The list path can examine 16 candidates per page and has a 5-second request
budget. The bucket protocol caps a room at 32 courts, with one bucket per four
courts: at most eight buckets per room. The adapter also reads the public
projection, yielding at most 160 room/public/bucket documents for 16 fully
bucketed rooms, plus existing account, membership and control reads. Measure
actual transaction latency and total reads before enabling the path. The
maintenance engine additionally uses the root-only `target(room)` decision
in `vendor/backend/engine.cjs` and `rebuild.cjs`; update those transaction
paths without introducing reads after writes. Acceptance must cover the list,
detail and repair/rebuild outputs with stale jobs, room deletion and code
reuse, using the exact deployed source fixtures. The library now exposes `readRoomLifecycle({db,tx,room,code,normalizeRoom})`
for the existing read-only transaction. It reuses the caller's root snapshot,
reads the public projection to detect public-only partial migration,
then uses the original normalizer for unmarked legacy rooms and verifies the
private/public/bucket context for marked rooms. Offline tests cover the seam,
including incomplete ownership and wrong room path. This is an integration
interface only: no deployed reader, detail or repair handler calls it yet.

## Pinned list and detail source patch

`release/buckets/my-events/patch-readers.cjs` accepts only the exact captured
list reader (`647956d1477f3916981259a188928e962c2f04ab3779c383aa47205efecf7201`)
and detail reader (`4a50f20ec750089f312fc4e7f7f453eb4654e7044f8f71ecfa1bd27d5107876c`)
source hashes. It changes their factory to require a transaction lifecycle
resolver and replaces only the root-only `normalizeRoom(room.data())` call with
an awaited resolver in the existing read-only transaction. The exact deployed
reader fixtures and a synthetic account/rollout/membership path prove that the
list calls the resolver after authorization, while detail treats an ended room
as inactive. An additional same-transaction test uses the real bucket
certificate adapter: the authenticated list returns a six-court `settling`
card, the detail reader sees the same phase, and a missing bucket yields an
unresolved notice without a card. Drift or a missing resolver fails closed. These are source patch
and offline tests; no production reader function or repair writer was updated.

## Repair target reproduction

`deployed-engine.cjs` is the exact captured engine source (SHA-256
`3b5f36dc1e0419284c9301a50f3f0eedba67c5f9d5b31921b473e306557afe86`).
The synthetic six-court `done` root lacks a sealed bucket completion receipt.
Its synchronous `target(room)` returns `inactive`, while the transaction
bucket verifier returns `invalid/bucket-lifecycle-unverified`. This proves a
repair classification gap in the captured source, not an observed live room.
The engine calls `target(room)` in registration ingest, room intent and page
processing; rebuild and bootstrap also use root-only target/discovery checks.
All of these must be reconciled, with reads before writes and stale leases
preserved, before bucket rooms can use My Events repair.

`release/buckets/my-events/patch-repair-engine.cjs` pins that exact engine
source and replaces the three engine call sites with an awaited resolver inside
their existing transactions. Five offline checks cover the active six-court
target, missing-bucket refusal, legacy behavior, registration ingest and a
bucket changed between page claim and execution. The patch is a candidate;
the deployed engine and its bootstrap/rebuild companions have not been changed.
The service still needs a verified resolver wired into each factory and an
authenticated list/detail/rebuild acceptance before deployment.

The 2026-11-04 source archive also pins the deployed bootstrap module
(`8ff7a99e0b571aa56052f1774029c693c0001622115b674f8bc5fc6daf8b71d2`)
and rebuild module (`abf972f4c72278b82823a750a09c18b41689ff8eb26127bce7d19992f57bb1ef`).
`bootstrap-target.test.cjs` demonstrates the exact bootstrap discovery scope
returns `unresolved` for a valid active six-court split room, while the
transactional bucket resolver returns `supported/settling`. Bootstrap also
classifies discovered room pages outside the room's transaction; that path
needs a bounded consistent read with a source-version check before enqueueing.
Rebuild imports the root-only target in dual-write reconciliation, listing,
advance and publish. This baseline reproduction is an explicit release gate,
not a deployed bootstrap or rebuild fix.

`release/buckets/my-events/patch-rebuild.cjs` pins the exact deployed rebuild
source and replaces its root-only target calls with the transaction-owned
bucket lifecycle resolver. The engine patch passes that resolver to dual-write
reconciliation. Local tests reject source drift, verify resolver use on the
stale-generation path, and require it for an enabled rebuilder.

`release/buckets/my-events/patch-bootstrap.cjs` pins the captured deployed
bootstrap source. It resolves room and buckets within one read-only transaction
for discovery/capture, checks the source timestamp and target when enqueueing,
and revalidates a room page before advancing its cursor. A changed room releases
the lease for a retry. The candidate uses one room per page and a 60-second
lease, bounding the number of buckets rechecked in one transaction. Local
tests cover a six-court room, a missing bucket that blocks discovery, a changed
page, full-page cursor continuation and the Eventarc predicate that schedules
the next page after each checkpoint.
Real backend latency and progression under Eventarc still need acceptance; no
bootstrap or rebuild source has been deployed.

The captured deployed service (`2588227c6dc3fa0fe8a80a0898eb7fdec6b2a52251d6c3ad139c8988cfb2dc89`)
constructs all four factories without a resolver. The pinned source patch in
`release/buckets/my-events/patch-service.cjs` forwards one resolver to the
engine, rebuilder, bootstrap and authenticated list reader. Enabled deployment
must package `bucket-lifecycle.cjs` with its verified completion dependency;
the current source patch is not a deployable bundle or live acceptance.

The captured `assembly.cjs` separately constructs the authenticated list and
detail readers. The pinned assembly patch forwards the same resolver to both.
The operator-only `bootstrap-start.cjs` also constructs engine, rebuild and
bootstrap directly; its pinned patch forwards the resolver and retains the
named-run, explicit execute and source-seal gates. An offline composition of
the captured source set and candidate overlays constructed all 14 exports with
zero cloud calls. The package is missing a reviewed candidate source seal and
live App Check/Firestore/Eventarc/latency acceptance.

The fixed-generation deployed archive for `myEventsMaintenanceRepair` has
SHA-256 `18969f340bd0d654076395935f9b0e6a8f50ec9a1569b09006e2d62cdbcc700f`.
Its separately captured lockfile has SHA-256
`069ecab6c23a838571c8bd073aea34a8abd9f2c5607fcd92cc482c4911c228d7`;
all 25 selected source hashes match the archived baseline seal. The baseline
seal explicitly has `approved:false`. A local review composition added the
lockfile, applied the eight pinned overlays and added three bucket verifier
dependencies. All 29 candidate files passed the source-set verifier with an
approval flag supplied only in memory; the review ZIP retains `approved:false`.
This confirms file completeness and hash consistency, not dependency install,
native Emulator behavior, runtime configuration or release approval.
