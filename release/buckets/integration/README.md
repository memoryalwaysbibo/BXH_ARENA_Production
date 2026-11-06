# Integrated bucket candidate — rollout remains closed

This branch assembles reviewed candidates #707, #709, #711, #712, #713,
#714, #715, #717 and #718 on selected main
`0471069df5a09a433c4c945aed119004043d82b6`. The exact component heads,
merge bases and resulting component-file Git blob hashes are recorded in
`manifest.json`. This is an integration review, not a deployment archive or a
replacement for the component source/configuration provenance requirements.

Three frontend files overlap. Their integration keeps main's #716 offline
confirmation recovery and combines deletion-operation persistence (#707) with
certified bucket settlement (#714). The main core was reconstructed and checked
against its exact Git blob before component hunks were applied with unique
context. Script URLs preserve every current-main query value, append component
cache parameters and load the settlement module after the bucket browser and
before the application. The integration verifier pins these resolutions.
Component bytes and subsequent integration updates are pinned by the manifest,
with explicit resolutions for refreshed sources and test fixes. Unrelated main
files remain inherited from the selected base tree.

Local verification on this combination passed the backend package
provenance checks, the component Node suites, the settlement UI suite and main's
offline wiring gate. Browser checks passed 20 full-host deletion scenarios,
24 actual integrated settlement/backend handoffs and 11 offline confirmation
scenarios. Another 24 activity bridge scenarios consume the actual settlement
handlers from this same checkout, rather than fetching independent PR copies.
These boundaries use synthetic accounts/Firebase transport/business clocks;
real Chromium and backend business handlers do not constitute real Auth,
App Check, Storage, Eventarc or live production timing acceptance.

The new integration workflow verifies all pinned hashes and runs those same-checkout
bridges and browser regressions. Existing component workflows also run against
the integrated tree for their native SDK/Rules/Emulator suites. The component
workflows' separately pinned bridge checkouts remain useful component evidence,
but the dedicated integration job is the same-checkout composition evidence.

This candidate does not establish writer completeness. Remaining regional and
non-Functions Admin writer classification, derived consumers, usable bucket
staff mutation paths, source/configuration drift readback, authenticated browser
and six-court multi-referee cutover/rollback acceptance remain open. Some guarded
legacy operations intentionally refuse bucket mutation and need an accepted
bucket-aware workflow before rollout. Do not equate a passing fence with feature
usability or promise production capacity from fixture/Emulator throughput.

No main merge, backend/Rules deployment, runtime flag or room activation is
performed by this branch. Keep production rollout gates closed. A later release
must use the controlled per-target source-only plan and reconciled current live
Rules, preserving unrelated configuration and permanent awards.

## Writer metadata discovery

`scripts/bucket-writer-discovery.py` lists Functions across all regions and
Cloud Run services/jobs in every discovered supported region. Its offline
boundary checks run in the integration workflow. This prepares the missing
cross-region inventory; it does not classify source code, inspect IAM or establish
writer completeness. See `scripts/bucket-writer-discovery.md` for the exact
read-only scope and Cloud Shell procedure. The report never enables a release.

## 2026-11-06 main reconciliation

The selected main now includes the opt-in registration V2 code and recovery UI,
ranked real-name restriction and updated client cache keys. All27 changed main
paths are carried into the two-parent candidate merge. Core and cloud runtime
merged cleanly; independent comparisons preserve the exact added/removed lines
from both branches. Two index conflicts were script URLs: retain every current
main query value and append the candidate deletion/settlement tokens. All92 main
script mappings and settlement module order were checked.

Local client recovery/name-policy tests pass28 cases; core/cloud syntax checks
pass. The existing V2 isolated Emulator workflow supplies its native queue/wave
validation in CI; it was not run locally without a loopback Emulator. Its client
opt-in and server rollout gates remain as main defines them. This source merge
does not perform a deployment, turn on V2/bucket room gates or satisfy fresh
production source/configuration and operator acceptance.
