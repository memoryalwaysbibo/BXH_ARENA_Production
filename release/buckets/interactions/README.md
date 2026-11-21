# Captured legacy interaction writer fences (candidate only)

The 2026-11-03 regional inventory found 158 ACTIVE functions. The next read-only
capture pinned 32 priority entrypoints to 26 exact deployed source archives.
This package adds early transaction ownership checks to six of those entrypoints:

| Function | Reviewed module | Write path covered |
| --- | --- | --- |
| familyRegistration | family-registration.js | registrations, counters and quick-room roster projection |
| teamRegistration | team-registration-service.js | team registrations and room/public counters |
| teamScoring | team-scoring-service.js | team match ledger, public live games, final root/mirror progression |
| teamLineup | team-lineup-service.js | secret lineup child documents |
| courtCallService | court-call-service.js | call/recall records and PASS dispatch root/mirror changes |
| enchantmentService | enchantment-service.js | enchantment ledger (including auto-reveal on get), scores and progression |

The four protected keys are scoreStorage, scoreBucketProjection, bucketMigration
and deletionStatus. Presence rejects a legacy request even when the value is
null, false, malformed or an unknown phase. Checks run under the same transaction
read lock, before parsing serialized state or accepting an old receipt. Marked
rooms are deliberately refused; this does not add bucket support for team or
enchantment scoring. Existing unmarked paths remain unchanged.

Team lineup now also reads the public root in that transaction (one additional
read) so a public-only marker cannot bypass the fence. Other modules reuse root
snapshots already read. There are no new runtime dependencies or engine edits.
Patch recipes pin both original archive and edited module hashes. Each function
must be rebuilt from its own current deployed archive, preserving every other
file, runtime setting, service account, trigger, environment and dependency.
Never deploy another entrypoint's copy of the shared default codebase.

## Validation

```sh
python3 -B tests/four-court-buckets/interactions/verify-package.py
node tests/four-court-buckets/interactions/probe.cjs
```

363 local SDK-fixture checks exercise original and candidate service factories:
normal successful writes (including a completed team match/root update), inactive
actor denials, exact unmarked replay behavior, markers on both roots, malformed
serialized state, transaction retry after a marker appears, receipt replay after
ownership changes, and enchantment auto-reveal writes from a get action. The
pure dependencies are copied byte-for-byte from each captured archive and pinned
separately; no production room data, environment file or credential is included.
The fixture substitutes Firestore and deterministic clock/randomness. It is not
real SDK/Emulator, App Check, production operator or full UI acceptance.

## Deployment gate

Nothing in this directory deploys or enables a room. Before any source update,
re-read the exact live source archive and configuration and stop on drift.
A future deployment helper must enforce named-function-only source changes and
verify source/configuration readback. Do not infer deployment from these tests.
The full 32-function assessment and remaining blockers are in
[../writer-review-20261103.md](../writer-review-20261103.md).
