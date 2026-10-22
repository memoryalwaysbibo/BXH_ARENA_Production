# RDW P3-13 — Hunter 2.1 authoritative current-tier source audit

Status: **source not yet proven**; no production writes or deployment.

## Observed contracts

- `modules/cloud/cloud-runtime.js` exposes `syncHunterLicenseV21()` through an engagement callable.
- `modules/main-app/hunter-license-v21.js` checks `version: hunter-license-v2.1`, statuses, `current.tier`, `highestTier`, `awarded` for display.
- `docs/hunter-license-v21.md` explicitly distinguishes frontend historical replay from server-issued lifetime awards and describes phased backend follow-up.
- Existing RDW source adapter requires a server-verified current tier with matching UID, version, source, and timestamp. This is a *proposed* contract, not proof those fields currently exist in Firestore.

## Blocking verification

1. Locate the deployed `syncHunterLicenseV21` backend implementation and current production revision.
2. Identify the canonical server-owned persisted current-tier document and whether it includes source verification, computation time, and version.
3. Verify UID identity resolution for normal registrants and guardian/family registrations; never infer child tier from guardian UID.
4. Confirm whether the callable writes lifetime highest only or also current tier. Do not infer from UI display.
5. Until verified, keep RDW tier sealing disabled and allow RDW-only PASS only after separately verified start authorization and roster safety.

## Important safety note

No amount of CI passing on mocked tier objects proves a real authoritative current-tier source. Do not merge or deploy a claimed functional RDW start flow until the deployed backend source and Firestore paths are checked.
