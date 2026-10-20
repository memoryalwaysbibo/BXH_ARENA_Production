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

Formal grade experience uses known-dated official individual matches from 2026-10-01 onward, consistent with the personal-center review partition. This cutoff must be reconciled with the final historical data policy before production migration. Existing event XP retains earlier and mixed-mode connected event XP. Test events are excluded from XP and license history using the shared `hunterRecordIsTest` predicate: explicit metadata (`testMode` or `eventAuthority: test`) or the audited legacy room code `BXH-C6BATA` (2026-10-02 double-elimination review). The public source for this room still says official with no test flag; its code correction applies to every participant in the personal-center reader and pure license evaluator. Test matches stay browseable in a separate archive; titles alone never establish test status. No source documents are modified by this correction.

Distinct opponent counts use resolved cross-event identity, never display-name matching. Event size is derived from the public canonical completed-match participant roster. Missing sizes or unresolved identities are displayed as pending evidence and cannot satisfy the corresponding gates. No new private data reads are introduced.

## Remaining before public production

- Lifetime highest in this candidate is explicitly labeled historical replay under v2.1, not a permanent server-issued award. Backfill must not be misrepresented as proof that an old grade was actually awarded.
- Add an authenticated, idempotent server-side maximum-grade ledger before claiming a permanent lifetime highest. The callable must reconstruct trusted results from the signed-in account's registration and public canonical completed matches, not accept a browser-submitted grade or match list. Persist `{uid, highestTier, ruleVersion, firstAwardedAt, awardEvidence, evaluatedAt}` under a server-only write path. Use a transaction to advance only when the verified tier outranks the saved tier, and a deterministic award ID per uid/rule version/tier to make retries safe. Preserve the highest grant when the current grade falls; put conflicting corrections or revocations into an audit/review state rather than silently rewriting an irrevocable award. Incomplete registration or identity scans must not grant a tier. Backfill the existing population under this same evidence gate and label historical replays as provisional until grant policy is approved.
- Confirm grade-history migration/cutoff and any existing issued ranks; no automatic migration or deletion was performed.
- Complete actual account/mobile acceptance and numeric checks against private registration identity links. The public metadata audit and numeric difference for `BXH-C6BATA` are recorded below; its source metadata and server achievement service still need the corresponding correction before claiming system-wide backend consistency.
- PR #530 includes the verified personal scan retry, Hunter journey and paged archive UI and has merged the 2026-10-20 main snapshot. Review the remaining private-only diagnostics/guards for production suitability; the private read-only guard must never be copied into production.

## Public sample check

A partial public S1 sample of 225 identified players yielded: ungraded 93, E 62, D 34, C 26, B 10, A/S/National 0. These are sample-only computations, not production player grades. No sampled player has more than 20 analyzable matches, so this sample cannot validate 20-versus-30 window behavior; synthetic boundary/rollover tests cover the window mechanics. No 96–127-player event exists in the sample, which blocks A+ under the exclusive medium requirement. Opponent identity coverage and historical completeness limit conclusions.

## 2026-10-20 public numerical audit

Read 38 completed public event mirrors without read failures. The owner's exact account-linked Loft record has two completed matches: 4–0 and 0–4 (one win and one loss). Six public events have exact account IDs; remaining historical rows use legacy local IDs and cannot be conclusively joined through public names alone.

For a provisional audit only, treating each unique same-name legacy participant as the owner yields 21 S1 matches in 11 events (9 wins, 12 losses). C6BATA contributes two losses, seven round events and 54 XP (2×10 + 7×2 + 20). Excluding it yields 19 matches in 10 events (9 wins, 10 losses), recent strength 47 instead of 45, and all-source event XP 1,286 instead of 1,340. Both XP totals give event LV 7; bonus is 1.846227..., making the provisional rating 48.8 instead of 46.8 and provisional tier C in both cases. These are not issued grades or proof of complete private career coverage. A same-name join is never written into production identity data.

The 1,286 XP figure still includes legacy pre-S1 event credits under the existing XP policy. It does not establish that every unflagged old test or anomalous event has been cleaned. A separate S1-only XP policy would produce a different bonus and requires its own migration decision.
