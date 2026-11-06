# Verified raffle input reader — source-only candidate

This module is not wired to a callable and does not change the integrated
candidate's rollout gate. It creates no draws, winners, mail or Firestore writes.
The authorized server caller must own one transaction and keep the `observed`
object outside that transaction's SDK retry callback. The caller injects the
captured operations core's parseState/candidates/poolHash functions; request data
cannot substitute those functions. Callable authorization remains the caller's
responsibility. This directory is not an assembled deployment archive.

The default legacy identity mode retains the exact captured candidate-list algorithm for both storage formats. Marked rooms
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

Native SDK validation is defined in `Bucket raffle native input`. It uses Admin
SDK14.4.0 and real Firestore Emulator snapshots, guarded to demo-bxh-bucket-raffle
on 127.0.0.1:8198. The suite checks pools, corrupt sources, root creation
identities, epoch/revision changes and deterministic SDK ABORTED callback retry.
Seed/flush/replacement writes affect only that isolated demo. This does not prove
natural contention, callable authorization, Auth/App Check or live acceptance.

```sh
GCLOUD_PROJECT=demo-bxh-bucket-raffle firebase emulators:exec --only firestore \
  --project demo-bxh-bucket-raffle \
  --config tests/four-court-buckets/raffle/native.firebase.json \
  'node tests/four-court-buckets/raffle/native-input.cjs'
```


## Versioned participant identity candidate

The user selected UID plus stable playerId as the participant identity; PLAYERNAME
is display only. The source-only factory supports a server-selected option:

```js
createRaffleInput(capturedCore, {identityVersion: 'participant-v1'})
```

This opt-in applies the captured eligibility/first-round rules after projecting
in-memory account keys, so different player IDs sharing one account no longer
collapse. Keys are versioned JSON tuples [registrationUid || uid || null, id].
Names never determine uniqueness. Onsite players use null account plus stable ID.
State/source documents are not mutated. Missing/invalid player IDs and one ID
mapped to conflicting accounts reject. Duplicate listings of one identity count
once; same-name participants with different IDs remain separate. The 1,000-pool
limit still applies after participant expansion, and candidateHash covers the
returned versioned keys and labels.

Only a NEW, server-sealed raffle generation may opt into this scheme. It must
persist the identity version together with the room-generation context and reuse
that version for preview, draw, replay, replacement and prior-winner exclusions.
Client request data must not choose or switch the scheme. The observed context
binds the scheme across SDK retries. Legacy uid-only/onsite winner strings are
rejected in participant mode; do not automatically migrate, clear or reinterpret
existing draws or exclusions. Historical winners need verified playerId/room
context before any separate, explicitly reviewed migration. An excluded player
whose account mapping changed rejects instead of silently becoming eligible.

19 identity fixture checks cover shared UID/same names, exact winner exclusions,
renaming, reorder, growing sibling groups, duplicated/onsite entry lists,
first-round losers, eligibility preservation, malformed/legacy keys, account
changes, conflicting/missing IDs and both storage formats/context scheme changes.
Six corresponding native SDK checks cover shared UID/name, rename-safe exclusion
and legacy-ledger rejection in both storage formats. CI must establish their
results on the current head. Existing 25 fixture and26 native checks remain.

This is still not callable-wired or deployed. Independent live sources have now
been hashed by Functions PR321/run42274492327; the public hash-only report is not
source bytes or full metadata. Callable assembly, persisted player-ID stability,
new-generation version binding, legacy-draw handling and authenticated acceptance
remain required. The historical one/two-player discrepancy is not proven to have
this cause merely because the synthetic collision reproduces it.

```sh
node tests/four-court-buckets/raffle/identity-probe.cjs
```
