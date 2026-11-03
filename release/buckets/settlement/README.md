# Canonical ranked settlement candidate — no deployment

This candidate adds a real bucket-aware ranked settlement path to independently
captured `ladderAutoSettlement` (source set 10) and `settleLadderTournament` (set 21).
Ordinary unmarked rooms retain their original algorithms and writes. This package
does not replace unrelated exports or deploy a new callable.

## Authority and atomic finalization

Both paths read the private/public room roots, runtime configuration and **every
active bucket** inside the award transaction. The adapter uses the exact bucket
state/runtime protocol from staging commit
`b82e8d393ab14c6146575ebf28ccedb0c02b3ed9`. Its public projection function is extracted
verbatim from that commit's scoring core; source, Git blob and fixture hashes are
verified by the package check. Each function keeps its own original dependencies.

The root still owns bracket structure and retired court history; active buckets
own their current score payloads. The adapter checks physical parent/bucket
creation identity, epoch, complete version vector, structural fields, bracket
topology and completed result coherence. Champion/runner-up and optional bronze
places come from authoritative final matches, not stale root placement fields.
Missing/corrupt buckets, unknown marker values, projection vectors from another
epoch or ahead of the buckets, and changed room generations stop settlement.
A public vector may lag: finalization repairs its scores and vector atomically.

The transaction awards eligible players, creates permanent event ledgers, writes
the complete canonical private archive, updates the public view and writes a
private settlement certificate for the exact generation/epoch/vector/state
digest. It never rewrites score buckets. Existing source/ledger conflicts without
a matching completed certificate require review; there is no automatic adoption,
ledger deletion, points reset or duplicate credit. Manual and automatic services
contend on the same room and event ledger IDs. A valid completed replay is read-only.
Closing the root also makes competing scorer transactions retry against its
completed/archive state.

The existing QR proxy remains in place. The adapter applies that deployment's
exact QR `advance` function before sealing the state digest. The proxy applies
the same original revision again, producing the same revision and attendance;
both private and public attendance remain paired. The certificate therefore
remains valid after a QR-managed archive and on replay.

## Eligibility and limits

The two captured linear V1 algorithms are preserved and compared over 2–512
effective participants. Bucket participants are linked by stable account UID;
manual bucket settlement does not guess an account by matching a name. Family,
test, ineligible and guest records do not receive account credits. Current active
profiles and confirmed online registrations are re-read inside the award
transaction. Bucket manual requests recheck the current admin role. Duplicate,
unsupported UID identities, closed/rolled-over seasons, account season mismatch
and old permanent ledger collisions stop before any credit commits.

The supported path remains official individual standard single elimination with
optional BZ bronze match, at most 32 courts, matching ranked metadata on both root
and state, and at most 240 eligible account awards in one transaction. Trial and
explicit non-career seasons preserve career totals/highest permanent rank. Input
state is bounded to 5 MB; each resulting room document has a conservative 750 KB
budget. SDK transaction failure or a late projection/size validation error rolls
back **all** queued player, ledger and room writes.

The automatic entry retains its captured six-character room-code validation;
manual retains its original 5–12-character validation. Controlled rollout must
use their shared supported code shape. This does not add general-event, team,
double-elimination or round-robin bucket settlement, nor resolve hosting/history
rebuild, bucket-aware staff/raffle consumers or remaining Admin writer coverage.
Those remain rollout blockers rather than being hidden behind a success flag.

## Gates, tests and release

Bucket settlement additionally requires `systemConfig/fourCourtScoreBuckets`
`settlementEnabled === true`. Production also requires the existing runtime env
gate, matching project, release/production flags and exact room/epoch allowlist.
No gate is changed by this package. Emulator mode can only be selected by server
factory options and the existing fixed demo project/loopback host; request data
cannot select it. Permanent bucket validation failures are returned/skipped by
the automatic trigger instead of causing a seven-day poison retry loop. Transient
SDK errors retain their existing retry behavior.

Tests use synthetic state/auth and injected business clocks, with real SDK/gRPC
time. Mock tests cover the exact original/candidate legacy behavior, canonical
scores, QR, replays, interleavings, career rules and arithmetic parity. Native
Emulator tests exercise real transactions/QR transforms, late aborts, manual/auto
contention and six-court 160-player awards, plus the over-limit guard. They do not
prove real Auth/App Check, Eventarc delivery, browser or production Rules behavior.

Before any deployment, reconcile both exact live archives and complete metadata.
Apply only their reviewed module edits and the shared `bucket-settlement` folder;
preserve the original QR files and every dependency/configuration byte. Verify the
QR helper hashes against this package before predicting its transform. Deploy
only the two named entrypoints, preserve runtime/trigger/identity/configuration,
and read back both source and settings. Leave settlement/runtime gates closed
until all other writers, ordinary/general completion, hosting, permissions,
capacity, multi-referee cutover and rollback/recovery acceptance is complete.
