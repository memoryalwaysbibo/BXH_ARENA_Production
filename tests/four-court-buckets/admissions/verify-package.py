"""Pin each captured archive independently; verify exact module edits and closure."""
from pathlib import Path
import hashlib,json
TEST=Path(__file__).resolve().parent
RELEASE=TEST.parents[2]/'release/buckets/admissions'
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
for name,digest in json.loads((TEST/'fixture-sha256.json').read_text()).items():
    assert sha(TEST/name)==digest,name
specs=json.loads((RELEASE/'patch-manifest.json').read_text())['patches']
assert {s['function'] for s in specs}=={'lotteryRegistration','manageEntrySelection','registrationInvitations'}
for s in specs:
    source=TEST/'fixtures'/str(s['sourceSet'])/s['path']
    assert sha(source)==s['baselineFileSha256']
    text=source.read_text()
    for edit in s['edits']:
        assert text.count(edit['before'])==1
        text=text.replace(edit['before'],edit['after'],1)
    target=RELEASE/'candidate'/str(s['sourceSet'])/s['path']
    assert target.read_text()==text and sha(target)==s['patchedFileSha256']
print('PASS three exact deployed-source patches and captured dependencies; no deployment')
