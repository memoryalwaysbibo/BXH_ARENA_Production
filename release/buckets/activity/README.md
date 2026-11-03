# Completed-tournament activity awards — candidate, rollout closed

The captured `activityTournamentCompleted` consumes a delivered tournament
snapshot and awards wallets without reading the current tournament in its award
transactions. Synthetic-boundary reproductions show an old event still awarding
10 points after its parent was deleted or replaced, or after its recipient was
revoked between the eligibility read and the award. These are source-based
reproductions, not evidence that those incidents occurred in production.

This overlay changes only tournament-derived calls to the existing grant helper.
It keeps the legacy ruleset cutoff, amounts, daily caps, participant/guardian
mapping, host awards and permanent ledger IDs. Daily check-in, online-time,
inactivity and other exported handlers retain their original bodies. Their
separate live sources are not authorized deployment targets of this package.

## Transaction boundary

1. Read the current private/public roots in one transaction. A delivered event
   must match the current private root's SDK `createTime`, including nanoseconds.
   A deliberately current-room scan uses a fresh capture instead of stale scan
   JSON. Missing source identity fails closed.
2. Migration/deletion fields fence by presence, including `null` and `false`.
   Misplaced/malformed bucket markers are rejected. An ordinary unmarked room
   can retain its legacy missing-public-mirror behavior; the presence and birth
   of its mirror are then bound for the invocation.
3. A marked room loads all active score buckets and validates the PR715
   completion certificate (or PR713 ranked certificate) against the private root,
   public receipt/vector, current bucket revisions, parent birth and canonical
   state digest. Legacy room JSON by itself cannot authorize bucket awards.
4. Each per-user wallet/ledger/daily transaction rereads that complete source and
   the recipient's current active, nondeleted, nontest profile before writing.
   A changed parent/public generation, completion data, epoch, mode or fence
   stops that award. Transaction conflicts retry against the current data.
5. Transient database errors escape the retry-enabled trigger. A committed award
   whose response is lost is found by the same permanent ledger on redelivery;
   remaining eligible recipients can resume without double credit.

The certificate/protocol are exact copies pinned from PR715 commit
`c461dd031d65648524089ab6366e697ad0f296b0` and bucket-state blob
`da457b44c6694293470efa3ce71699ada100b8b1`. This is a dependency on that reviewed
settlement contract, not a claim that either PR is deployed.

## Evidence and limits

- Captured archive SHA-256:
  `6d694db6b355627c2fc1ee622e27884a83be11df0e2d4525699cd34c16fe4a48`.
  Exact metadata, selected dependency hashes and single-occurrence edits are
  recorded in `patch-manifest.json` and checked independently in CI.
- 59 local checks cover baseline equivalence for old/new rulesets, the baseline
  bugs, marker presence, SDK generation changes, account races, general/ranked
  bucket certificates, canonical score loading, idempotence and concurrency.
- 12 bridge checks run the actual pinned PR713/PR715 settlement handlers for
  4/6/12 courts with/without QR, then feed their generated certificates to the
  activity handler. These use synthetic Firestore/auth boundaries.
- 51 native Firestore SDK checks passed at code commit
  `e2eaef3e361d8c9715a430b7b86968c053973919`, workflow run
  [41606427056](https://github.com/memoryalwaysbibo/BXH_ARENA_Production/actions/runs/41606427056).
  They use only the loopback
  `demo-bxh-bucket-activity` project, injected business clock and synthetic events
  and accounts. It is not real Auth/Eventarc or production timing acceptance.
- Awards remain separate per-user transactions, as in the captured implementation.
  A cancellation between recipients can leave earlier committed awards intact;
  later recipients are fenced. This is not whole-tournament atomicity or an
  automatic permanent-ledger reversal system.
- Pre-patch code-keyed receipts are preserved without inventing a source birth.
  Candidate receipts record source birth/epoch/digest; a receipt from another
  incarnation is flagged internally for review and never grants again. Code
  reuse does not automatically earn another award under the existing ledger ID.
- All buckets are read again per award. Production latency/read-cost, invocation
  timeout and high-participant retry completion require controlled acceptance;
  passing Emulator checks cannot establish production throughput.

## Release boundary

Draft source-only overlay. Future target is **activityTournamentCompleted only**,
using its freshly recaptured archive/configuration, replacing `activity-points.js`
and adding `activity-tournament-guard.cjs`, `certificate.cjs` and
`protocol/state.cjs` at the indicated relative paths. This review directory is
not a deployable archive: do not deploy old siblings from the captured package.
In particular, the independent scheduled activity backfill has not had its own
exact live archive verified or deployed by this work.

No merge, upload, deployment, runtime flag, room activation or production data
write is performed. Broader writer classification, derived consumers, complete
candidate integration and six-court cutover/rollback acceptance remain open.

## Independent scheduled backfill source

`scripts/bucketcaptureactivitybackfill.py prepare` captures only the independently
deployed `activityCompletedTournamentBackfill` archive from its pinned regional
inventory pointer. It reuses the already verified maintenance helper, requires
project `bxh-arena` and closed rollout gates, filters secrets and dependencies
from the exported code bundle, checks source metadata before and after capture,
and exports no room documents. Three offline tests exercise successful filtered
capture, metadata drift rejection and path traversal rejection. This is a
read-only evidence request; it does not deploy the activity patch. If metadata
has changed, stop and reconcile the new pointer instead of relaxing verification.
