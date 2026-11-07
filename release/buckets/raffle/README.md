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


## Independently verified live source provenance

The filtered report from Functions run42274492327 (2026-11-06T18:52:35Z) is
pinned in live-provenance-20261107.json with the artifact ZIP digest. Independent
GET/download/recheck for EACH of previewTournamentRaffle, drawTournamentRaffle
and updateTournamentRaffleWinner yields archive SHA256
8eafc6a293c6d23719bbce59d2b059495e9e4ca1589c358667ce662164f00f51,
matching operations sourceSet5. Thus the captured operations/core/release-controls
fixture is now supported for preview too. The verifier crosslinks archive,
per-function metadata/config hashes, exact fixture bytes and the existing patch
manifest. These are snapshot hashes, not complete deployable metadata/IAM or a
continuing live drift guarantee. No source ZIP or runtime secrets are committed.

## Transactional preview service candidate

createRafflePreview({db,core,HttpsError}) implements the callable body as an
unwired source-only service. It returns the existing ok/count/candidates/hash
shape. Actor, private/public roots and exclusion ledger are read together by
getAll in one transaction; bucket state is read in that same transaction. It
rechecks active status/manager authority on every SDK callback. Closed rooms,
stale room/ledger birth identity, schema changes and malformed exclusions reject.
The caller-owned observed context persists across retries and rejects ledger
replacement, while ordinary ledger updates recompute the pool.

A missing ledger previews the server-selected participant-v1 scheme. Existing
unversioned ledgers preview legacy keys; explicit participant-v1 ledgers use the
new tuple keys. Even excludePrevious=false cannot reinterpret malformed/mixed
ledger schemas. This service makes ZERO writes and does not initialize a ledger.
The future draw implementation MUST transactionally persist identityVersion,
room/ledger context and receipts consistently with preview before this body can
replace the deployed callable. Replacement/replay must use that saved version.
The existing deployed draw body would reject the new preview hash, so preview
must not be released alone. Existing draw/update fences remain untouched here.

20 preview fixtures cover family counts, both formats, old/new ledgers, excluded
winners, authorization/active/closure, generation/schema checks and synthetic
callback replay. Native SDK tests add both-format preview pools/exclusions and
role revocation on an explicit ABORTED retry. Auth payloads are fixtures; no
Auth/App Check endpoint or natural-contention claim is made. No callable export
or deployment archive is wired by this change.

```sh
python3 -B tests/four-court-buckets/raffle/verify-provenance.py
node tests/four-court-buckets/raffle/preview-probe.cjs
```


## Unwired draw and winner transaction services

createRaffleWriters(options) now supplies matching draw/update bodies for the
preview candidate. All three use context.cjs for authorization, ledger version
selection and physical room checks. New draw and control records persist
identityVersion plus private/public root creation identity and bucket epoch.
Winner-operation receipts carry the same context. New participant ledgers with
incomplete seals reject; unversioned legacy ledgers/records keep legacy behavior
without clearing or migrating existing winners. No caller export is wired.

Draw revalidates the preview hash and candidate limit before selection. It
preserves captured prize normalization/assignment and secure core.draw default;
tests alone inject a deterministic server-owned selector. Selection cannot expand
the pool. Identical operation IDs replay the saved result without another draw,
ledger append or audit entry; changed actor/payload/hash rejects. A writer SDK
retry may observe a ledger created by a competing duplicate, so writers bind
the saved room/version seal rather than require continued ledger absence.

Claim/forfeit are pending-only. Replacement requires forfeiture and selects
from the ORIGINAL saved candidate pool, excluding the global previous-winner
ledger and every winner already in that raffle. Prize assignment is preserved.
Receipts bind actor/raffle/action/key/reason, support no-write replay and reject
conflicts. Claim-versus-forfeit on one pending winner permits one transition.
System-closed rooms reject new work but may replay matching prior receipts;
current authorization and room context still apply. Corrupt saved pools, missing
winner-ledger keys and private/public recreation reject without further writes.

The only proposed mutation paths are raffles, raffleControl/current,
tournamentActivity and operationLog. Private/public bracket and match buckets
are unchanged. 48 writer fixture scenarios cover these semantics in both storage
formats. The native writer suite tests duplicate transaction contention and
claim/forfeit contention in legacy-storage and4/6/12-court bucket demo rooms,
plus prize-preserving replacement, exclusions and generation rejection. These
are isolated SDK transactions with fixture authentication, not live endpoints or
production acceptance. Existing native input/preview suite remains39 checks.

Remaining work is per-entrypoint callable/archive assembly, frontend identity-key
compatibility, authenticated acceptance and explicit release/rollback review.
Do not deploy helpers alone or automatically migrate old raffle generations.

```sh
node tests/four-court-buckets/raffle/writer-probe.cjs
```


## Assembled callable review archive

The offline builder accepts the pinned private source-set-05.json transfer.
Its SHA256 and all 107 member lengths and SHA256 digests must match. It replaces
the three raffle exports at the tail of the captured operations.js with the
preview/draw/update transaction services. The original index.js still exports
them through require("./operations"). The review ZIP preserves 106 members
byte for byte, changes operations.js and adds seven dependency files. Original
onCall region/CORS/invoker options and the package manifest are preserved.

```sh
python3 -B scripts/build-bucket-raffle-review.py \
  --source-transfer /private/path/source-set-05.json \
  --output /private/path/raffle-review
```

The private build yielded 114 files and ZIP SHA256
38aec32a71b5eec7c507543eed2f013c61e9d31b504b2ffe76d635b0d4be2550.
The source transfer and candidate ZIP stay in the private review workspace.
The builder reconstructs the ZIP container around verified member bytes.

The browser regression builds the exact operations overlay and dependency
closure from the pinned public fixture, loads the Firebase SDK onCall exports
with fixture Firestore and drives the shipped tournament operations UI in
Chromium. It exercises shared-UID same-name preview, a lost response after
commit and same-operation retry, forfeiture, replacement and claim, including
quote/HTML-character round trips in data-winner and name escaping. It runs with a fixture Auth context and Firestore. Runtime IAM,
App Check and the actual revision switch still need release acceptance.

## Compatible fallback archive

Build a second review ZIP from the same transfer with
`--new-identity-version legacy` and a separate output directory. Its SHA256 is
`534ca704c5800485392a8d310032f35b3fe6628efeb2205229b8c75f78f51dae`.
Only the server-selected default for rooms without a ledger differs between
the two archives. Both builds honor existing legacy and participant-v1 ledgers,
receipts and winner keys. The compatibility build uses UID deduplication for
rooms without a ledger. Rooms that need separate entries for shared accounts
should wait for the participant-v1 build before making their first draw.

Use the compatibility build as the fallback once a participant-v1 ledger
exists. The captured UID-only preview and draw compare prior winner keys
against UID keys, which would re-include winners saved with participant keys.
Treat the three callables as one release unit. Pause new draws during a
revision switch, verify all three revisions, then require a fresh preview
before the first new draw. A preview from the other identity scheme cannot
commit against a room without a ledger.

The browser test swaps to the compatibility build after committing a draw
and dropping its response. The same browser request recovers the original
receipt. Exclusion, forfeiture, replacement and claim continue with the
participant keys, and the candidate still recognizes those winners when
read back. These checks cover the assembled code and saved data, with fixture
auth and Firestore. Keep both ZIPs in private review and validate the target
runtime, authentication and revision switch before any release.
