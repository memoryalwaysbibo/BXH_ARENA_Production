# RDW P3-30 — Dual-account acceptance fixture and unresolved ungraded rule

Acceptance context (user-reported, not a production snapshot): BXH-SDSAQZ has two real accounts; their **claimed/current** Hunter 2.1 tiers are ungraded and D respectively. UID and room roster checks were performed separately via Cloud Shell. This file intentionally contains **no actual UIDs, private roster, email, or names**.

## Policy discrepancy

The raw RDW formula `weight(selfTier,opponentTier)` counts ungraded=0, E=1, D=2, so ungraded -> D = **1.02**, D -> ungraded = **0.98**.

The existing provisional protection `protectedWeight()` deliberately neutralizes any encounter involving ungraded to **1.00 / 1.00**. `verifiedPreMatchWeight()` uses this protected value, so **the currently implemented shadow evaluation does not generate 102% or 98% for this pair**.

Both paths are now covered by `tests/rdw-dual-real-account-policy.test.cjs`. Invalid/unknown tiers are rejected rather than being hidden by the ungraded exception.

## Decision gate

**DO NOT** change protectedWeight or production scoring to 102% / 98% until product owner explicitly chooses a rule for ungraded players. Keep PR #557 draft and feature disabled.

Any live-room experiment before then remains read-only; do not start, change bracket, or award XP from a fixture. To safely test D-grade account, require the current-tier Reader's complete=true, unresolvedIdentities=0, canonical UID and server sourceDigest; a screenshot or verbal grade alone is insufficient for sealing.

Even after choosing a policy, the exact live participant pairing and latest bracket/roster revisions must be verified before a pre-match snapshot. 1+7 virtual and 2+6 virtual mixed rooms cannot mint full-roster verified RDW snapshots for players without canonical UIDs.
