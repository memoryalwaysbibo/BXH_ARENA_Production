# Isolated full application integration qualification

This is test-server-only code, NOT a production release. `full-app-injection.cjs`
rewrites only the explicit public join branch and inserts route context reporting
into the actual core `render()`. Original repository runtime files remain unchanged.
Private/referee `subscribe` and shared global subscription cleanup are not replaced.

Target is synthetic 96 players / 6 courts, general mode, no real points.
Two separate loopback-only projects are deliberate:
- `demo-bxh-arena-e2e`: existing full-app Firestore/Auth harness and public initial room
- `demo-arena-public-delta`: existing narrow public delta schema/rules, no private documents

The fixture user is generated only in Auth emulator and then signs in through the
real app UI. The watch-entry button is synthetic, dispatching the existing production
`switch-to-player-watch` handler, which performs actual room resolution and rendering.
Commands execute the real scoring engine on the test host and publish only synthetic
public views. They do NOT test the production callable/referee request transport.

The browser has its Chromium sandbox enabled on official hosted Google Chrome.
Production Firebase/Cloud Functions/Cloud Run requests are aborted and fail the test.
No localhost safety checks are weakened, no emulator exposed, no hosting created.

Pagehide/pageshow coverage is synthetic desktop-browser lifecycle, not real handset
suspension. No mobile-accessible acceptance endpoint is provided by this work.

Further gates: complete official referee callable/Auth/registration route integration;
real device/network/bfcache behavior; actual current production baseline comparison;
separate authorized isolated staging host/backend before phone acceptance.
