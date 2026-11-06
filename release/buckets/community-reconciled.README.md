# Community Rules and bucket deletion lease composition

The read-only Cloud Shell capture on 2026-11-05 returned the live Firestore
Rules SHA-256 `dbdb8dc9ba46a110d6f8786cdc7ee4b9badc6bd3120769f4393bf51f31cbc9c3`.
It matches `release/community-referee/firestore.rules`. The older bucket deletion
package assumes `580da8c9...`; deploying that package's Rules file would replace
the community referee changes.

`community-reconciled.rules` is an **offline, undeployed candidate**. The
deterministic builder pins both complete input Rules files and the older deletion
baseline, checks that the deletion package contributes exactly five one-line
lease guards, and applies them to the community Rules. Four guards retain their
original expressions. The public mirror update guard combines current private
root marker checks in one `keys().hasAny` expression and keeps the original
`scoreStorage` after-state check. Current public marker checks also remain.
Client Rules reject introduction of `bucketMigration` on private root create or
update, including a same-batch public mirror edit. This combination is needed to
stay below the Firestore expression evaluation limit for a permitted manager
update; the direct five-line merge returned `PERMISSION_DENIED` in the Emulator.

Local verification:

```bash
python3 -B scripts/build-bucket-community-rules.py --check
BASELINE_RULES_PATH=release/community-referee/firestore.rules \
CANDIDATE_RULES_PATH=release/buckets/community-reconciled.rules \
FIRESTORE_EMULATOR_JAR="$HOME/.cache/firebase/emulators/cloud-firestore-emulator-v1.19.8.jar" \
python3 -B tests/four-court-buckets/deletion/rules-emulator.py
```

The latter ran 174 local demo-project checks: baseline and candidate compilation,
ordinary manager paths, bucket access/denials, deletion lease isolation and a
same-batch marker introduction denial. It does not prove live Auth/App Check,
every other Rules path, all Admin writers, or controlled cutover/rollback.
Before any release, reread live Rules/source/config, review the exact diff and
run wider community and bucket acceptance. No Rules deployment or runtime
activation was performed here.
