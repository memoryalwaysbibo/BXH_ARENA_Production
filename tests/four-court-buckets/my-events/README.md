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
budget. Reading up to 32 buckets for each candidate can exceed that budget;
measure actual transaction reads and latency before enabling the path. The
maintenance engine additionally uses the root-only `target(room)` decision
in `vendor/backend/engine.cjs` and `rebuild.cjs`; update those transaction
paths without introducing reads after writes. Acceptance must cover the list,
detail and repair/rebuild outputs with stale jobs, room deletion and code
reuse, using the exact deployed source fixtures. No reader or repair handler
is patched by this offline candidate yet.
