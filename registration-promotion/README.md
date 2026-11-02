# Seat-enabled official registration promotion

The seat runtime guard permits browser writes by administrators and the official creator only. A non-creator assigned staff member can read registrations but their ordinary promotion transaction is rejected when it updates runtime JSON. The previous budget repair does not remove this guard. Reproduced with synthetic 80 confirmed / 1 waitlisted / capacity 88: no seats succeeds, seat-enabled non-creator fails, seat-enabled creator succeeds.

promoteSeatedRegistration accepts only room code, registration ID, explicit 0/8 capacity expansion and an idempotency key. It reads current account, assignment, room, public mirror and registration inside one transaction, then commits registration, both counts, sanitized public roster and QR/lifecycle fences together. It preserves seat/score data and existing check-in state. Player, disabled/test/frozen, unassigned staff, started/archived/draw-managed rooms and forged runtime payloads are denied without partial writes.

Scope: official, individual, seat-enabled non-partner rooms. Other rooms keep their existing routes. No Rules changes, historical membership repairs or live fixture writes.

Frontend onsite guest addition also waits for the save result before showing success; known permission/stale rejections remove only the IDs introduced by that operation.

Recovery: a session journal keeps the operation ID per account/room/registration/expansion across refreshes. Unknown results trigger a consistent read-only server transaction. A completed promotion syncs without another write; changed data requires cloud sync followed by explicit intent-only retry. Offline verification offers recheck or return and retains the intent. Cancelled/locked events and inconsistent mirrors cannot be overwritten. Superseded receipts require reconciliation. No whole-runtime force overwrite is offered.

Validation: 26 local Firestore Emulator service cases; 44 frontend/recovery and existing roster cases, plus four reviewed Rules guard cases. Synthetic data only. Response loss and read failure are injected in tests; physical-device network throttling is not yet verified. Local emulator v1.19.8; remote CI uses its own installed emulator. Production-room history has not been read or altered.

Release order: deploy only functions:registration-promotion using this directory's firebase.json, verify the exported callable is ACTIVE and rejects unauthenticated requests, then publish the frontend. The backend package is mirrored into BXH_ARENA_Functions_Production/release/registration-promotion for the deployment repository. Do not deploy historical referee-seat Rules or re-enable any release flags.
