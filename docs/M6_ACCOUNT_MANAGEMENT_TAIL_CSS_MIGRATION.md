# M6-1｜Account / Titles / Personal Management CSS Tail

Production baseline:
- main: `98149c2323bf1c245241e1a1bdf29e8b3b84d7da`
- index blob: `be7af1a9c461bef0784b12a36e972b8dd36627a0`
- index: 2,367,473 bytes
- remaining inline main CSS: 282,883 bytes

Boundary:
從 `/* ==== v13.29.0 稱號與每日簽到（與賽事報到完全獨立） ==== */` 到主 inline style 結尾，共 12,646 bytes。

Scope:
- titles / daily check-in
- shared player/admin header geometry
- cloud tournament narrow-screen refresh label
- confirmation dialog stacking
- compact personal schedules / rooms
- super admin management pages
- 4 media queries / 1 keyframe / 0 url()

Cascade:
remaining inline CSS → M6 account-management tail → M5 referee tail → M4 P7 tail → M3 mobile overrides.

Safety:
exact re-inline to baseline blob; no selector cleanup; no animation edits; three-size Chromium; Production verifier; Critical Regression; final-head CI; merge main; Production + Deep E2E.
