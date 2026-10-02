# M6-1｜Identity / Daily Check-in / Admin Tail CSS

Production baseline:
- main `98149c2323bf1c245241e1a1bdf29e8b3b84d7da`
- index blob `be7af1a9c461bef0784b12a36e972b8dd36627a0`
- index 2,367,473 bytes
- remaining inline main CSS 282,883 bytes

Boundary:
從 `/* ==== v13.29.0 稱號與每日簽到（與賽事報到完全獨立） ==== */` 到目前 inline main style 結尾，共 12,646 bytes。

Scope:
- title / daily check-in identity UI
- shared player/admin header geometry
- cloud tournament narrow refresh
- confirmation dialog stacking
- compact personal schedules / rooms
- super admin management pages
- 4 media queries / 1 keyframe / 0 url()

Cascade:
remaining inline main CSS -> M6 identity/admin -> M5 referee -> M4 P7 -> M3 mobile overrides.

Safety:
exact re-inline, immutable digest, Production verifier, critical regression, Desktop/iPhone/Android browser gates, final-head CI, merge-main Production + Deep E2E.
