"""Verify independently captured modules and the exact reviewed edits."""
from pathlib import Path
import json,hashlib
TEST=Path(__file__).resolve().parent
RELEASE=TEST.parents[2]/'release/buckets/operations'
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
for p,digest in json.loads((TEST/'fixture-sha256.json').read_text()).items():assert sha(TEST/p)==digest,p
specs=json.loads((RELEASE/'patch-manifest.json').read_text())['patches']
assert {f for s in specs for f in s['functions']}=={'eventStaffService','drawTournamentRaffle','updateTournamentRaffleWinner','trackTournamentActivity','trackTournamentRegistrationActivity'}
for s in specs:
    source=TEST/'fixtures'/str(s['sourceSet'])/s['path']
    assert sha(source)==s['baselineFileSha256']
    text=source.read_text()
    for edit in s['edits']:
        assert text.count(edit['before'])==1
        text=text.replace(edit['before'],edit['after'],1)
    target=RELEASE/'candidate'/str(s['sourceSet'])/s['path']
    assert text==target.read_text() and sha(target)==s['patchedFileSha256']
print('PASS five entrypoints, exact deployed-source patches and pinned closure; no deployment')
