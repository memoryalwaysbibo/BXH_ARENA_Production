# Read-only activity trigger digest diagnosis

This helper makes one authenticated Function GET for
`trackTournamentRegistrationActivity` in `bxh-arena/asia-east1`.
It does not read Firestore documents or change a trigger, deployment, IAM,
regional policy or runtime gate. No file is downloaded or uploaded by the helper.
It prints only identity, timestamp, digests and comparison flags, never raw
configuration, environment values, credential values or server messages.

The two previously observed GET digests differ despite identical update times
and matching build/service hashes. That does not prove a routing change.
The helper computes every permutation of the current `eventFilters` array,
keeping every other trigger field/value intact. It reports `FILTER_ORDER_ONLY`
only if BOTH recorded GET hashes occur among those permutations and the current
build/service configuration hashes still match the follow-up. Unexpected shapes,
more than eight filters, trigger objects larger than 8 KiB, config changes and unmatched trigger hashes stop without
declaring reconciliation. This compares exact serialized objects; it does not
normalize or conceal changes to any other field or filter value.

Run in authenticated Cloud Shell with the active project `bxh-arena`:

```sh
python3 -B bucket-trigger-order-readonly.py
```

Return the printed JSON even if the helper exits nonzero. No report ZIP is
required. A positive result resolves this particular digest-comparison question,
not writer completeness, Eventarc delivery, real Auth/App Check or production
release acceptance. All release gates remain separate.

Offline checks:

```sh
python3 -B tests/four-court-buckets/trigger-order-readonly.py
```
