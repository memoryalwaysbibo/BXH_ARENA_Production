# Callable and historical settlement emulator qualification

Only demo projects and loopback ports are used. No deployed services or real accounts.
`callable-emulator.json` runs the original referee-seats/functions/index.js (copied
unchanged at test time), including its actual Firebase onCall export and transactional
scoring-service. Auth emulator issues the token used by the Firebase Functions SDK.
The staff role/seat is a synthetic Firestore fixture; the handler performs its own
actual authorization. Anonymous, player and inactive staff calls must be denied.

After a successful callable response, the lab publisher validates and publishes only
S.publicProjection with a strict public schema to the isolated delta emulator. This
publisher remains a lab adapter, NOT the deployed bucket trigger or production bridge.
The actual full-app referee UI is not driven in this new SDK stage. Earlier full-app
spectator UI tests are separate. Do not combine separate passes into a false end-to-end claim.

Settlement is tested directly at createLadderSettlement transaction level, NOT its
onCall requireAdminTier wrapper. Source is an existing recovered historical snapshot,
matching Production qr-checkin/reference/backend-sources-20261016.json:
- generation 1789999963356023; service update time 2026-09-21T14:13:28.975848286Z
- ladder-settlement.js SHA256 3ea58fe50263ed20e2d7fa7e2415d83b44a28b80d75ee84dc05bc515def95d29
- ladder-v1.js SHA256 acc793297324e78cf1a0363d6c63834690a333c7300e9bba798add6418191d11
Both files are checked before executing. This does NOT establish current production parity.
The 96-player fixture uses actual engine wins, plus explicit synthetic semifinal-loser
third/fourth assignments; it does not validate the actual bronze-match workflow.

For actual two-device acceptance, require an authorized isolated HTTPS test frontend and
separate non-production Firebase Auth/Firestore/Functions project, approved test identities,
verified current function/rules artifacts, and actual public delta writer integration.
Do not expose emulator listeners, proxy them publicly or weaken private Site access.
