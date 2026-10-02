# M4-1｜Main CSS Tail Modules Pilot

狀態：正式 main 基準上的 M4 第一刀規格；尚未修改 index.html。

## Production baseline
- main: `100a8aa4c5c43e20374aab6548737e75a7f877dc`
- index blob: `99ab90be16347904f050c11ee7086cf11d367620`
- index bytes: 2,381,048
- remaining inline main CSS: 296,664 bytes
- main CSS contains 134 media queries / 27 keyframes / no url()

## M4-1 boundary
從主 CSS 尾端註解：
`/* P7.12.1: top-layer navigation avoids clipping inside fixed-height cards. */`
一路到該 style 結束，共 4,239 bytes。

內容只涵蓋：
1. venue navigation dialog / address row
2. AI poster scoped controls
3. AI review validation target

邊界內：1 個 media query、0 keyframes、0 url()。

## Safety model
- 保持原 cascade 順序：外部 stylesheet 必須插在原 style 尾端之後、mobile-overrides link 之前。
- exact re-inline 必須重建 production index blob 99ab90be...
- 不改 selector、不整理 CSS、不合併規則、不改變數。
- 不碰前 292 KB 主 CSS、不碰 inline JS。
- Desktop / iPhone / Android computed-style smoke。
- Critical regression + Production verifier。
- 候選全綠後才 merge main，merge 後再跑 Production + Deep E2E。
