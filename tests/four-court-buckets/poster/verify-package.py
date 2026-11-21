from pathlib import Path
import json,hashlib
T=Path(__file__).resolve().parent;R=T.parents[2]/'release/buckets/poster'
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
m=json.loads((R/'patch-manifest.json').read_text());assert m['deploymentTarget']=='roomPosterCover' and not m['runtimeEnabled'] and m['productionWrites']==0
source=T/'fixtures/room-poster-cover.js';target=R/'room-poster-cover.js';assert sha(source)==m['baselineSha256'];text=source.read_text()
for e in m['edits']:
 assert text.count(e['before'])==1
 text=text.replace(e['before'],e['after'],1)
assert text==target.read_text() and sha(target)==m['candidateSha256']
for name,digest in m['helperFiles'].items():assert sha(R/name)==digest,name
for name,digest in m['fixtureFiles'].items():assert sha(T/name)==digest,name
for f in m['capturedClosure']:assert sha(T/'fixtures'/f['path'])==f['sha256'] and (T/'fixtures'/f['path']).stat().st_size==f['size'],f['path']
a=source.read_text();b=target.read_text();start='exports.roomPosterCoverCleanup='
assert a[a.index(start):a.index('exports._test=')]==b[b.index(start):b.index('exports._test=')]
raw=(R/'bucket-state.cjs').read_bytes();assert hashlib.sha1(b'blob '+str(len(raw)).encode()+b'\0'+raw).hexdigest()==m['protocolSource']['gitBlob']
p=json.loads((T/'fixtures/package.json').read_text());assert p['engines']['node']=='22' and p['dependencies']['firebase-admin']=='^14.4.0' and p['dependencies']['firebase-functions']=='^7.3.2'
print('PASS exact poster module edits, unchanged cleanup, captured closure and bucket protocol; no deployment')
