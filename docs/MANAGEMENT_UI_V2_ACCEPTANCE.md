# Management UI V2 — Acceptance Gate

## Automated
- [x] Production Frontend RC1 validation passes on latest V2 head.
- [x] Branch is based on current main (behind = 0).
- [x] No Production index.html diff.
- [x] Role/group smoke coverage.
- [x] Mount adapter interaction smoke coverage.
- [x] Mobile two-level navigation CSS isolated.

## Manual preview acceptance
- [ ] Header remains unchanged.
- [ ] Main navigation remains at the top.
- [ ] Default/base skin visual hierarchy is acceptable.
- [ ] Five groups are understandable: 賽事 / 現場 / 排行 / 活動 / 系統.
- [ ] Referee field workflow is faster than current flat navigation.
- [ ] Super-admin still has access to all existing functions.
- [ ] Narrow iPhone horizontal navigation is comfortable.
- [ ] No function is removed; only regrouped.

## Production release gate
DO NOT merge or deploy until manual preview acceptance is explicitly approved.
After approval: create a minimal adapter-only integration commit, rerun RC1 + smoke tests, then perform a final diff review before merge.
