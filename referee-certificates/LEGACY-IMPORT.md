# Owner-approved legacy import

The existing referee administrator page accepts the owner's original JSON plan,
previews its 18 people / 20 batches / 1,966 decisions, and sends each batch through
the existing `refereeCertificateService` `saveBackfill` action. There is no direct
Firestore writer, new IAM grant, backend deployment, or new credential flow.
Only the existing super-administrator view exposes the import controls. Server
authorization remains authoritative on every request.

The accepted file SHA-256 is
`24f9e9c9b0b3c56643a0d1ca4f778088449ed12eb863da33a41fc03a7be43a72`.
The public module contains neither the real roster UIDs nor the private plan.
The selected file stays in the browser; only existing callable entry payloads
are sent. The plan's complete source mapping must be preserved privately.
Do not commit it, add it to Pages, or publish test fixtures containing real UIDs.

The owner explicitly authorized legacy per-account submitted results, including
records not eligible for current native-source recognition. Each unique
UID/tournament/match tuple maps to a stable historical source key. This does not
change the current rules for new native match/event records. Import adds only
decision counts, not event participation, scale milestones, rank, role, or photos.

Before writing, all 18 current snapshots must have the expected active L1
certificates, zero existing backfills and decision/event totals, and complete
snapshots. Each batch rechecks the session, current snapshot and revision. A
stable operation ID, existing server receipts and source claims prevent duplicate
application. A local journal is stored before each write; Web Locks prevents a
second tab running the same import. Errors and ambiguous replies stop the run
without retry. Every confirmed batch and the final roster are read back.

After a stop or reload, the page exposes the saved report and blocks a new run.
Do not clear storage, invent new operation IDs or rerun blindly. Read the server
records/receipts for the reported pending operation first. Automatic resume or
rollback is deliberately not included. The journal key is shared with the earlier
one-time console helper, so its previous attempts also block the page importer.

Known scope limits: historical source keys do not automatically clear the native
pending-log display. Any future automatic counting must exclude the exact tuples
in the retained plan or canonicalize them to these same keys. This import does
not implement that future change and does not reinterpret 244 vs 212 native logs.

Validation: unit/service tests use the existing service with MockDB; browser tests
use a synthetic hash-pinned plan and local transport. They cover 20 batches,
preserved photo/rank/users, wrong files, existing state, storage failure, lost
replies, reload protection and account switching. They do not prove production
execution. Production completion requires the downloaded report to show verified
and subsequent server readback, not just a successful site deployment.
