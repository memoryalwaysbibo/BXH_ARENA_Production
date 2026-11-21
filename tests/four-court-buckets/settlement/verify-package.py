"""Pin both live source archives, shared adapter and exact bucket protocol code."""
from pathlib import Path
import hashlib,json
TEST=Path(__file__).resolve().parent
RELEASE=TEST.parents[2]/'release/buckets/settlement'
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def blob(p):
    data=p.read_bytes()
    return hashlib.sha1(b'blob '+str(len(data)).encode()+b'\0'+data).hexdigest()
m=json.loads((RELEASE/'patch-manifest.json').read_text())
for name,digest in json.loads((TEST/'fixture-sha256.json').read_text()).items():assert sha(TEST/name)==digest,name
assert {s['function'] for s in m['patches']}=={'ladderAutoSettlement','settleLadderTournament'}
for s in m['patches']:
    source=TEST/'fixtures'/str(s['sourceSet'])/s['path']
    assert sha(source)==s['baselineFileSha256']
    text=source.read_text()
    for e in s['edits']:
        assert text.count(e['before'])==1,e['before'][:100]
        text=text.replace(e['before'],e['after'],1)
    target=RELEASE/'candidate'/str(s['sourceSet'])/s['path']
    assert target.read_text()==text and sha(target)==s['patchedFileSha256']
wrapper=m['wrapperPatch']
source=TEST/'fixtures/21/index.js';target=RELEASE/'candidate/21/index.js'
assert sha(source)==wrapper['baselineFileSha256']
text=source.read_text()
for e in wrapper['edits']:
    assert text.count(e['before'])==1
    text=text.replace(e['before'],e['after'],1)
assert target.read_text()==text and sha(target)==wrapper['patchedFileSha256']
for name,digest in m['helperFiles'].items():assert sha(RELEASE/name)==digest,name
assert blob(RELEASE/'bucket-settlement/state.cjs')==m['protocolSource']['stateGitBlob']
source=TEST/'source/b82-scoring-core.cjs'
assert sha(source)==m['protocolSource']['projectionSourceSha256']
text=source.read_text();projection=text[text.index('function publicProjection('):text.index('function transition(context)')].rstrip()
assert (RELEASE/'bucket-settlement/public-view.cjs').read_text()=="'use strict';\n"+projection+"\nmodule.exports={publicProjection};\n"
for s in m['patches']:
    assert sha(TEST/'fixtures'/str(s['sourceSet'])/'_qr_checkin/qr-checkin-fence.cjs')==sha(RELEASE/'_qr_checkin/qr-checkin-fence.cjs')
print('PASS exact settlement patches, bucket protocol and original QR fence; no deployment')
