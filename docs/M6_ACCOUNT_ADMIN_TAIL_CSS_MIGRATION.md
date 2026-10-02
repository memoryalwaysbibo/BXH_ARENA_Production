# M6-1｜Account / Admin UI CSS Tail

Baseline: main 98149c2323bf1c245241e1a1bdf29e8b3b84d7da; index blob be7af1a9c461bef0784b12a36e972b8dd36627a0; index 2,367,473 bytes; remaining inline main CSS 282,883 bytes.

Boundary: from `/* ==== v13.29.0 稱號與每日簽到（與賽事報到完全獨立） ==== */` to the end of the remaining inline main style: 12,646 bytes; 4 media queries; 1 keyframe; 0 url().

Scope: title/daily check-in UI; shared player/admin header and navigation geometry; cloud tournament narrow UI; confirmation dialog layering; compact personal schedules/rooms; super-admin accounts/check-in/titles pages.

Safety: M6 stylesheet must precede M5, M4 and M3 extracted override styles so later cascade precedence is unchanged. Exact re-inline must reconstruct baseline index blob. No selector cleanup, no product behavior changes. Three-size Chromium + Production verifier + Critical Regression; final-head CI before merge; Production + Deep E2E after merge.
