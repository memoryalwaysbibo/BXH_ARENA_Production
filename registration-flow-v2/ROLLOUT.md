# Multi-room registration rollout

This change prepares multi-room routing. It does not activate or migrate any
production room and does not make V2 the default for newly created rooms.

## Server gates

`createRolloutBindings` accepts the same production dependencies, `pilotRoom`,
`retiredRoom` and `retiredRooms` as the existing pilot factory. The existing
`createPilotBindings` remains available and unchanged as the deployment fallback.

New control document: `systemSettings/registrationFlowV2Rollout`:

```json
{
  "roomCodes": ["BXH-ROOM01", "BXH-ROOM02"],
  "workersEnabled": true,
  "intakeEnabled": false,
  "lifecycleEnabled": false
}
```

The list accepts up to 500 unique valid room codes and excludes retired pilots.
Absent or malformed rollout configuration fails closed for additional rooms.
The existing `registrationFlowV2Pilot` gate continues to control the original
pilot unless it is explicitly listed in the new document. A listed pilot uses
the new gate, including an explicit stop.

Additional rooms must already have authoritative private ownership
`registrationQueueVersion: 2`. The player router now reads the public mirror's
ownership marker for any valid code; server configuration and the queue's
transactional ownership/intake guards still decide whether a submission can
commit. A frontend override never grants server permission.

## Stop intake and preserve accepted operations

Turn `intakeEnabled` off while keeping workers enabled to reject new submissions,
retain actor-scoped status/mine reads, and complete accepted jobs. Removing a
room from the intake list also leaves its accepted work drainable while it is
still V2-owned and rollout workers are enabled. Scheduled recovery filters
retired and legacy rooms before acquiring leases.

This is a stop-and-drain mechanism, not automatic migration back to legacy.
Do not clear ownership while jobs remain pending. Worker disable stops execution;
it is not equivalent to intake disable. Receipt access remains authenticated.

## Production release handoff

Run `tools/capture-rollout-baseline.py` in authenticated Cloud Shell. It captures
generation-pinned source archives and full function configuration privately,
rechecks for concurrent changes, and prints a report containing source hashes,
revisions, bootstrap binding lines and selected gate fields. It performs no
production writes. Share only the report, retaining ZIPs/metadata in Cloud Shell.

Use the fresh checkpoint to prepare source-preserving candidates for all six
exports and wire the production bootstrap to `createRolloutBindings`. Preserve
the verified legacy writers, rules, indexes and original configuration.

Remaining activation work must include authoritative private/public ownership
and roster readiness, trusted room-settings writes, generalizing the frontend
draw/start routing beyond its pilot allowlist, and validating room eligibility.
New-room default routing and existing-room migration are not implemented by
this plumbing PR. Do not describe this change as a full-site switch.

## Validation

`node --test registration-flow-v2/tests/rollout.test.cjs
registration-flow-v2/tests/multiple-retired-pilots.test.cjs
tests/registration-feedback.test.cjs` passes 54 tests locally. The rollout tests
cover simultaneous rooms, closure and receipts, drain after list removal,
worker stops, explicit pilot precedence, malformed configuration, lifecycle
gates, and filtering before real queue lease acquisition. CI also runs the
existing isolated emulator and frontend regression workflows.
