# General-room three-seat referee release candidate

This is a staging candidate, not a deployment receipt. The authenticated capture
at 2026-11-04 07:40:10 UTC is retained under `referee-seats/reference/`:

- Rules SHA-256: `580da8c9dbde90e936ff7ddd88543b3370ff2f3cd9c27c749b6aecc11802977e`.
- Both referee source archives: `5aadefa74c746c674cd251fe4d532148403646baeda641238ce2f5085612ad48`.
- Existing `enabled`, `perCourtScoringVerified` and `partnerSeatsEnabled` are true;
  `communitySeatsEnabled` is absent, so general-room support remains closed.

## Rules

`python3 -B scripts/build-community-referee-rules.py --check` reproduces the
release Rules. It adds only seated general-room player single-document reads and
preserves existing owner JSON management when seats are enabled. No list or
client scoring permission is introduced. All other captured policy terms,
including the already deployed bucket read/write/delete guards, remain intact.
Within existing shared management fences, the same owner OR terms run first
to stay within the Rules expression budget. Composition tests reverse every
addition and reorder to recover the exact captured policy bytes.
The source hash is mandatory; another live release requires reconciliation.

The generic October candidate exhausts the expression budget for the new positive
community owner JSON-update case. Never deploy that generic artifact. The actual
release uses the current deployed role helpers and tests the owner update via
`REFEREE_RULES_PATH=release/community-referee/firestore.rules`. Generic guard
regressions remain separate from positive release-baseline management acceptance.

## Backend

`python3 -B scripts/build-community-referee-backend.py --check --output /tmp/community-referee-source`
builds an empty local staging directory from the captured immutable archive.
Only five source files change for community access, invitations and handoff.
The original two-export `index.js`, source engine, package and lockfile,
event-staff helpers and bucket fence remain byte-identical to live. It does not
introduce any bucket function exports or the repository's newer scoring engine.
`backend-manifest.json` pins every before/after file hash.

The dedicated CI uses this exact staged source and release Rules for real
Emulator transactions. Set `REFEREE_FUNCTIONS_ROOT` to the staging `functions`
directory when running `referee-seats/firestore.test.cjs`. Tests cover two-court
invitation delivery/acceptance, idempotent retries, main-only player scoring,
confirmed backup handoff, direct official staff assistance, revocation, completed
event rejection and existing official CALL/PASS/dispatch behavior.

## Before deployment or activation

Re-read the current Rules release and both function source generations and
require the recorded hashes. Preserve deployed configuration, IAM, invocation and
App Check behavior. Scope source updates to the two existing referee functions;
frontend publication does not deploy or validate them. Keep community support
closed until matching backend/Rules deployment and authenticated multi-device
acceptance are complete. QR invitations are not implemented by this candidate.

The readonly Cloud Shell capture tool is
`scripts/community-referee-readonly-preflight.py`. It never deploys, writes
Firestore, changes flags or changes IAM. Tokens stay in memory and environment
values are omitted from metadata. The uploaded November 4 capture is actual live
read evidence; the tool's local regression tests use fake CLI/API responses.
