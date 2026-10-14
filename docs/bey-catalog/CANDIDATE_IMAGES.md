# Pending inventory candidate images

The 285-row supplied inventory is unchanged. Its separate candidate-image manifest contains 222 provisional pairings: 202 exact-variant research candidates and 20 same-product references. 63 rows remain image placeholders. `exact_variant` is a research pairing classification, not owner approval. No pairing confirms a Taiwan official name, release status, specification, eligibility, or official catalog record.

The manifest is pinned by SHA256 and byte count in `catalog-candidate-policy.js`. Current digest: `36061318cf77a96c7e68d7c8c26b5429e26eec64136d1244ca2f0e9407599118`, 137570 bytes. It references 215 distinct local WebP assets. Each record binds its original stable supplied ID, local image hash, original image hash, source page and original source image URL. The strict schema rejects unknown fields, unrecognized IDs, duplicate IDs, unexpected URLs, external image paths, and pre-confirmed statuses.

All sources and assets require offline review before being added to the compiled exact allowlist. `scripts/prepare-bey-catalog-candidates.cjs <manifest> <source-allowlist> <asset-root>` validates local inputs and generates the pinned policy and local snapshot. It does not fetch, publish, deploy or approve images. `scripts/package-bey-catalog-public.cjs` packages only the explicit runtime allowlist and verifies candidate-manifest and image hashes before output. Research notes and local review histories are not included.

The public catalog has no review mutation controls, login integration, cloud storage writes, or effective owner approvals. Actual 核實 / 錯誤 controls require a separately approved persistence/authorization design. Future review decisions must bind inventory SHA256, stable record ID and SHA256 of canonical candidate JSON; replacing an image, source or pairing claim must invalidate an older decision.

## UI behavior

- Lazy-load the candidate manifest only after the pending inventory loads. Candidate images have `loading=lazy` and a reserved display height.
- Candidate failure leaves the original 285 searchable rows usable, with independent image retry.
- Exact-variant candidate caption: `候選配圖 · 圖片與款式待核實`.
- Product-reference caption: `同商品參考圖，尚未確認本款配置`.
- Each figure includes the exact reviewed public source-page link.
- A broken image is hidden and replaced with an explicit loading-failure caption; it never becomes verified.
- Search, repeated view switches and history navigation preserve stable rows and do not repeatedly fetch a successfully loaded manifest.

## Rights attribution

Each asset's source page remains linked. Rights belong to the original holders; this catalog grants no reuse rights. The footer quotes the official BX-01 notice specifically, without applying it as the sole notice for every product:
https://beyblade.takaratomy.co.jp/beyblade-x/lineup/bx01.html

Original notice: ©Homura Kawamoto, Hikaru Muno, Posuka Demizu, BBXProject © ＴＯＭＹ.

Other products, including revival products, may have additional notices at their individual source pages. No claim of site-wide permission or ownership is made. Collaboration candidates excluded from the reviewed manifest are not silently assigned generic imagery.

## Verification

- 163 Node unit/package tests pass across candidate, pending, public UI, public packaging and evidence-policy suites.
- `node scripts/verify-production-frontend.cjs` passes.
- All 215 local WebPs were decoded with Pillow; maximum dimensions are 900 × 709.
- Browser suite has added candidate pinning-failure/retry, failed-image and product-reference cases. Browser execution is pending permitted CI; local Chromium was not launched.
- Existing published snapshot, UX18 imagery, four bit images and raw pending inventory remain unchanged.

Additional source-scoped notices are rendered directly on the matching revival-product figures:
- Driger Slash: ©青木たかお・ベイブレードプロジェクト. https://beyblade.takaratomy.co.jp/beyblade-x/lineup/bx00-drs.html
- Lightning L-Drago: ©Takafumi Adachi, MFBBProject, TV Tokyo. https://beyblade.takaratomy.co.jp/beyblade-x/lineup/bx00-ld.html

Both additional notices were verified against the official product pages on 2026-10-14.

- Rock Leone and Storm Pegasis: ©Takafumi Adachi, MFBBProject, TV Tokyo. Source pages: https://beyblade.takaratomy.co.jp/beyblade-x/lineup/bx00-rl.html and https://beyblade.takaratomy.co.jp/beyblade-x/lineup/bx00-sp.html
- Storm Spriggan and Xeno Xcalibur: ⒸHiro Morita, BBBProject, TV TOKYO. Source pages: https://beyblade.takaratomy.co.jp/beyblade-x/lineup/bx00-ss.html and https://beyblade.takaratomy.co.jp/beyblade-x/lineup/bx00-xc.html
These four additional notices were also independently verified against the official source pages on 2026-10-14. The exact source-page mappings cover all seven affected supplied rows, without changing the manifest.

## Manual image handoff

Every supplied card, including existing candidates and image placeholders, has a native expandable `手動補圖` section. It explicitly states that this page does not upload or store images. The owner can send a photo and the copied template to 小黑 in the existing conversation. The template binds the original supplied ID, exact supplied code/name and current candidate image hash when present, and asks for matching variant/color, source and ownership/permission details. Duplicate codes retain separate IDs.

The page contains no file picker, upload form, database mutation or authentication path. Copy uses the browser clipboard only after the user's click. Clipboard failure selects the read-only template and tells the user to copy it manually; it never falsely reports success. If selection is also unavailable, the text stays visible and instructions explain manual selection. Repeated clicks are suppressed while a copy is pending. Native details and labeled textareas support keyboard use.

Browser CI now includes successful copy, denied clipboard fallback, duplicate-code templates, read-only/no-file-input checks and an assertion that no non-GET requests occur. Four bounded image screenshots plus a manual-handoff screenshot are captured only after the appropriate content is ready. Browser execution remains pending CI.
