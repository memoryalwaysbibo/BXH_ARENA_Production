# Capture the independent live host-sync source

Download `bucketcapturehostsync.py`, then upload it to your existing Cloud Shell home directory. Keep the previously verified `bucketmaintenancefence.py` (including duplicate-name copies); the capture locates the exact SHA-256-reviewed helper automatically.

```sh
gcloud config set project bxh-arena
python3 -B ~/bucketcapturehostsync.py prepare
```

Upload the `bucket-host-sync-source-<timestamp>.zip` named by `reportFile` in the output. This captures only `syncMyHostingProgress`, checks its pinned deployed generation before/after reading, and filters exported code. It reads no tournament/player documents and has no deployment, flag change or room-activation mode. If the live source has changed from the inventory, it stops rather than assuming equivalence. The maintenance helper additionally verifies bucket runtime/configuration remains closed. Three offline fixture tests cover successful single-function capture/filtering, source drift before download and unsafe archive paths; no production request is made by those tests.
