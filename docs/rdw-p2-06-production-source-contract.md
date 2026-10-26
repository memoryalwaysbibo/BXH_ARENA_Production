# RDW P2-6 — Production Match Source Contract (draft)

Status: **research-only / no production writes**. PR #557 must not be merged or deployed solely because CI passes.

## Trusted entrypoint requirements

1. Identify the actual production match-start handler and its deployed Firebase codebase. **Not identified yet.** Do not register a new callable until its ownership and authorization rules are audited.
2. Server must authenticate the caller, verify organizer/referee authorization for the event, and derive player UIDs from canonical registrations (never client-supplied names, tiers, or snapshots).
3. Resolve one immutable canonical match key: `eventId + matchId + revision`; distinguish cancelled/replayed rounds. Reject duplicate player UIDs and non-official/test events.
4. In a Firestore transaction, read match state and both server-authoritative **current** Hunter License tiers. A lifetime highest-tier award must never substitute for the current tier.
5. Capture both perspectives with a single server timestamp strictly before the official match-start timestamp. If the production event has no provable pre-start boundary, block sealing instead of synthesizing a timestamp.
6. Create once; retries with identical content are idempotent. A correction/revision or changed tier must not overwrite a sealed snapshot. Escalate mismatches to an audit queue.
7. Persist snapshots only under the match record in a server-owned field. Deny client writes via Firestore rules. Never mutate XP, current license tier, lifetime maximum, achievement ledger, or season points.
8. For an ungraded participant, shadow RDW uses neutral 100%; this is a provisional protection policy, not a final public scoring rule.
9. For legacy matches lacking pre-start evidence, return unavailable; never fabricate historical ratings from today's grade.

## Acceptance gates before enabling production writes

- Confirm production handler, deployed codebase, exact Firestore paths and permissions from code and configuration.
- Emulator tests: unauthorized caller, forged tiers, missing registrations, wrong match state, simultaneous start, duplicate retries, cancellation, revision, partial reads, and immutable snapshot conflict.
- Shadow-only comparison: no production score or lifetime award changes, including retries and failed transactions.
- Verify rollback: disable snapshot capture without deleting already sealed evidence.
- Human approval required for main merge and any production deployment.

## Current blockers

- The actual production match-start backend and trusted current-tier persistence contract remain unverified.
- The RDW transaction adapter in this PR is a reference adapter only; its caller must provide a verified resolver and authenticated match context.
