"""Verify patches against the captured deployed modules and unchanged dependency fixtures."""
from pathlib import Path
import json,hashlib
TEST=Path(__file__).resolve().parent
RELEASE=TEST.parents[2]/'release/buckets/interactions'
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
for name,digest in json.loads((TEST/'fixture-sha256.json').read_text()).items():assert sha(TEST/name)==digest,name
specs=json.loads((RELEASE/'patch-manifest.json').read_text())['patches']
assert len(specs)==6 and len({s['function'] for s in specs})==6
for s in specs:
 p=TEST/'fixtures'/str(s['sourceSet'])/s['path'];assert sha(p)==s['baselineFileSha256']
 text=p.read_text()
 for edit in s['edits']:
  assert text.count(edit['before'])==1
  text=text.replace(edit['before'],edit['after'],1)
 target=RELEASE/'candidate'/str(s['sourceSet'])/s['path']
 assert target.read_text()==text and sha(target)==s['patchedFileSha256']
 if s['function']=='familyRegistration':
  capture=s['deployedSourceReadback']
  assert capture['name']==s['function'] and capture['entryPoint']==s['function']
  assert capture['stableDuringCapture'] is True and capture['sourceArchiveSha256']==s['archiveSha256']
  assert str(capture['source']['generation']).isdecimal()
  closure=capture['verifiedClosureFiles']
  assert 'registration-admission.cjs' in closure and len(closure)==12
  for name,digest in closure.items():assert sha(TEST/'fixtures'/str(s['sourceSet'])/name)==digest,name
print('PASS exact six patches and pinned deployed dependencies; no deployment')
