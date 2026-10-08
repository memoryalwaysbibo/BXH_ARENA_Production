# Hunter License 2.0 — B2

B2 separates tournament modes and removes enchantment card adjustments from ability distributions. The default source is standard tournaments. One shared selector controls overview period statistics, ability analysis, and match records; ladder and date filters compose with it. Lifetime XP and permanent achievements retain their existing all-connected-source calculation.

## Source contract

| Category | Identification | Ability score |
| --- | --- | --- |
| Standard | `bxh-4pt-v1`; legacy records without v2 events or enchantment metadata | Existing 60% win rate + 40% finish-point share |
| Enchantment | `bxh-enchantment-v2`, or explicit enchantment mode without a conflicting scoring version | No combined ability score; base-point distributions only |
| PK | Reserved `sourceType: hunter-clash` contract | No combined ability score; live selector disabled |
| Unknown | Unrecognized scoring version, conflicting metadata, or unversioned v2 events | Excluded from ability calculations; visible in All records |

The production loader still discovers completed matches through the player's registrations and public tournament snapshots. PK exists only in the HC01 sandbox branch and has no approved production Hunter License source. B2 does not query sandbox collections or imply that missing PK history is zero history. All means all currently connected tournament sources, not every private/deleted/sandbox match.

Source classification and mode filtering happen after latest-record canonicalization so a corrected mode or revoked match cannot resurrect an older record. New tournament records explicitly include sourceType and playMode. The cloud perspective transformation retains these fields through the existing spread.

## Enchantment arithmetic and analysis

For each side, official points = finish base points + positive card adjustments − negative card adjustments + fault awards. Faults remain fixed at one point and are shown independently. Every v2 event must carry its exact canonical basePoints, integer delta, and v2 marker, and its basePoints + delta must match official points. The full ledger must reconcile against the final match score before any split is accepted. Zero-point card reductions remain real finish events with nonzero base points.

Splits appear in overview period statistics, ability analysis, and each match detail. The timeline shows base and signed card adjustment while retaining official points. Evidence chips show the same base-point numerator as the aggregate. Ability, opponent analysis, and single-match breakdown share this contract. Missing split data is excluded and disclosed, never reconstructed by guessing. If no split is verified, the UI shows a dash rather than five invented zero totals.

Standard-only combined scores retain the existing sample threshold (3 matches, 8 finish rounds). Enchantment can describe a base-point style at that threshold but receives no combined score. Mixed source sets can show raw base-point distributions but receive neither a combined score nor a style conclusion. Standard-only All views use the standard score. License strength and high-grade sample gates always use lifetime standard records, regardless of the active source selector. Seniority continues to use lifetime XP from all connected modes; therefore additional enchantment experience can affect seniority, but never strength or standard sample counts.

## Acceptance

1. Start on Standard. Switch to Enchantment and All in overview, analysis, and records; selection persists between tabs. Combine source with date and general/ranked filters.
2. Reconcile each enchantment match and aggregate: base + bonus − reduction + faults = official total, independently for self and opponent. Expand a scoring source and verify that evidence base points match the analysis total, while timeline official points match the recorded result.
3. Verify a card reduction to zero contributes its canonical base to attack/defense distribution, and faults contribute only to reconciliation.
4. With enough standard samples, add enchantment matches: standard strength and sample counts stay fixed. Lifetime XP may rise under the preserved experience rules.
5. Missing/inconsistent enchantment splits stay visible as match records but cannot generate partial ability data. Unknown scoring versions remain outside standard scores. Latest corrections and reversals apply before filtering.
6. PK displays “尚未串接”, is disabled, and does not issue sandbox/PK cloud reads. Achievement tab has no category selector.
7. Loading/error/partial/empty states retain B1 safeguards. Check 390px mobile width, full record details, and the four source controls.

## Validation

- Critical regression: 18 groups, all passed, including B1 statistics/cloud tests and 7 B2 behavior cases.
- Production frontend verifier: passed.
- License grade regression and enchantment ledger regression: passed.
- JavaScript syntax and diff whitespace checks: passed.
- 390px Playwright layout checks: 15 combinations (3 active categories × ready/empty/partial/loading/error), no horizontal overflow. These use the production renderer and CSS with fixture records, not an authenticated production account. The test runtime lacks Chinese fonts; mobile layout checks do not substitute for signed-in visual acceptance with real records.

B2 is prepared for review; merge/deployment and live-account acceptance follow separately.
