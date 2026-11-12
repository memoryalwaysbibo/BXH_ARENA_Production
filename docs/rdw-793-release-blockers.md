# RDW #793 — Release blocking evidence (2026-11-12)

Scope: **Hunter License 2.1 shadow-only**, no V1 ladder scoring, XP or permanent-award writes.
Integration PR: #793. Source PR: #557.

## Evidence actually available
- CI run 43150982474: the **synthetic** RDW Firestore Emulator transaction test passed in Critical E2E.
- RDW eight-tier shadow logic, ungraded neutral behavior, snapshot/identity guards and no-output-write invariants have automated tests.
- In-memory and Emulator tests use injected synthetic `createReader`, not the actual deployed `syncHunterLicenseV21` reader.
- No RDW deployment, callable registration, or production start hook is part of #793.

## Hard blockers — do not merge/enable as a production RDW feature yet
1. Obtain the **actual deployed** Hunter 2.1 `reader.cjs` and its verified dependency bundle with immutable digests and matching deployed generation. The old #557 audit documents refer to generation `1792487233621570`; revalidate against current runtime, not a historical ZIP.
2. Review `createReader({db})` **transitively** for writes and grant-service calls. The current bridge supplies a read-only **transaction facade** to `evaluateInTransaction`, but construction still receives the full Admin Firestore `db`. Thus the facade alone **cannot guarantee read-only behavior**: `createReader` could write through a retained `db`. A verified pure reader, least-privilege read-only service identity or a trusted isolated read API is required; do not call this end-to-end grant protection.
3. Confirm canonical Hunter identity mapping in real registration and family cases. Guardian UID is never a substitute for the child's identity; virtual players are not verified accounts.
4. Implement and verify **server-sealed** pre-event tier snapshots. The current `rdw-hunter-match-shadow.cjs` only assembles an **ephemeral candidate pair**, which must never be called a persisted verified baseline.
5. Run real-source Firebase Emulator end-to-end cases (normal, ungraded, family/guardian, absent/stale history, duplicates, concurrency and retry) and compare all affected permanent award/audit, XP and V1 ladder records before and after.
6. Check latest PR HEAD CI, code review, rules/IAM and operational rollback; get explicit owner approval before merging or deploying. Keep runtime flag OFF throughout.

## Release decision
**BLOCKED.** Passing synthetic tests is necessary but insufficient. Do not copy old #557 start-service or partner quota components into #793 merely to unblock this gate; those are separate behavior changes.
