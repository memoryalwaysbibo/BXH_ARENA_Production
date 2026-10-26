# Partner quota in the single ranked start transaction

This candidate builds on RDW branch commit `537908de9d44d9da462ff9b46ba5b0bce1186dd5`. It is not a deployed endpoint and does not enable RDW. It adds no independent start button or callable.

`createAuthorizedMirrorStart` derives canonical references and actor identity on the server. It recovers a prior partner start before resolving new tiers, and repeats recovery inside the final transaction to handle transaction retries. The existing synchronized writer prepares a debit before its first write, validates the sealed roster and server dispatch, then stages the new snapshot, deterministic receipt, contract counter and private/public start together.

`partnerEventDebits/{eventCode}` is unique for the room, bound to its original order, organizer, organization, draw revision, roster revision, verified snapshot digest and original terms hash/version. A repeated identical request returns that committed result and consumes no additional quota. Recovery after expiry or renewal reads the prior result only; it does not authorize ongoing operations or a new start. Disabled/frozen accounts, wrong actors, changed request revisions, partial commits and altered receipts are rejected.

The candidate accepts only room `partnerQuotaPolicy: start-v1` paired with contract `quotaPolicy: start-v1`. Legacy creation-time rooms/contracts and missing counters are rejected for reconciliation. It never resets `usedEvents`, infers a zero balance, refunds a slot or rewrites a signed agreement. Contract eligibility, owner grant, inclusive start/exclusive expiry, signed/payment metadata, unique real roster UIDs and the signed plan's participant range are checked in the write transaction. Only the original owner or an active administrator may trigger the candidate; this does not expand staff authority.

## Release conditions still required

1. Complete and validate the actual RDW Callable wiring and trusted dispatch producer. The existing service remains disabled by default.
2. Update contract activation and room creation together to issue the server-owned policy markers and frozen plan metadata. Reconcile legacy debits before moving any existing room to the new policy.
3. Change live Rules and frontend creation together: remove creation-time debit only for the new policy, deny browser writes to debit receipts/policy/start evidence, and enforce the authoritative start transition. The currently deployed Rules still require creation-time debit and are not changed by this candidate.
4. Validate the full lifecycle on isolated data, including start, cancellation/refund policy and settlement qualification. Continuation after expiry/renewal requires a separate narrowly scoped policy; a retry receipt alone grants no continuation rights.

## Verification

The dedicated workflow has no cloud credentials or deployment steps. It uses `demo-bxh-partner-start` and a mandatory localhost Firestore Emulator, with deny-all client Rules and synthetic fixtures. Cases cover atomic commit/rollback, missing dispatch, identical concurrent requests, competition for the last slot, invalid/legacy counters and authority, participant limits, future/expired periods, recovery after renewal, wrong revisions, wrong actors, frozen accounts and tampered receipts. Existing synchronized writer/authorized coordinator tests remain required.
