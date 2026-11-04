# Official match title event candidate — closed rollout

The captured deployed `onLadderTransactionCreated` source archive is SHA-256
`77c7522073f37fa4ef05f8c181dfc02b31334325f785c08b5fef1e518fce7723`.
Its official ranked event path references an undeclared `state`, so it fails
before creating `playerEventResults` and updating `playerStats`. The fixture
retains the exact selected deployed `index.js`; `index.patch` changes only that
file. The ten local checks reproduce the failure and cover the proposed path.

The candidate reads the committed room state after settlement. The bucket
settlement candidate materializes canonical matches into the private root
`data` in the same transaction as its `ladderTransactions` records. Bucket
events additionally require the completed settlement certificate, matching
bucket epoch, original room creation timestamp, completion timestamp and the
canonical state digest. The private root and materialized state must both be
archived, with a completed settlement phase. Partial bucket markers
and active migration/deletion markers fail closed. Reused room codes and
unfinished bucket settlement cannot create a derived result. Legacy ranked
events retain their existing eligibility and award policy.
The player-result transaction reads the current bucket room and registration
again, then checks its receipt and digest before writing. A changed room skips
both player statistics and title evaluation for that event attempt.

This is source review, not a production fix. Before updating only
`onLadderTransactionCreated`, re-read its live source and complete function
configuration, require exact baseline identity, overlay the single patch on
its own current archive, preserve all other files and configuration, and
read back the result. A stale or different source needs reconciliation.
The prior event path may already have missed results; do not replay arbitrary
logs or backfill production data without a separate identity-bound plan.
Run real Auth/Eventarc, ledger-to-result, six-court settlement and rollback
acceptance before enabling a bucket room. Nothing here deploys or activates it.

Local checks: `python3 -B tests/four-court-buckets/derived/verify-package.py`
and `node tests/four-court-buckets/derived/probe.cjs`.
