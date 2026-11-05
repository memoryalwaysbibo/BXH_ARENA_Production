# Writer discovery readback — partial, rollout closed

Source: user-supplied `bxh-writer-discovery-gljh8z5i.zip`.

- ZIP SHA-256: `0f91a3155b9afcaab30d37d9256e9875bcd92fef8559337bf3de56dca4114eee`
- Report SHA-256: `88f19f67186a2e68244bcf260c082116d3e8d8473781421c61da397a0c73df5d`
- Tool SHA-256: `2da9cdb914adbc4707b543dca9666bd7c7c0a8d7c19133415fd3844d2fcaf1ad` (matches pinned c823ffa helper)
- Observed 2026-11-05 07:06:52–07:08:46 UTC (15:06:52–15:08:46 Taiwan).
- 43 discovered supported regions; no Functions-list unreachable entries.
- 158 Functions, all in asia-east1; 157 listed Run services, all in asia-east1.
- Every listed Run service has a matching Function link. No unlinked service
  was found in the successful listings; this is not evidence about failed scopes.
- One Function, `observeNumberAccount`, has v1/v2 views and no Run-service link;
  the other 157 have v2 views. The targeted GET will retain its environment type.
- Zero jobs returned in successful lists; this does not establish zero jobs in
  the failed region.

Both discovery errors are in `me-central2`: services and jobs. The original
helper deliberately retained only a generic read-failure reason, so the upload
does not establish an HTTP status, permissions issue or regional policy cause.
Do not silently remove that region or mark it empty. Overall metadata discovery
and writer coverage remain incomplete.

Compared with the earlier 2026-11-05 01:14:50 UTC 22-target capture:

- `manageRefereeSeats` has a new update time (04:24:27 UTC), changed source-storage
  identity and changed build/service configuration hashes. The old source
  generation was `1793821779109302`. Fresh exact source is required before any
  candidate overlay can be used; preserve the independently released QR changes.
- `trackTournamentRegistrationActivity` has a different event-trigger digest but
  an unchanged update time and matching build/service hashes. The comparison is
  list metadata versus earlier GET metadata. Confirm with GET before calling it
  a deployed trigger change.
- The other 20 target rows' compared build/service/trigger hashes match. These
  are metadata observations, not new immutable source archive verification.
- `familyRegistration` reports a 05:00:50 UTC update time. It was outside that
  22-target capture and was independently updated for registration latency;
  capture its current source before applying an older interactions overlay.

## Targeted next read

`scripts/bucket-writer-followup.py` repeats only the two failed region lists,
GETs the four Functions named above, and downloads only the immutable source
archives for `manageRefereeSeats` and `familyRegistration`. It checks those two
Functions again after each download and rejects capture drift. It never deploys,
uploads code, changes IAM, enables APIs, reads/writes room documents or activates
runtime gates. JSON output omits raw configuration/environment values and raw
server messages; HTTP status, safe Google status/reason codes and payload hashes
are retained. Unknown/partial results remain failures, not empty inventories.

Run the fixed reviewed script in authenticated Cloud Shell for `bxh-arena` and
return its printed `reviewZip`, including partial output if a region remains
blocked. The script needs no third-party Python dependencies. It saves private
local files and a ZIP containing the report plus any downloaded source archives.
Its `followupComplete` does not imply global writer or release acceptance.

Offline verification:

```sh
python3 -B tests/four-court-buckets/writer-followup.py
```

Source/dependency classification, IAM/external Admin writers, fresh full release
source/configuration reconciliation and real cutover acceptance remain open.
No production writes, deployment or room activation occurred in this review.

## Targeted follow-up received

The follow-up capture at 2026-11-05 07:53:24–07:53:45 UTC confirms HTTP 403 / PERMISSION_DENIED / LOCATION_POLICY_VIOLATED for both me-central2 lists. They remain unverified; no location policy was changed and that region is not declared empty. All four targeted Function GETs completed; observeNumberAccount is GEN_1.

manageRefereeSeats archive SHA-256 581406375e1833a4768302d931371549b52f24337a9ca97c26638fb651a4ba05 matches all 16 current community-referee candidate file hashes. No referee source changes are needed to preserve its deployed QR behavior.

familyRegistration archive SHA-256 db015fb8fa78db14fab41e1f5cc18d8aa9ac8e3a9bcadcf17b425171db64a55d contains the deployed admission scheduler. The interaction guard is now reapplied to that exact source, retaining the scheduler and other 11 closure files. A review-only archive changes one member and preserves the other 103 members. Exact captures and hashes are in live-followup-20261105.json.

The fresh trackTournamentRegistrationActivity GET trigger digest still differs from the older GET digest despite an unchanged update time and matching build/service hashes. Its cause remains unresolved; trigger-field/readback and delivery acceptance are required before treating its configuration as reconciled. No trigger or routing change was made by this review.
