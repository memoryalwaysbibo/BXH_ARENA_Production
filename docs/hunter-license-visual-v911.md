# Hunter license v9.1.1 visual integration

The license identity card uses the approved v8 materials and v9 mobile layout.
At <=560px, the existing badge moves into the identity column between the name
and serial/date. Desktop restores portrait, identity and rank as siblings.
The current `displayGrade()` result is passed from the existing caller; historical
peak and equipped title are not selected. Existing analysis, XP and grade detail
remain below the card without changes to their calculations or service calls.

## Provenance

Original integration base: `4bd2e051352f3086f507b0ec16d7d373b82ab41f`.
Main compatibility merge: `5d4ce00083061920043dbc0aba7a1be649aa1d8e`;
the core script URL preserves both family-transfer and Hunter visual cache keys.

The user supplied `Hunter-License-Preview-v9.1.1.zip` as a readable local attachment.
Its HTML is 15,057,432 bytes with SHA-256
`24b4e9f648a975537df61059cc6a1fbde4248ce251741d518094b00669871c34`.
The eight PNGs were extracted from that verified final artifact, decoded as RGBA,
and preserved byte-for-byte. `assets/hunter-ranks/license-v911/manifest.json`
records each hash and dimensions. These hashes also match the historical review
assets; no claim is made that the final preview contains retouched images.
The previous edge-quality warning is addressed by reviewing the real rendered
images, rather than silently substituting or redrawing them.

The first 16,494 bytes of `hunter-license-visual.css` are the original `AFTER_CSS`
(SHA-256 `e6fd02ac5d5269e8bf94418f812fee2aaa658d0ba6fd5bafdb24543df97f7902`).
Historical preview comments remain in that frozen CSS. Appended rules only
handle hidden image fallbacks and spacing to the existing statistics panel.
The old isolated integration package's grade/auth helpers and proposed serial
contract were not imported. No SVG sample is included in this integration.

## Runtime boundaries

- The existing trimmed displayName / realName / 玩家 decision supplies the name.
- Serial and join date remain 待配號 / 待核對. Sample mode, fake 00001, legacy IDs,
  inferred account dates and a new allocator are deliberately absent.
- Only the current grade PNG is referenced; no eight-image preload is added.
- A pending grade has no image request and retains its current uncertainty label.
- Network or decoding failure displays the grade text; avatar failure displays
  the name initial. Rendering again permits a fresh image load.
- One media listener and a scoped added-card scan handle re-renders and resize.
  Rank movement is idempotent and does not duplicate images or listeners.
- Authentication, cloud runtime, rank engine, RDW, MyEvents and backend contracts
  are unchanged. The legacy card remains a fallback if the visual module fails
  to load.

## Validation and release boundary

```bash
node --test tests/hunter-license-visual.test.cjs tests/hunter-license-v21.test.cjs tests/hunter-license-grade.test.cjs tests/hunter-b6-license.test.cjs tests/player-center-integration.test.cjs
node tests/hunter-license-visual-browser.cjs
node scripts/verify-production-frontend.cjs
node scripts/run-regression-core.cjs critical
```

The browser runner uses Playwright Chromium and requires working system fonts.
In the development executor it was run with:

```bash
FONTCONFIG_FILE=/workspace/hunter-license-fontconfig.conf \
PLAYWRIGHT_BROWSERS_PATH=/workspace/.cache/ms-playwright \
NODE_PATH=/workspace/BXH_ARENA_Production/node_modules \
HUNTER_VISUAL_QA_OUTPUT=/workspace/hunter-v911-qa \
node tests/hunter-license-visual-browser.cjs
```

It intercepts every request and serves actual repository PNGs locally. The
production stylesheet stack and name/render caller seam run against synthetic
fixtures; no real Auth, profile loader or player data is accessed. Coverage:
320/390/430/960px, all eight ranks, long Chinese/English names, portrait/landscape
avatars, missing identifiers, pending grade, request/decoding errors, resize
without rerender, back/reopen/repeat and recovery after failure.

Local unit/regression checks after the main merge: 58 passed, including the
main family-transfer regression tests. Browser geometry: 96 rank/name/width
cases plus 8 avatar-aspect cases and lifecycle/failure checks. Eight rank cards
at 390px and additional narrow/desktop/long-name/failure screenshots were
visually reviewed: rank text remains readable at tested sizes, without observed
clipping or obscuring edge artifacts. This is not a physical-device Safari test
or a live authenticated E2E run.

The existing CI workflow now runs the new unit and browser checks. Local results
do not establish remote CI or deployment success. PR access, exact-commit CI,
merge and production artifact verification are separate outstanding release
gates; the earlier GitHub GraphQL Forbidden was not bypassed by this work.
