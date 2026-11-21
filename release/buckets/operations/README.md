# Staff, raffle and activity isolation candidate — not deployed

| Entrypoint | Captured source set | Reviewed isolation |
| --- | --- | --- |
| eventStaffService | 7 | Invite/respond/revoke read the public peer with the private room in the same transaction; pin the parent creation identity across retries. |
| drawTournamentRaffle | 5 | Reject ownership before receipt replay or parsing; validate existing raffle/control generation; stamp newly created records. |
| updateTournamentRaffleWinner | 5 | Validate room ownership, raffle/control and operation receipt generation before claim/forfeit/replace or replay. |
| trackTournamentActivity | 5 | Require the current parent to exist, remain unmarked/open and match the event snapshot's trusted creation identity. |
| trackTournamentRegistrationActivity | 5 | Also validate signup birth/current generation and exact current update time; delayed deletes require the signup still absent. |

The captured source archives and exact before/after module edits are pinned in
`patch-manifest.json`. Staff and raffle source sets are independently captured;
the four set-5 functions were independently inventoried then deduplicated by the
actual archive bytes. A shared module does not authorize a shared-codebase rollout.
Each deployed function still needs its own current metadata/configuration check.

All mutation paths reject presence of `scoreStorage`, `scoreBucketProjection`,
`bucketMigration`, or `deletionStatus` on either room root, including malformed,
null, false and unknown values. Background activity events skip such rooms instead
of recreating trackers. Staff read-only lists/search and raffle preview remain
unchanged. Missing public mirrors remain permitted for ordinary private-only
metadata operations, matching the captured implementation.

Staff invitations store `sourceCreatedAt` in the private assignment map and
external assignment record. Responses and revocations reject records from an
earlier room incarnation even when the same organizer contract is still active.
New invitations are an explicit current-owner grant and may intentionally rebind
the existing assignment ID to the current room, preserving its audit history.
This is distinct from silently accepting/revoking an old grant in a reused room.
The original partner organizer, recipient, duties, transition and public response
policies are preserved. Source metadata is not returned by `publicAssignment`.
Responses now also require a currently existing, active recipient profile inside
the same transaction, so an inactive/deleted recipient cannot accept/reject or
recreate its missing user profile through a stale invitation response.

New raffle/control/winner-operation records also store the SDK parent creation
identity. Legacy records without this field remain usable only if their trusted
SDK document creation timestamp is not older than the current parent. No client
`createdAt` field proves generation. Old receipts cannot bypass this check.
Existing prize normalization, winner eligibility, exclusion and audit behavior
are retained; raffle result records add only the generation metadata.

Activity transactions read the current private/public parents and, for signup
events, the current signup. Root writes require the same generation as the source
event; signup writes require the current SDK creation/update timestamps to match
the event. Deletes use the before-snapshot's creation timestamp and require the
current signup absent. The parent read lock makes a concurrent deletion or code
reuse retry and then skip, rather than recreate an activity record afterward.
Activity payloads remain the original monotonic `lastAt` merge.

This is fail-closed **legacy isolation**, not complete bucket feature support.
Staff assignment/revocation needs a supported bucket-aware path before enabling
bucket rooms; blocking revocation alone is not acceptable rollout completion.
Raffle consumers likewise need authoritative bucket state, especially first-round
eligibility. Bucket-aware activity/idle behavior, other writers, settlement,
archival and six-court cutover/rollback acceptance remain open.

Tests compare original/candidate behavior on synthetic ordinary rooms, use
transaction retry interference, and exercise delayed events and room reuse.
Native validation uses real Admin SDK transactions, the captured staff QR proxy,
trusted Emulator snapshots and deterministic business RNG. Auth and CloudEvents
are synthetic, and Admin bypasses Rules; this does not establish real Auth,
App Check, live Eventarc delivery, production Rules or browser acceptance.
The SDK/transport clock is real; no global time override is used.

Before deployment, re-read every exact live archive and full configuration,
preserve dependencies/environment/trigger/runtime/identity, and update only the
five named entrypoints. Do not deploy the older set-5 restore/idle-close or any
other sibling exports: those have separately fenced live implementations.
Reconcile/drain older in-flight writers before any cutover. No deployment helper,
Rules update, flag change or room activation is included in this package.
