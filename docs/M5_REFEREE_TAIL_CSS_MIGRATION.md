# M5-1｜Referee / Live Link / Mobile Header CSS Tail

Production baseline:
- main `c0f25033b31ebbb73c31861a19fc9c1842359d9a`
- index blob `32635b55c812f03bbd2f804bdec0b7114679042c`
- index 2,376,908 bytes
- remaining inline main CSS 292,425 bytes

Boundary:
從 `/* Referee UX v2: fixed left / swap / right layout, including phones. */` 到主 inline style 結尾，共 9,542 bytes。

Scope:
- Referee UX v2
- LIVE LINK count / connection block
- compact mobile header tail overrides
- 6 media queries
- 1 keyframe
- 0 url()

Safety:
- 外部 M5 stylesheet 必須保持在 M4 tail stylesheet 之前，M4/M3 後續 overrides 繼續擁有較高 cascade precedence。
- exact re-inline 必須重建 baseline index blob。
- 不整理 selector、不改動畫、不改產品行為。
- Referee desktop + iPhone + Android computed-style / animation contract。
- Critical regression + Production verifier。
- final-head 全綠才 merge main；merge 後 Production + Deep E2E。
