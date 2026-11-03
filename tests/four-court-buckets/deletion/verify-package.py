"""Check pinned release fixtures and the single reviewed restore guard edit."""
import hashlib
import json
from pathlib import Path
ROOT = Path(__file__).resolve().parents[3]
TEST = Path(__file__).resolve().parent
RELEASE = ROOT / 'release/buckets/deletion'
m = json.loads((RELEASE / 'manifest.json').read_text())
def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()
for name, expected in m['candidates'].items():
    assert sha(RELEASE / name) == expected, name
for name, expected in m['testFixtures'].items():
    assert sha(TEST / name) == expected, name
assert sha(ROOT / 'release/buckets/firestore.rules') == m['candidateRulesSha256']
assert sha(TEST / 'fixtures/baseline.rules') == m['currentRulesSha256']
baseline = (TEST / 'fixtures/restore/operations.js').read_text()
anchor = "  if(!t.exists||t.data().systemClosed!==true)throw Error('not-system-closed');"
guard = "  if([t.data(), p.data()].some(x=>x&&['scoreStorage','scoreBucketProjection','bucketMigration','deletionStatus'].some(k=>Object.prototype.hasOwnProperty.call(x,k))))throw Error('bucket-scoring-required');\n"
assert baseline.count(anchor) == 1
assert baseline.replace(anchor, guard + anchor, 1) == (RELEASE / 'restore-operations.js').read_text()
print('PASS pinned package and exact restore-only edit; no deployment')

access = (TEST / 'fixtures/access/room-access-service.js').read_text()
a = "    if(!ts.exists||!ps.exists)throw Error('room-not-found');if(!C.active(us.data()))throw Error('auth-required');\n    const t=ts.data();if(!C.canBypass(uid,us.data(),t))throw Error('room-access-denied');\n"
assert access.count(a) == 1
access = access.replace(a, a + "    if([t, ps.data()].some(x=>x&&['scoreStorage','scoreBucketProjection','bucketMigration','deletionStatus'].some(k=>Object.prototype.hasOwnProperty.call(x,k))))throw Error('bucket-scoring-required');\n", 1)
a = "const [ts,us,grant,attempt]=await Promise.all([tx.get(tr),tx.get(ur),tx.get(grantRef),tx.get(attemptRef)]);"
assert access.count(a) == 1
access = access.replace(a, "const [ts,ps,us,grant,attempt]=await Promise.all([tx.get(tr),tx.get(pr),tx.get(ur),tx.get(grantRef),tx.get(attemptRef)]);", 1)
a = "   const t=ts.data(),mode=C.normalizeMode(t.roomAccessMode);"
i = access.rindex(a)
access = access[:i] + access[i:].replace(a, "   const t=ts.data();\n   if([t,ps.data()].some(x=>x&&['bucketMigration','deletionStatus'].some(k=>Object.prototype.hasOwnProperty.call(x,k))))return {error:'room-deletion-or-migration-in-progress'};\n   const mode=C.normalizeMode(t.roomAccessMode);", 1)
assert access == (RELEASE / 'room-access-service.js').read_text()
print('PASS exact roomAccess lease guards; no deployment')
