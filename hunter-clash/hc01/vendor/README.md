# Offline QR dependencies

These assets are loaded only by the isolated HC-01 lab, not ARENA's production index. No external CDN is required for rendering or fallback decoding.

- QRCode.js: https://github.com/davidshimjs/qrcodejs ; qrcode.min.js Git blob `993e88f396640f881b69f98db7a4d17401ef83ca`. Preserve qrcode-LICENSE.txt.
- jsQR: https://github.com/cozmo/jsQR ; dist/jsQR.js Git blob `99ea9df26907009e5553233ffe03c529c1521739`. Preserve jsQR-LICENSE.txt (Apache-2.0).

Source files were retrieved from the upstream default branch on 2026-10-07; the committed blobs pin the exact assets used by this lab.
