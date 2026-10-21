# RDW P3 — Tournament-start dual snapshot integration plan

Status: design accepted by owner; **not deployed or wired to production**.

## Located UI event

- E2E tests use `[data-action="start-tournament"]` after `[data-action="draw-bracket"]` and a confirmation modal.
- `tests/community-host-roster-sync.test.cjs` extracts a `start-tournament` branch and checks roster freshness. This indicates the start action is sensitive to stale registrations.
- The exact authoritative production server write behind this UI action is **not yet verified**. Browser click alone is not proof of a server-side start event.

## Proposed two-layer snapshot

1. **Tournament baseline**: after the latest roster/draw revision is validated, the host confirms start. The trusted backend transaction reads canonical entrants and their server-verified CURRENT tiers, seals the event baseline keyed by event + draw revision, and atomically transitions the event to started. If capture fails, reject start with an actionable error; do not silently start.
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
