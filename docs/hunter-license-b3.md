# Hunter License 2.0 — B3: auditable eight-axis distributions

B3 depends on B2 (PR #450), and is reviewed against the B2 feature branch. Neither batch is deployed by this change. Merge B2 into main first, then retarget/reconcile B3 against the current main and run its required checks before deployment.

## Agreed behavior

The eight axes remain Extreme / Knockout / Burst / Spin and their four received-score counterparts, labeled 極限／擊飛／爆裂／轉停／被極限／被擊飛／被爆裂／被轉停. These describe finish-method distributions, not eight independent strength grades.

| View | Numerator | Denominator | Radius |
| --- | --- | --- | --- |
| 分數占比 (default) | Points for the selected finish type | Own four-method gain points, or own four-method loss points | Actual rounded percentage; 100% is full radius |
| 次數占比 | Number of events of the selected finish type | Own four-method gain events, or own four-method loss events | Actual rounded percentage; 100% is full radius |

Gain and loss use separate denominators. Enchantment uses validated base points under B2, including the base of a card-reduced zero-point finish. Fault awards do not contribute to either denominator. Official match scores, combined ability rating, style calculation, XP, and license thresholds are unaffected by switching the chart's display metric.

The previous doubling of the visual radius (50% rendered as full radius) is removed. Grid rings explicitly mark 25%, 50%, 75%, and 100%. The actual plotted rounded percentages match the axis labels and source statistics. Percentages round independently; the four displayed values may not sum to exactly 100%.

Gain data use gold and loss data use red, including polygons, nodes, and axis labels. A larger red value means a more frequent loss method, not better defense. The chart discloses that distinction in visible text and includes all axis values/fractions in its accessible description.

A zero denominator produces a dash and no polygon for that direction. A supported denominator with no events of one type produces 0%. Do not confuse empty data with zero occurrences. Raw distributions remain visible below the existing 3-match / 8-round score threshold, and B1 partial/loading/error safeguards still apply.

Eight axis labels are keyboard-accessible buttons. Clicking or activating an axis opens the corresponding existing inline statistics detail and brings it into view. Each detail shows the selected numerator/denominator, total event count and points, and the same original-match evidence as B2. No page navigation or modal is introduced.

## Acceptance

1. Use a fixture or real history with one Extreme (3 points), one Knockout (2), one Burst (2), one Spin (1). Extreme must be 38% (3/8) in point mode and 25% (1/4) in count mode.
2. Verify loss percentages against their own loss denominator, never against gain + loss or gain-only totals. Check gold/red polygons against the labeled grid, including 25%, 50%, and 100%.
3. With no loss records, loss axes show dashes and no loss polygon. With loss records but no Extreme losses, 被極限 shows 0%.
4. Click each axis or activate it with Enter. The corresponding direction/type detail opens inline and identifies both denominators and original matches. The selected fraction must match the chart.
5. Switch tournament source and period while retaining the chosen display metric. Confirm enchantment uses base points and excludes fault/card adjustments as B2 specifies.
6. Switching count/point display must leave combined strength, license grade, sample thresholds, and XP unchanged. Below-threshold and partial histories show only the conclusions permitted by B1/B2.
7. Check at 320px and 390px mobile widths plus desktop, with both metrics and missing/empty/ready/partial/error data.

## Validation

- 6 B3 behavior cases passed: independent denominators, missing/zero distinction, literal radius and ring labels, inline fractions/evidence, enchantment base/fault isolation, and real action-handler validation.
- Critical regression: 19 groups passed, including B1/B2 contracts.
- Production frontend verifier, license grade, enchantment ledger, syntax, and diff whitespace checks passed.
- Production renderer/CSS tested at 390px for 30 combinations: 2 metrics × 3 categories × 5 data states; no horizontal overflow.
- Browser interaction checks at 320/390/768/1280px exercised the actual metric/axis handler code: pointer metric switches, keyboard axis expansion, correct fractions, no axis-label overlap or document overflow.
- Browser checks use fixtures and the production rendering functions, not an authenticated production account. The test environment lacks Chinese fonts; real-account visual acceptance still follows deployment.
