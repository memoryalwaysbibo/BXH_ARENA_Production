# General-room three-seat referee Rules candidate

This is a staging candidate, not a deployment receipt. It is built from the
2026-11-02 09:15:52 UTC production capture (SHA-256
`cc92f06579800bd9dcbd7fca3af36fcbd4a80989f795164ec847b0211fe694a9`).

`python3 -B scripts/build-community-referee-rules.py --check` reproduces it.
The composition adds only seated general-room player single-document reads and
preserves the existing owner's private/public JSON management access when seats
are enabled. Canonical seats, inbox delivery, receipts and audits remain
server-only. No new list or client scoring permission is introduced. All other
captured policy text, including QR/roster and official staff permissions, is
preserved byte for byte. It does not add or enable score buckets.

The older generic October candidate exhausts the Rules expression budget for
the newly tested community owner JSON update. It remains useful only for
isolated guard regression tests; it must not be used for this release. The
captured-live candidate uses the deployed role helper implementation and tests
the positive owner update as part of the dedicated release suite.

The full Rules Emulator suite can load this candidate with
`REFEREE_RULES_PATH=release/community-referee/firestore.rules`; the normal default
continues to test the generic referee/bucket candidate. CI tests both separately.

Before any deployment, read the current `bxh-arena` Firestore release and require
the exact baseline hash above. A newer live policy, including a deployed bucket
candidate, must be reconciled first; do not overwrite it with this capture.
The builder accepts `--source` for a freshly captured file and rejects a different
hash. Keep `communitySeatsEnabled` closed until the actual Callable sources and
Rules are reconciled and authenticated multi-device acceptance is complete.
Frontend publication alone does not activate or verify the backend.

`python3 -B scripts/community-referee-readonly-preflight.py` runs in an already
authenticated Cloud Shell. It reads the current Firestore release, selected
runtime flags and the immutable source generations of `manageRefereeSeats` and
`commitRefereeCommand`, then creates a private local ZIP for reconciliation.
It never deploys, writes Firestore, changes flags or changes IAM. Tokens remain
in memory and environment values are omitted from metadata. This capture has
only been tested with local fake API/CLI responses; it is not live evidence.
