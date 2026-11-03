from pathlib import Path
import json,hashlib
T=Path(__file__).resolve().parent;R=T.parents[2]/'release/buckets/activity'
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
m=json.loads((R/'patch-manifest.json').read_text());assert m['deploymentTargets']==['activityTournamentCompleted','activityCompletedTournamentBackfill'] and not m['runtimeEnabled'] and m['productionWrites']==0
source=T/'fixtures/activity-points.js';target=R/'activity-points.js';assert sha(source)==m['baselineSha256'];text=source.read_text()
for edit in m['edits']:
 assert text.count(edit['before'])==1
 text=text.replace(edit['before'],edit['after'],1)
assert text==target.read_text() and sha(target)==m['candidateSha256']
for name,digest in m['helperFiles'].items():assert sha(R/name)==digest,name
for name,digest in m['fixtureFiles'].items():assert sha(T/name)==digest,name
for f in m['capturedClosure']:assert sha(T/'fixtures'/f['path'])==f['sha256'] and (T/'fixtures'/f['path']).stat().st_size==f['size']
# The actual daily/online handlers and their bodies remain byte-identical.
old=source.read_text();new=target.read_text()
a='async function reconcile(';b='exports.activityTournamentCompleted='
assert old[old.index(a):old.index(b)]==new[new.index(a):new.index(b)]
assert m['backfillCapture']['archiveSha256']==m['archiveSha256'] and m['backfillCapture']['baselineClosureMatched'] and m['backfillCapture']['metadata']['entryPoint']=='activityCompletedTournamentBackfill'
a='exports._activityTest=';assert old[old.index(a):]==new[new.index(a):]
p=json.loads((T/'fixtures/package.json').read_text());assert p['engines']['node']=='22' and p['dependencies']['firebase-admin']=='^14.4.0' and p['dependencies']['firebase-functions']=='^7.3.2'
raw=(R/'protocol/state.cjs').read_bytes();assert hashlib.sha1(b'blob '+str(len(raw)).encode()+b'\0'+raw).hexdigest()=='da457b44c6694293470efa3ce71699ada100b8b1'
print('PASS captured activity closure, exact edits, unchanged daily/online bodies, independently captured backfill and pinned bucket protocol; no deployment')
