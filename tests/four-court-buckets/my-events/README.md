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
