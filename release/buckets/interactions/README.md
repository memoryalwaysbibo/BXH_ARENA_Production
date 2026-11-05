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

375 local SDK-fixture checks exercise original and candidate service factories:
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

## 2026-11-05 family source reconciliation

The fixture directory label `9` now holds the factory closure from the fresh
`familyRegistration` deployment, revision `familyregistration-00041-ded`, source
generation `1793854788506302`, archive SHA-256
`db015fb8fa78db14fab41e1f5cc18d8aa9ac8e3a9bcadcf17b425171db64a55d`.
The targeted capture remained unchanged across its before/after metadata reads.
All 12 closure files match that archive, including its already deployed
`registration-admission.cjs`. Other dependency fixture bytes are unchanged.

The candidate applies the same single ownership guard to this newer factory.
It preserves per-room admission, in-flight operation coalescing, conflicting
fingerprint rejection, post-admission deadline checks, bulk transaction reads
and read-only preview transactions. Added fixture tests exercise coalescing,
same-room serialization, conflict rejection and preview ownership checks. The
VM fixture exposes native timers for the exact deployed admission module.

An offline source-review ZIP built from the supplied complete archive changes
only `family-registration.js`; its other 103 members are byte-for-byte unchanged.
The source/metadata hashes and review ZIP digest are recorded in
`../integration/live-followup-20261105.json`. That file also records the separate
16-file referee candidate match and unresolved activity trigger digest change.
This is not an authorization to deploy or activate bucket rooms; source-only
release readback and all remaining rollout gates still apply.
