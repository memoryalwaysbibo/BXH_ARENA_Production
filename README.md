# Production Frontend RC1

Target: `bxh-arena` / `arena.bxh.com.tw`

Launch authentication: Email/Password only.

RC1 hardening ensures self-service registration creates `role=player`; active Google OAuth runtime wiring is removed; tester accounts remain managed sandbox accounts only.

Run `node scripts/verify-production-frontend.cjs` before release.

Repository validation: GitHub Actions on `main`.

## Ladder V1 — build 20260921.12

Shared scoring lives in `ladder-v1.js`. For official ranked events the browser now sends only the event code to `settleLadderTournament`; the trusted backend reloads the saved tournament, recomputes V1 points, validates the official roster, and commits every player award plus the event marker atomically. Previously settled events retain their original points and retries cannot award twice. Test-ladder settlement remains isolated in the browser flow.

- Participation: 10 points after an actual completed match; placement bonus requires an actual win. Byes and explicit no-shows do not count.
- Placement bonuses: 90 / 60 / 40 / 30 / 20 / 10 for champion / runner-up / third / fourth / top 8 / top 16. Top 32 / 64 / 96 / 128 bonuses are 8 / 6 / 4 / 2, requiring respectively more than 64 / 96 / 128 / 160 effective entrants.
- Multipliers interpolate linearly between 16:1, 32:1.5, 64:2, 128:2.5, 256:3, 512:3.5. Below 16:1. Round only the weighted placement bonus, then add participation points.
- Tiers start at 0 / 1 / 100 / 300 / 600 / 1100 / 1800 / 2800. BXH Legend additionally requires global rank 10 or better under the existing tied-ranking policy.
- Onsite guests can contribute actual participation to event size without receiving account points. Explicit test identities do not contribute to official size.

Run `node --experimental-vm-modules tests/ladder-v1.cjs`, `node tests/ladder-settlement.cjs`, and `node scripts/verify-production-frontend.cjs`. Tests cover scoring through 512 entrants, script syntax, and the code-only callable trust boundary. Backend tests separately cover server-side scoring, duplicate protection, S0 isolation, roster validation, and atomic failure. No test points are written to production by these tests.
