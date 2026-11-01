# Cleanup reconciliation, 2026-11-02

Read-only comparison baseline: Production main `286a0459008762fb7041da56490c9b403f505050`. This cleanup changes release tooling and records completed comparisons; it does not combine old feature candidates into production.

| PR | Observed evidence | Disposition |
| --- | --- | --- |
| #554 | The exact `ladderScrollToRankRow` helper is already in main; the existing nested/document/blocked scroll tests pass against pinned main. The later find-me flow still invokes the helper. | Eligible to close as incorporated, preserving branch/history. |
| #559 | The exact conditional board-only expansion block is already in main. Its three existing tests pass against pinned main. | Eligible to close as incorporated, preserving branch/history. |
| #537 / #539 | Their returned changed-file patches are identical. | Duplicate candidates identified; retain pending comparison of the current drag lifecycle, rather than applying either whole historical Core file. |
| #664 | commerce-ui.js and its test already match main; current CSS retains the compact image rule and adds a detail-page rule. The five image blobs differ and later #669 is merged. | Retain until the actual artwork differences are reviewed. No old-image overwrite. |

Six existing leaderboard tests passed locally on the pinned current file. This proves the checked behavior in their static/VM boundaries, not a new mobile production session. No new app runtime change or player-data write was made for these comparisons.

Pending work remains separate: My Events backend readiness/activation; referee certificate backend deployment/flags and the deliberate closed-release guard; original automatic hunter-numbering source and live deployment evidence. No feature flag is enabled and no identifier is assigned by this cleanup.
