# RDW P3 — Tournament-start dual snapshot integration plan

Status: design accepted by owner; **not deployed or wired to production**.

## Located UI event

- E2E tests use `[data-action="start-tournament"]` after `[data-action="draw-bracket"]` and a confirmation modal.
- `tests/community-host-roster-sync.test.cjs` extracts a `start-tournament` branch and checks roster freshness. This indicates the start action is sensitive to stale registrations.
- The exact authoritative production server write behind this UI action is **not yet verified**. Browser click alone is not proof of a server-side start event.

## Proposed two-layer snapshot

1. **Tournament baseline**: after the latest roster/draw revision is validated, the host confirms start. The trusted backend transaction reads canonical entrants and their server-verified CURRENT tiers, seals the event baseline keyed by event + draw revision, and atomically transitions the event to started. If capture fails, first check whether the server already committed a snapshot; then offer retry or an explicitly authorized RDW-only PASS. PASS permits normal tournament start without claiming a verified snapshot. Never bypass existing roster, identity, or tournament safety checks.
2. **Match baseline**: when each actual pairing is committed to a trusted server start transition, seal both perspectives using the same server timestamp, matchId and dispatch revision. Later-round opponents must never be guessed from the initial draw.
3. Repeated requests return the existing snapshot; changed entrants, tiers, revision or timestamps must not overwrite sealed evidence. Cancellation and replay require separate auditable revision entries.
4. No RDW writes to current tier, highest lifetime award, XP, season points or referee scoring. The shadow evaluator reads snapshots only.
5. Ungraded participants receive provisional neutral 100% shadow weight, not a permanent claim about player strength.

## Required tests before any deployment

- Confirm start-tournament frontend dispatch and the current production server owner.
- Race: draw refreshed while start is pending; stale roster; missing player UID; partially unavailable current tier.
- Firestore emulator: start + snapshot atomicity, retry, stale client, cancellation, next-round match start, authorization and no lifetime-award mutation.
- Production write feature flag defaults OFF; explicit human release approval after passing tests.

## Important

Do not hook snapshot capture into `courtCallService.notify`: calling a player is not necessarily starting a match.

## RDW-only PASS fallback (approved)

- Trigger: RDW capture fails or remains unconfirmed after a bounded retry/readback. Never show PASS for a roster or authorization failure.
- Host must explicitly confirm PASS; no silent fallback. Record actor UID, event code, draw revision, server time, error category and a stable idempotency key in an append-only audit trail.
- PASS bypasses **only RDW snapshot capture**, not match authorization, bracket validity, scoring, or settlement.
- Shadow evaluator marks skipped/unverified snapshots as ineligible. No retroactive claim that a late upload is a pre-match verified snapshot.
- A timeout may mean the server committed. Read back before PASS, and if a verified snapshot already exists, use it rather than marking skipped.
- Repeated PASS requests are idempotent; a changed draw revision requires fresh validation.
- This PASS is distinct from the player's existing tournament PASS rule.
- Feature remains OFF in production until end-to-end emulator verification and explicit owner release approval.
