# M6-1｜Account / Titles / Check-in / Personal UI CSS Tail

Production baseline:
- main `98149c2323bf1c245241e1a1bdf29e8b3b84d7da`
- index blob `be7af1a9c461bef0784b12a36e972b8dd36627a0`
- index 2,367,473 bytes
- remaining inline main CSS 282,883 bytes

Boundary:
從 `/* ==== v13.29.0 稱號與每日簽到（與賽事報到完全獨立） ==== */` 到主 inline style 結尾，共 12,646 bytes。

Scope:
- titles / daily check-in
- shared player/admin header and navigation geometry
- cloud tournament narrow refresh label
- confirmation dialog layering
- compact personal schedules / rooms
- super-admin accounts / check-in / titles
- 4 media queries / 1 keyframe / 0 url()

Safety:
- M6 stylesheet 必須在 M5、M4、M3 外部 override 之前，保留原 cascade precedence。
- exact re-inline 必須重建 baseline index blob。
- 不碰前面的 BXH CALL / tournament CSS。
- 不整理 selector、不改動畫、不改產品行為。
- Desktop / iPhone / Android browser contract + Production verifier + critical regression。
- final-head 全綠才 merge；merge 後 Production + Deep E2E。
