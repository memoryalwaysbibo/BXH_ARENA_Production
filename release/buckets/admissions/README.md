# Admission writer candidate — rollout remains closed

This package reviews three independently captured live entrypoints. No function,
Rules, frontend or runtime flag is deployed by this package.

| Entrypoint | Captured source set | Reviewed change |
| --- | --- | --- |
| manageEntrySelection | 12 | Check both current room roots for bucket/deletion markers before legacy state parsing or operation receipt replay. |
| lotteryRegistration | 11 | Check both roots before legacy state parsing, password-grant handling, signup/cancellation replay or writes. Preserve its existing password and onsite policies. |
| registrationInvitations | 19 | Check ownership inside invite/respond transactions; re-read sender, recipient and manager authority; bind new invitations to the current private room creation identity. |

The four ownership fields are `scoreStorage`, `scoreBucketProjection`,
`bucketMigration`, and `deletionStatus`. Presence rejects legacy mutation,
including null, false, malformed and unknown values. This is isolation for legacy
writers, not a new bucket admission implementation.

Invitation creation previously checked the room/manager outside the transaction.
The candidate pins that observed room generation, then reads the current private
and public roots, current sender/target accounts, prior invitation, registration
and mailbox counter inside its write transaction. Deletion/migration or account
changes force a retry and rejection before mail/counters are written. The original
manager scope is retained; role assignment policy is not expanded or replaced.

Each new invitation stores `sourceCreatedAt` from the trusted SDK root creation
timestamp. Respond checks this before replay, expiry, decline or acceptance.
Older invitations without that field remain usable when their trusted SDK
creation timestamp does not predate the current parent. If the private parent is
missing, was recreated after the old invitation, or the stored generation differs,
all response branches stop without child/mail/counter writes. Client-controlled
`createdAt` fields never prove room identity. Existing stale child documents are
not automatically deleted or adopted into a new room.

Read-only search/mine/sent routes remain unchanged. Expired/declined responses may
still proceed without a public mirror when the original private room exists and
neither root is marked; acceptance retains the original public-mirror requirement.
Ordinary invitation admission, quick-registration capacity, waitlist priority,
onsite admission, name projection and mailbox schemas remain pinned to the exact
captured modules; the invitation record adds only the server generation field.

`patch-manifest.json` records each exact archive SHA and before/after edits.
Fixtures are the transitive module closure from that same deployment, including
its QR transaction proxy, operations/access core and invitation admission policy.
The tests use synthetic room/account data and fixed business time. Mock tests
exercise transaction retry races and original/candidate differential behavior;
native tests use the real Admin SDK and actual QR proxy in a fixed loopback demo
Emulator. Native auth contexts are synthetic and Admin bypasses Rules: this is
not production Auth/App Check, browser, or Rules acceptance.

Before any deployment, re-read each exact live source and complete configuration.
Rebuild each function from its own current archive with only the listed module
edit, preserving all dependencies, runtime, trigger, environment, identity and
other configuration. Never deploy sibling exports from a shared module/archive.
In particular set 11 also contains an older `manageRegistrationSelection` deletion
route; this candidate must only update `lotteryRegistration`. PR707's separate
selector/deletion candidate remains necessary and must not be overwritten by
this archive. Runtime remains disabled; other writers, settlement/archival,
six-court cutover/rollback and real operator recovery acceptance remain required.

## Invitation native read strategy candidate

The20-round duplicate workload reproduced SDK code3 invalid/closed transaction
at round13 on3b5e305 (mailboxStats read9553ms); artifact13407616943 records repeated
Emulator lock timeouts. Moving the counter read later did not resolve it:
c67f33d failed again at round18 (counter read9402ms). That intermediate approach
is superseded, and no production fix is inferred from either run.

The invite path now obtains its same seven room/account/invitation/registration/
mailbox snapshots through one native tx.getAll request. It replaces seven
parallel point-read requests, including the separately issued counter read in
the unsuccessful intermediate candidate. All authorization, generation, pending
invitation and registration checks remain in the same write transaction. The
counter snapshot still participates in conflict detection, preserving concurrent
mail updates. This changes the read request strategy, not SDK retries, result
semantics or counter arithmetic.

Two fixtures require the exact seven-document batch for successful and pending
invites and verify denial performs zero writes. A third forces a concurrent
mailbox update and checks the committed unread count uses the newer value.
The earlier parallel-read candidate fails this read-strategy regression; the
new candidate passes542 fixtures and exact source patch/closure verification.
Native CI retains20 fresh concurrent duplicate rounds with one success, one
invite-pending rejection and exactly one unread increment per fixture. Native
outcome is pending; no deployment or production acceptance is claimed.
