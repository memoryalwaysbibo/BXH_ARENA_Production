# Public read-only catalog

`bey-catalog.html` is a standalone, anonymous reader for one reviewed public snapshot. The landing screen in `modules/main-app/core.js` links to it with an ordinary anchor; the core asset URL in `index.html` receives an additional cache key. Authentication and role selection are unchanged.

## Runtime files

- `bey-catalog.html`
- `bey-catalog.css`
- `modules/bey-catalog/catalog-public-model.js`
- `modules/bey-catalog/catalog-public-ui.js`
- `data/bey-catalog/public-catalog.d8f36e95e0a12ae411df9e336411c0dd65f9797729b2f772c00a5abb4507b927.json`

The JSON is the exact approved public payload, 64,615 bytes, SHA-256 `d8f36e95e0a12ae411df9e336411c0dd65f9797729b2f772c00a5abb4507b927`. It contains 9 products, 45 parts, 13 options, 11 assembly relations and 38 content facts, totaling 116 records across these categories. These are not 116 products or the full research dataset. No raw dataset, source-evidence registry, source-page copy, diagnosis or private review report is a runtime input.

## Trust and display boundary

- A single same-origin `GET`, with credentials omitted, no cache reuse and redirects rejected, reads the fixed versioned filename. There is no query-string override, authentication, Firebase access or write action.
- `decodeSnapshot(ArrayBuffer)` checks exact byte length and SHA-256 with WebCrypto before parsing. `validateCatalog(data)` then checks exact keys, pinned counts, required values, source allowlists, unique IDs and complete parent/part/quantity references. Any failure clears all records and counts, disables filtering and offers manual retry. A 15-second request timeout and latest-request guard prevent stale retries from replacing newer results.
- The model exposes the same functions through CommonJS for tests and the packaging check. A schema check alone does not authenticate a replacement dataset. The fixed hash is an integrity/version pin, not proof of real-world correctness or publication authorization.
- Every displayed record string uses `textContent`. Source links use an exact list of the 25 approved HTTPS URLs, `noopener noreferrer`, `no-referrer`, and an accessible new-window label. Remote pages and PDFs are linked. The six explicitly reviewed UX-18 option photos are local WebP assets; no remote image request is made. The HTML CSP allows only same-origin scripts, styles and data fetches; images are same-origin-only; frames, objects and forms remain disallowed.
- Product and option `compositionComplete` remain false. A complete assembly relation means its current independently assembled battle-part types were checked. It does not certify all box contents, physical colors, every option or the number of all internal manufactured pieces. Missing BX-20 assembly names are visibly marked as missing instead of concatenated into invented official names.
- Original names and codes remain unchanged in the authenticated snapshot and are retained verbatim in the visible secondary text. Traditional Chinese primary names are explicitly marked as provisional translations; they do not create Taiwan-official naming evidence. Color-version words already present in a source name may be translated for comparison, without certifying physical colors. Category labels are search aids. Unconfirmed fields and partial assemblies are not inferred from names, codes, pictures or missing relations.

## Traditional Chinese display boundary

The existing model contains 39 exact-original-name aliases, reused where the same source name occurs in multiple record types. They cover all 9 products, 22 named parts, 6 named options and 9 named assembly groups in this snapshot. Each Chinese primary title is marked `中文暫譯`; the original Japanese string is visible on a separate, secondary line marked `原文：`. The snapshot has no reviewed Taiwan-official Chinese name field, so no alias is labeled official, community-attested or verified.

- `displayName(record, fallback)` returns a separate frozen presentation object with `primary`, `original`, `status` and `label`; it never rewrites a source record, adds source evidence or changes validation/completeness state. Exact original-name lookup prevents a reused record ID from receiving the wrong translation. Unknown names retain their original string and display `中文名稱待補` rather than a guessed alias.
- The 23 code-only parts use an unchanged code plus the known Chinese category, such as `5-70 棘輪`, `DB 軸心` and `Tr 棘輪／軸心整合型`, marked `代碼＋分類`. These labels do not expand abbreviations into an invented official name or performance claim. The bit code `C` remains distinct from the named assist blade `C（チャージ）`.
- `ブラッシュ` and `ソル` use the provisional transliterations `布拉許` and `索爾`. No unverified English spelling is presented as an original source name. The full CX-00 product title retains both the lock-chip item and battle-pass sheet; `透明黑版` only translates wording in the source name.
- Seven unnamed option nodes keep the generic `已收錄部件` heading. The two unnamed BX-20 assembly groups keep `部件清單 2` and `部件清單 3`, with the missing-original-name notice. No composition name is assembled from their parts.
- Chinese aliases join the local search index alongside all original names, category labels and codes. Full option-code searches such as `UX-18-03` and full-width equivalents remain supported. Product searches include translated names of their evidenced parts and named options/groups.
- All navigation, categories, controls, helper text and status messages are Traditional Chinese; BXH ARENA branding, technical identifiers, product/part codes and the explicitly labeled source originals remain unchanged. The header reads `戰鬥陀螺X・公開圖鑑`.

