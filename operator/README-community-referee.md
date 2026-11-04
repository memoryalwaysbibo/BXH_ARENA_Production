# Closed community-referee deployment operator

This operator is separate from the runtime candidate PR. The runtime bundle is
pinned to commit `dbafbd9653e7f1944c6f3c3aec5ad4d68dde65e2` and ZIP SHA-256
`b814609e46528660c9017598870bcbf1cbd2d98b343ec50c6cc2def242754e91`.

Run `python3 -B community_referee_deploy.py` for five readonly cloud reads.
Run the same command with `--apply` to deploy the two existing function sources
and Firestore Rules, while keeping the community flag closed. The default
bundle path is `~/BXH-community-referee-candidate-dbafbd9.zip`.

The operator checks the full pinned archive before cloud access, current Rules,
both immutable source generations, runtime/entry points, captured service fields
and rollout flags. Each deployment phase rechecks current sources, Rules and
flags. Function PATCH requests contain only name and buildConfig.source with
updateMask=buildConfig.source. Uploads use the official generated signed URL
with application/zip and no OAuth header. The original package/lockfile, engine,
two-export index and bucket guard are checked in deployed source readback.

Service configuration is fingerprinted in memory before and after, excluding
only the generated revision field. No IAM or Firestore data/flag write endpoint
is used. Rules are compiled as a new Ruleset, then only the existing Firestore
release's rulesetName is changed, followed by source/hash readback.

Mutations are not automatically retried. A reply loss, operation failure,
changed baseline/config, enabled community flag or mismatched source readback
stops the operation. A private Cloud Shell journal records phase, operation IDs,
prior sources, prior Rules release and verified new source generations. Tokens,
signed URLs and environment values are never persisted. There is no blind
automatic rollback or automatic replay after an unknown deployment outcome.
The read/check sequence is not an atomic cross-service lock; coordinate any
other deployments to these same resources while this operator runs.

Deployment ends at `DEPLOYED_WITH_COMMUNITY_CLOSED`. It does not merge/publish
the frontend, enable general-room support or replace authenticated multi-device
acceptance. The operator's own regression tests use fake API/CLI transport;
they do not constitute a real deployment receipt.

Official API references:
- https://docs.cloud.google.com/functions/docs/reference/rest/v2/projects.locations.functions/patch
- https://docs.cloud.google.com/functions/docs/reference/rest/v2/projects.locations.functions/generateUploadUrl
- https://firebase.google.com/docs/reference/rules/rest/v1/projects.releases/patch

Offline tests: `python3 -B operator/community_referee_deploy_test.py`.
