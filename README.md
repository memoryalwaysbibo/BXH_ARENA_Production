# Production Frontend RC1

Target: `bxh-arena` / `arena.bxh.com.tw`

Launch authentication: Email/Password only.

RC1 hardening ensures self-service registration creates `role=player`; active Google OAuth runtime wiring is removed; tester accounts remain managed sandbox accounts only.

Run `node scripts/verify-production-frontend.cjs` before release.

Repository validation: GitHub Actions on `main`.