There is no new third-party runtime dependency. Six allowlisted local images extend the runtime overlay from five to eleven files. The reviewed JSON remains exactly 64,615 bytes with the original pinned SHA-256, and the research dataset, source registry and public evidence policy are unchanged.

## UX and local verification

The page provides product/part tabs, local search, category filters, reset, expanded part lists, loading/error/retry states and a return-to-index link. Search accepts Chinese display names, original names, full-width text and codes with or without hyphens, including displayed option codes such as `UX-18-03`. Search and tab changes do not refetch the data snapshot. Reviewed local images may be requested as their lazy-loaded frames enter view.

Serve the repository through a local HTTP server and open `/bey-catalog.html`. WebCrypto requires HTTPS or a trustworthy loopback context such as `http://localhost`. Opening `file://` is not supported. Use the normal site root when testing the return link and existing landing-screen entry.

Run:

```sh
node --test tests/bey-catalog-public-evidence-policy.test.cjs tests/bey-catalog-public-ui.test.cjs tests/bey-catalog-public-package.test.cjs
node --check modules/bey-catalog/catalog-public-model.js
node --check modules/bey-catalog/catalog-public-ui.js
node --check tests/bey-catalog-public-browser.test.cjs
node scripts/verify-production-frontend.cjs
```

The focused UI suite has 60 tests, including 8 added for complete Chinese alias coverage, unchanged originals/codes, missing/unknown-name fallback, immutable display state, Chinese search, every named UI level, the 23 code labels and the complete CX-00 title. It also covers the snapshot, schema failures, graph consistency, exact URL allowlist, incomplete-data copy, real UI-script execution in a minimal DOM harness, text-only rendering, failure/retry and stale-request isolation. Together with 31 evidence-policy and 8 packaging tests, the local non-browser suite has 99 tests. The DOM harness is not a real browser or layout test.

The existing 14 Chromium scenarios in `tests/bey-catalog-public-browser.test.cjs` now also assert Chinese primary names, provisional/code labels, visible original text, Chinese search, full option codes, and long translated titles/expanded part lists at 320px and 375px. Browser startup was previously blocked by IPC restrictions in this local executor. These updated browser scenarios have not been run, and no browser pass or layout verification is claimed. Obtain a pass in an allowed environment before release; do not relaunch or use another browser route to bypass the restriction.

## Release boundary

This change is local-only. It does not create a Firestore catalog database, deploy, publish or change IAM, rules or credentials. Use the separately tested `scripts/package-bey-catalog-public.cjs` allowlist packager for the eleven-file overlay and verify its manifest hashes. The overlay expects the existing `index.html` to be supplied by the main application; it is not a complete standalone deployment. The package test is not a general security scan of arbitrary replacement code.

Before an authorized release, verify current main/PR revisions, run the complete required checks and browser QA, include the landing entry/cache key with the approved main-app artifact, inspect final hosting artifact scope, retain a verified rollback artifact, and verify the deployed JSON's exact bytes/hash. Existing whole-repository hosting workflows do not automatically gain privacy guarantees from this overlay packager. Future data revisions require a new approved public snapshot, reviewed allowlist/schema/count changes when applicable, matching filename and integrity pin, and regression tests.

## UX-18 image candidate (2026-10-14)

- Added six full-frame 586×709 WebP images under `assets/bey-catalog/ux18/`. Official manual page 1 visually establishes option-to-source mapping: 01→UX18_02@1, 02→UX18_03@1, 03→UX18_06@1, 04→UX18_07@1, 05→UX18_04@1, 06→UX18_05@1. Carousel order is not SKU order. `UX18_IMAGE_SOURCES.json` records original and optimized hashes, sizes, sources, transformation, use basis and naming provenance.
- Image lookup requires the exact product identity, option ID, option code and original name. Unknown or mismatched identities do not borrow an image. It changes no public fact, raw field, evidence gate, composition flag or snapshot integrity pin.
- Gallery images have explicit dimensions, a preserved aspect-ratio frame, lazy loading, async decoding, descriptive alt text, visible source/copyright credit and an error placeholder. CSS uses two columns except one column below 360px.
- Full-combination display labels for 03 and 04 use the owner's supplied 天馬九尾 M3-85W and 焰神勇氣 C9-70TP. They remain marked 中文暫譯 with original Japanese visible; this is not Taiwan-official naming evidence and does not rename individual parts.
- The operator confirmed free player identification/reference without sales, affiliate links or ad revenue. The official site policy's non-profit-use exception is the scoped basis, not a blanket asset license. Reassess before changing that use or adding other assets.
- Candidate verification: 109 focused non-browser tests passed (99 baseline + 10 image tests), JS syntax checks passed and production frontend invariant checks passed. Eighteen browser scenarios are prepared (14 existing + 4 image cases). They have not been executed for this candidate because of the previously observed local Chromium IPC/sandbox restriction. No browser screenshot or layout pass is claimed. Run the browser suite in permitted CI before release.
- Packaging verifies each image's exact byte size and SHA-256 and rejects altered assets before creating output. The public JSON is unchanged at 64,615 bytes / d8f36e95e0a12ae411df9e336411c0dd65f9797729b2f772c00a5abb4507b927.
