# WebP encoder fallback

Vendored from `@jsquash/webp@1.5.0` (npm tarball SHA-1 `1e8ce357cde2decf4f880a8c436f8f1529cd3f48`). Upstream: https://github.com/jamsinclair/jSquash .

`webp_enc.js`, `webp_enc.wasm`, `meta.js` and licenses are unmodified upstream files. `encode.js` is an Arena wrapper selecting the non-SIMD encoder without the upstream feature-detection dependency. Only 256 x 256 RGBA pixels reach this encoder; image decoding remains in the browser. Native WebP browsers never request these files. No CDN or backend format relaxation is required.
