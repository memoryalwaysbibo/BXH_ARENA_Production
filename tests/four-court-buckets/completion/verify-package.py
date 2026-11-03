from pathlib import Path
import hashlib,json
T=Path(__file__).resolve().parent
R=T.parents[2]/'release/buckets/completion'
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
m=json.loads((R/'patch-manifest.json').read_text())
assert m['status']=='candidate-not-deployed' and not m['runtimeEnabled'] and not m['completionEnabled']
assert {p['function'] for p in m['hostingPatches']}=={'preserveCompletedRoomAndCountHost','preserveExistingCompletedRooms','syncMyHostingProgress'}
for p in m['hostingPatches']:
 source=T/'fixtures'/str(p['sourceSet'])/'hosting.js';assert sha(source)==p['baselineSha256']
 text=source.read_text()
 for e in p['edits']:
  assert text.count(e['before'])==1
  text=text.replace(e['before'],e['after'],1)
 target=R/'hosting'/str(p['sourceSet'])/'hosting.js'
 assert text==target.read_text() and sha(target)==p['candidateSha256']
for name,digest in m['helperFiles'].items():assert sha(R/name)==digest,name
for name,digest in m['fixtureFiles'].items():assert sha(T/name)==digest,name
raw=(R/'protocol/state.cjs').read_bytes()
assert hashlib.sha1(b'blob '+str(len(raw)).encode()+b'\0'+raw).hexdigest()==m['protocolSource']['stateGitBlob']
assert (R/'hosting/15/hosting-core.js').read_bytes()==(R/'hosting/16/hosting-core.js').read_bytes()==(T/'fixtures/hosting-core.js').read_bytes()
assert not m['missingExactSource']
capture=m['hostSyncCapture'];assert capture['function']['name']=='syncMyHostingProgress' and capture['verifiedFiles']==92
for f in capture['closureFiles']:
    target=R/'hosting/host-sync/hosting-core.js' if f['path']=='hosting-core.js' else T/'fixtures/host-sync'/f['path']
    assert sha(target)==f['sha256'],f['path']
assert (R/'hosting/host-sync/hosting-core.js').read_bytes()==(T/'fixtures/hosting-core.js').read_bytes()
print('PASS three independent hosting captures, exact patches and completion package; no deployment')
