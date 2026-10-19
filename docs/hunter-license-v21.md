# Hunter License 2.1 — private review candidate

2026-10-20: owner authorized implementation. This candidate does not deploy to the public BXH production site.

## Approved direction and latest draft thresholds

- Current strength uses the latest 20 valid individual standard-mode official matches, across seasons. Fewer than 20 uses the available matches.
- Strength: rounded win percentage × 0.6 + rounded trusted finish-point share × 0.4, then rounded to an integer. Penalty points are not physical finish points.
- Rating: strength + existing event-XP seniority bonus, capped at 100. Bonus = 15 × ((event LV − 1) / 98)^0.75. Practice XP does not increase this bonus, preserving the existing source policy.
- Grade uses full-precision bonus. Display truncates fractional rating to one decimal so it cannot visually reach a gate before actually reaching it.
- No additional win-rate gate; no Elo/opponent-strength implementation in this update.
- Current grade can fall; highest attained grade is a separate lifetime concept. No seasonal reset or inactivity deduction.

| Grade | Rating | Minimum strength | Lifetime matches | Events | Verified different opponents | Medium | Large |
|---|---:|---:|---:|---:|---:|---:|---:|
| E | 25 | 20 | 2 | 1 | 2 | 0 | 0 |
| D | 35 | 25 | 4 | 2 | 3 | 0 | 0 |
| C | 45 | 35 | 7 | 3 | 5 | 0 | 0 |
| B | 55 | 45 | 12 | 5 | 8 | 0 | 0 |
| A | 65 | 55 | 20 | 8 | 12 | 1 | 0 |
| S | 75 | 65 | 30 | 12 | 20 | 2 | 1 |
| National | 85 | 75 | 50 | 20 | 30 | 2 | 2 |

All gates apply simultaneously. Failure to reach E means ungraded. Valid round counts are displayed but no longer an extra promotion gate in this draft.
Medium is 96–127 actual played participants; large is 128+. The buckets are exclusive. Registration capacity and waitlists are not used. A player's valid completed match is required to count an event.

## Implementation boundary

`hunter-license-v21.js` is a separate versioned pure evaluator. The app uses it for the license, while legacy radar, general analysis, XP and offline legacy reports retain their existing contracts. Recent window ordering is by played timestamp, with stable evidence-key tie breaking. Canonical deduplication handles corrections, incomplete revisions and byes first. Fault awards do not inflate strength.

Formal grade experience in this private candidate uses known-dated official individual matches from 2026-10-01 onward, consistent with the personal-center review partition. This cutoff must be reconciled with the final historical data policy before production migration. Existing event XP remains intact, including earlier/mixed-mode connected event XP; no destructive cleaning is performed.

Distinct opponent counts use resolved cross-event identity, never display-name matching. Event size is derived from the public canonical completed-match participant roster. Missing sizes or unresolved identities are displayed as pending evidence and cannot satisfy the corresponding gates. No new private data reads are introduced.

## Remaining before public production

- Lifetime highest in this candidate is explicitly labeled historical replay under v2.1, not a permanent server-issued award. Backfill must not be misrepresented as proof that an old grade was actually awarded.
- Add an authenticated, idempotent server-side maximum-grade ledger, with rule version and award evidence, before claiming permanent lifetime highest across history corrections, deletion or devices. Client localStorage is not authoritative.
- Confirm grade-history migration/cutoff and any existing issued ranks; no automatic migration or deletion was performed.
- Complete actual account/mobile acceptance and merge review; the private read-only guard remains enabled.
- PR #530 still needs the separate R4 performance and R6–R8 personal-center changes backported from the review Site, and current-main conflicts resolved, before public release.

## Public sample check

A partial public S1 sample of 225 identified players yielded: ungraded 93, E 62, D 34, C 26, B 10, A/S/National 0. These are sample-only computations, not production player grades. No sampled player has more than 20 analyzable matches, so this sample cannot validate 20-versus-30 window behavior; synthetic boundary/rollover tests cover the window mechanics. No 96–127-player event exists in the sample, which blocks A+ under the exclusive medium requirement. Opponent identity coverage and historical completeness limit conclusions.
