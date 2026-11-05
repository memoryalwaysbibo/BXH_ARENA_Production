# Targeted writer source readback

This read-only helper captures four high-priority live Functions in asia-east1:
syncMyHostingProgress, manageRegistrationSelection, lotteryRegistration and
settleLadderTournament. It obtains immutable source generations after authenticated
Function GETs, then GETs each Function again and fails if its metadata changed
during capture. The output archive contains `report.json` plus four source ZIPs.
The report carries hashes and metadata provenance, never credentials or raw
environment values. Keep the archive private: the source ZIPs are real deployed
application code and may contain configuration. Do not publish the ZIP to GitHub.

Run in Cloud Shell's `(bxh-arena)` tab, where the active project is bxh-arena.
This only reads metadata and downloads immutable source archives. It does not
read or write production room documents, deploy code, modify configuration or
open the bucket rollout gate. It does not resolve the me-central2 policy block
or classify any Function without source review. The helper bounds source ZIPs
to 16 MiB each; it creates a temporary review ZIP under HOME.

```sh
python3 -B bucket-priority-readonly.py
```

Offline tests:

```sh
python3 -B tests/four-court-buckets/priority-readonly.py
```
