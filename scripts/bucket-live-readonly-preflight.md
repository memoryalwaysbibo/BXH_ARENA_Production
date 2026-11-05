# Bucket live read-only preflight

Run from an authenticated Google Cloud Shell with this repository checkout:

```bash
gcloud config set project bxh-arena
python3 -B scripts/bucket-live-readonly-preflight.py
```

The script reads the active Firestore Rules release and its source, lists the
`asia-east1` Cloud Functions, reads exact metadata for 22 selected bucket,
deletion, admission, settlement and activity writers, and downloads each
distinct generation-pinned source archive once. It writes a private directory
under `$HOME/bxh-bucket-live-readonly-*`. The printed `reportFile` points to
`report.json`; the directory also contains `firestore.live.rules`, source ZIPs,
and full per-function metadata JSON. Treat it as sensitive source material.

`readyForHumanReview` only means that the old reviewed Rules checksum still
matches, all selected Functions were captured without errors, and the three
new bucket Functions report their runtime disabled. It **does not** authorize
deployment or activation. A changed Rules hash, a missing Function, a read
error or an enabled bucket runtime causes a nonzero exit. Review the complete
source/configuration diff against the actual deployment candidates and reconcile
every change before a controlled release.

The 22 targets are an initial release boundary, not a complete Admin writer
inventory. Other regional Functions, other regions, scripts, Cloud Run and
Admin credentials, room data, real Auth/App Check, and six-court cutover and
rollback acceptance remain outside this read-only check. No production data
or release settings are written by this command.
