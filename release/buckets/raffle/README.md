# Verified raffle input reader — source-only candidate

This module is not wired to a callable and does not change the integrated
candidate's rollout gate. It creates no draws, winners, mail or Firestore writes.
The authorized server caller must own one transaction and keep the `observed`
object outside that transaction's SDK retry callback. The caller injects the
captured operations core's parseState/candidates/poolHash functions; request data
cannot substitute those functions. Callable authorization remains the caller's
responsibility. This directory is not an assembled deployment archive.

Legacy rooms retain the exact captured candidate-list algorithm. Marked rooms
read private/public roots and all active buckets through the existing pinned
completion certificate reader. It checks root/bucket physical identity, manifest
epoch, topology, public vector, paired QR and the existing 5 MB read budget.
Completed rooms also require their verified completion/settlement certificate.
Wrong-root markers, migration/deletion, missing/corrupt buckets and vectors ahead
of the bucket state stop without falling back to serialized root matches.

The adapter binds both root creation identities and manifest context across
retries. A new epoch or same-code replacement rejects; a score revision advance
may retry and recompute the pool. The existing maximum of 1,000 candidates and
2,000 prior winner exclusions is retained. Only pool/candidateHash is returned;
SDK identity, epoch, full score state and certificate fields are kept out of the
public pool shape.

The fixture test uses the exact captured operations core and existing bucket
protocol. At 4/6/12 courts, deliberately stale root winners produce p1/p3 as the
legacy first-round losers while the authoritative buckets correctly produce
p2/p4. The reader uses p2/p4 and performs zero writes. Other checks cover legacy
parity, exclusions, corrupt/missing buckets, invalid completion, wrong-role
markers, migration/deletion, both root replacements, epoch changes and normal
revision advancement. All25 checks pass locally. These are synthetic transaction
fixtures, not real Auth/App Check/Eventarc or production acceptance.

```sh
node tests/four-court-buckets/raffle/input-probe.cjs
```

Before connecting preview/draw/winner operations, capture their independent
current source archives and full metadata. The preview source must be verified
separately: a module shared by another deployed entrypoint does not establish its
live bytes. Then adapt their caller-owned transactions, preserve source-generation
receipt rules and public response fields, and run native duplicate/claim/forfeit/
replacement and authenticated browser acceptance. First-round usability remains
open until those callable paths use the verified reader.
