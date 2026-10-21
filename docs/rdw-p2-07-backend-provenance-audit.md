# RDW P2-7 — Production backend provenance audit

Status: **blocked for production integration; no deployment authorized**.

## Evidence located in this repository

- `qr-checkin/runtime-source-parity.json` lists `courtCallService` with source generation `1791430757530820` and **no verified source match**.
- `qr-checkin/reference/backend-sources-20261016.json` contains a reference inventory for `courtCallService` and `enchantmentService`. An inventory is not a verified byte-for-byte match with the currently deployed backend.
- `qr-checkin/backend/firestore.emulator.test.cjs` exercises a court-call writer fixture; fixture success does not establish the deployed source or authorize a new RDW write.
- `docs/validation/court-retirement.md` documents separate court-call and enchantment deployments and warns against replacing production service sources with an older bundled copy.

## Release-blocking verification

1. Obtain the deployed Cloud Functions service metadata and immutable source artifact for the **current** production `courtCallService` and any match-start owner. Check project, region, function revision, source generation, hash, and permissions.
2. Compare the artifact against the reference source, and identify the exact authenticated start/dispatch transition for official standard matches. Do not use the enchantment `start` operation as a substitute.
3. Identify canonical event/match/revision, roster identity, trusted current-tier storage and read rules. Preserve a strict server-owned write boundary.
4. Emulator-test the actual deployed handler with RDW disabled/enabled in a controlled fixture; verify cancellation, replay, idempotency, unauthorized access, and no mutation of lifetime award ledgers.
5. Until the above pass, keep PR #557 Draft, shadow-only, unmerged and undeployed.

## Important distinction

Reference inventory and prior deployment validation are not proof of parity with today's running function. No production snapshot writes have been attempted in this work.
