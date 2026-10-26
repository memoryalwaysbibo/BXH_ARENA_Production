# Bracket B implementation notes — 2026-10-22

Confirmed from user-supplied production source ZIP:
- `modules/main-app/core.js`: `seMatchBoxHtml` sets `.winner` only from completed `winnerId`; `drawSingleElimConnectors` builds classic SVG paths; board theme is set with `data-board-theme`.
- `modules/main-css/core-competition.css`: seven existing `--board-accent` themes; existing `.se-path-classic` has an `!important` neutral stroke that must be overridden specifically for confirmed advancement.
- Local candidate changes: use theme accent for confirmed winner row and only source-to-junction connector paths of completed winner matches. Shared junction/spine stays neutral because it cannot uniquely identify a winner.
- Local candidate `core.js` passes `node --check` and static assertions. Browser FPS/128-person testing still outstanding.
- No merge/deploy. Runtime changes are local candidate only pending repository sync and validation.
