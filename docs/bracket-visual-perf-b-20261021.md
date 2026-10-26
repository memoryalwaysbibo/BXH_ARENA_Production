# Bracket B visual + performance optimization (candidate)

Status: baseline/spec only; no runtime modifications, no merge or deployment.

## Goals
- Winner: theme-colored subtle fill, 1.5px border, readable text and explicit winner marker.
- Loser: neutral legible text; do not imply elimination in double-elimination brackets.
- Advancement connectors: theme-colored 2–2.5px only after confirmed advancement; unresolved connectors neutral.
- Reuse existing theme selection as a single color source; changing theme must not rebuild bracket nodes or connector geometry.
- Preserve existing match outcomes, byes, correction handling and match logic.

## Performance investigation
1. Locate bracket rendering and pan/zoom event listeners in production frontend and compare fix/bracket-pan-jitter.
2. Capture baseline on 32/64/128 participant brackets using identical device and dataset.
3. Separate result-state updates from drag transform updates; inspect rAF batching, DOM reads/writes, and connector recalculation.
4. Implement minimal visual changes and targeted performance improvements after confirming source paths.
5. Test one-finger pan, pinch zoom, fast repeated pan, result correction, theme switching, 128-player rendering and mobile widths 390/430px.

## Acceptance
- No false winners for pending/cancelled matches, byes or multi-player advancement.
- No connector misalignment on pan/zoom.
- No new visible long stalls; P95 frame time <=110% of baseline and no FPS regression in comparable runs.
- No new console errors, duplicate nodes or persistent memory growth.
- All changes confined to candidate branch; do not merge main or deploy without user approval.

## Existing code observations
- Production index.html build tag at review: 20261021.1 / v14.3.35.
- modules/main-app/bracket-commit.js handles bracket commit consistency; do not alter this persistence/commit logic for a visual optimization.
- Existing branch fix/bracket-pan-jitter needs comparison before modifying pan handling.
