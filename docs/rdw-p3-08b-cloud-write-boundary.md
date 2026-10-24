# RDW P3-8B — Verified cloud write boundary and safe integration gate

Status: investigation complete; **no production UI hook or backend deployment**.

## Verified source path

- `modules/main-app/core.js` handles `start-tournament`, updates `startedAt` and calls `saveState()` after roster/bracket rechecks.
- `saveState()` calls `enqueueCloudStateWrite(code,snapshot,{bracketStartSignature})`.
- `enqueueCloudStateWrite()` calls `window.cloudSync.pushUpdate()`.
- `modules/cloud/cloud-runtime.js` implements `pushUpdate()` using client Firestore `fx.runTransaction(dbHandle,async tx=>...)` and reads `tournaments/{code}`.
- The transaction checks `registrationRosterRevision`, `callRevision`, bracket signature, dispatch revisions and completed results, and writes private/public mirrors.

## Critical trust boundary

The existing Firestore transaction is **client initiated**. It is not a trusted backend tier resolver. Attaching an RDW snapshot payload to this transaction would allow client-provided tier assertions and violate the agreed server-only snapshot contract. Do not do this.

## Required next implementation

1. Implement a new authenticated server-side `rdwStartService` (separate from court-call and enchantment services), feature flag OFF by default.
2. Verify organizer authorization, canonical roster UID mapping and draw revision against current Firestore state. Resolve current Hunter License tier from the authoritative backend, not from UI or lifetime highest award.
3. In one server-side transaction, create a tournament baseline (or append-only RDW-only PASS audit) and commit the start state. Maintain existing private/public mirror and bracket revision invariants; do not let legacy client `pushUpdate` overwrite the server result.
4. Frontend `start-tournament` should call the new service only when the feature flag is enabled; otherwise preserve the existing `saveState()` path. On unknown response read back server state before retry/PASS.
5. Validate 8-player and 32-player emulator fixtures, concurrent starts, stale roster, no UID, failed tier resolution, PASS, idempotency and unchanged lifetime awards.
6. Only after backend implementation, rules verification and CI/E2E should the owner be asked to authorize a production release. Do not merge PR #557 yet.

## Safety note

The current P3-5 `rdw-atomic-start-reference.cjs` is a **reference**, not a production callable. It must not be imported directly into browser code as proof of server-side trust.
