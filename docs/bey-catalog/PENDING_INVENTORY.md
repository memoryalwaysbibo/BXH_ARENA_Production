# Provisional inventory view

The existing public catalog page now has a separate “待補清冊” scope. The direct route is `bey-catalog.html?view=pending`. This route is only a proposed deployment target until this change ships.

## Data boundary

- 285 complete user-supplied rows in original order, plus one unresolved `BXA-` row.
- Series totals: BX 85, UX 44, CX 43, BXG 74, BXH 18, BXC 14, BXA 7.
- BXA source heading says 9, but only 7 complete rows and 1 incomplete row were supplied; the discrepancy is displayed and no ninth row is fabricated.
- BXA-03, BXA-04 and BXA-05 each retain two separate names and stable supplied IDs. Codes are not primary keys.
- Published fields are limited to supplied ID, series, supplied code and supplied name/configuration, with a fixed source label and unknown Taiwan-release status. No source workbook mapping, internal IDs, research registry or source-row metadata is published.
- All names/configurations remain provisional. This list does not establish Taiwan official naming, release status, full product/accessory coverage, image identity or specifications.
- No image is inferred or copied onto these rows. Every card has a text placeholder.
- The verified snapshot, evidence policy, translation fields and relations are unchanged from the separate four-basic-bit candidate.

## Runtime

The provisional JSON lives under `data/bey-catalog-pending`, independently of the verified snapshot. Exact SHA-256, byte length, schema, row count, stable sequence and series totals are checked before rendering. Requests are anonymous, same-origin, no-store and reject redirects. Rendering uses `textContent`. Failed loads clear results and offer retry. Selection is lazy-loaded, filters are local, repeated selection does not refetch, and browser Back/Forward restores the selected scope.

The runtime packaging allowlist includes the two new scripts and the exact provisional snapshot. Both snapshots are independently verified before packaging. A cache version bump covers all page scripts and CSS.

## Verification

Run:

- `node --test tests/bey-catalog-pending.test.cjs tests/bey-catalog-public-ui.test.cjs tests/bey-catalog-public-package.test.cjs tests/bey-catalog-public-evidence-policy.test.cjs`
- `node scripts/verify-production-frontend.cjs`
- `node --test tests/bey-catalog-public-browser.test.cjs tests/bey-catalog-pending-browser.test.cjs`

The first two commands passed locally. The pending suite includes actual-script DOM tests, not visual/browser proof. Browser launch in the local restricted executor was blocked by `socket() failed: Operation not permitted`; browser execution and screenshots remain a CI/release gate. The browser suite follows the existing public-catalog launch convention inside the established isolated root CI container; no new container privilege or browser retry in the restricted local executor is introduced. It covers direct navigation, counts, filters, duplicate codes, Back/Forward, retry after network/tamper failure, keyboard controls and 320/375/390px layouts. Production and authentication are not exercised by this isolated suite.
