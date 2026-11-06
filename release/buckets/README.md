# Closed bucket release: live Rules reconciliation

The deployed Rules captured at 2026-11-02 09:15:52 UTC have SHA-256
`cc92f06579800bd9dcbd7fca3af36fcbd4a80989f795164ec847b0211fe694a9`.
The exact baseline is retained under `referee-seats/reference/`.

`scripts/build-bucket-release-rules.py` adds bucket read/ownership and deletion-lease guards
from the reviewed #687 candidate plus the deletion lease review, preserving unrelated live policy text.
It refuses another baseline. This release keeps the live QR check-in guard,
staff roster mutation branches and current role helper implementation.
The public delete guard permits an orphan, unmarked community mirror to retain
its existing owner-authorized deletion path while rejecting marked room deletes.

The real local Emulator test checks both the captured live policy and candidate
for ordinary host/admin management, denied direct referee/player score writes,
seat ownership and orphan community mirror deletion. Candidate-only cases
check staff-only single bucket reads, revoked/test/anonymous reads, list/write
denial, legacy root/mirror writes and deletion, private receipts/audits/backups,
manifest/metadata tampering and the closed read flag. The test uses only an
unsigned Emulator token and fixed loopback demo endpoints; no production calls.

The later Cloud Shell deployment receipts confirm three closed bucket functions,
Rules with hash `580da8c9dbde90e936ff7ddd88543b3370ff2f3cd9c27c749b6aecc11802977e`,
two legacy referee guards and twelve registration/maintenance writer guards.
Bucket runtime remained false and no room activation was performed. Those
receipts cover the named functions only, not a complete Admin writer inventory.

The deletion lease candidate adds root/public write/delete fencing to that
Rules baseline. Its hash is
`3b225ddc8121ffdce95062c4ea230f24882887e7768cd445f876e4484d212101`.
See [deletion/README.md](deletion/README.md) for pinned sources, tests, deployment
order and operator recovery limits. This candidate is not yet deployed.

This directory is a reviewed staging candidate, not a deployment receipt.
Before publishing Rules, re-read the live Rules and require the captured hash;
any difference requires reconciliation. Do not overwrite live Rules with the
older generic `referee-seats/firestore.candidate.rules`. Deploying closed
backend definitions is separate from enabling runtime gates or migrating rooms.
Production mixed-version, App Check, full operation coverage and controlled
cutover/rollback acceptance remain required before activating a room.
