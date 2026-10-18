# Regional ladder uses current member geography

The member editor stores `users.region`, but the regional ladder previously
filtered `ladderPlayers` directly. Members could have positive scores and a saved
location yet disappear from the local board. The generic empty message then
incorrectly implied there were no points.

## Change

- On selecting a city, read current geography through the companion read-only
  `ladderLocationService`. Apply the same result to season/career ranking and
  personal-rank cards. The guest board uses the same city/district filter.
- Resolve existing members from their current profile, without rewriting scores
  or running a backfill. Do not infer a family member's geography from a parent.
- Prefer the current combined region over a legacy split city; explicitly cleared
  locations are cleared in the profile display as well as the ranking service.
- Show loading or retryable errors until the complete regional lookup succeeds.
  Never publish a partial board after a failed batch. Distinguish empty local
  results from an empty global score table.
- Cache geography for its score snapshot, deduplicate requests and use batches of
  100 with two workers. The global board has no extra geographic reads.
  Successful profile saves and explicit refresh replace the snapshot. Late
  responses from old snapshots cannot overwrite the new geography.
- Global tier/legend qualification and all point calculations remain unchanged.

## Verification / limitations

Run `node --test tests/ladder-location.test.cjs`,
`node --test tests/ladder-location-browser.test.cjs`, the existing ladder history,
ranking, settlement and V1 tests, and `node scripts/verify-production-frontend.cjs`.
The new Chromium tests are isolated renderer/loader scenarios with synthetic
callable responses, not authenticated full-app or live Firestore tests.

Backend PR in `BXH_ARENA_Functions_Deploy` adds the standalone
`production-ladder-locations` codebase, complete administrative allowlist, bounded
reader tests, a lockfile, and a validation/manual scoped release workflow.
Backend service must be reviewed, deployed, and source-verified before this
frontend is merged/released. On a missing backend, local boards show a read error
and the global board still works. No production profiles have been audited or
changed by these tests; verify affected members against the live board after the
coordinated release.
