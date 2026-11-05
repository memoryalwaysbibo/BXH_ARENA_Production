from pathlib import Path
from urllib.parse import urlsplit,parse_qsl
import json,hashlib,re
R=Path(__file__).resolve().parents[3];m=json.loads((R/'release/buckets/integration/manifest.json').read_text())
assert m['status']=='integrated-candidate-not-deployed' and m['runtimeEnabled'] is False and m['productionWrites']==0 and m['roomActivationPerformed'] is False
assert [x['pr'] for x in m['components']]==[707,709,711,712,713,714,715,717,718,723]
for name,item in m['files'].items():
 b=(R/name).read_bytes();assert hashlib.sha1(b'blob '+str(len(b)).encode()+b'\0'+b).hexdigest()==item['blob'],name
index=(R/'index.html').read_text();scripts={urlsplit(u).path:dict(parse_qsl(urlsplit(u).query)) for u in re.findall(r'<script[^>]+src="([^"]+)"',index)}
for path,query in m['mainScriptQueryParameters'].items():
 assert path in scripts,path
 for key,value in query.items():assert scripts[path].get(key)==value,(path,key)
assert index.index('modules/scoring/four-court-browser.js')<index.index('modules/scoring/four-court-settlement.js')<index.index('modules/main-app/core.js')
assert scripts['modules/main-app/core.js']['delete-intent']=='20261103.1'
assert scripts['modules/main-app/core.js']['bucket-settlement']=='20261103.2'
readback=json.loads((R/'release/buckets/integration/live-followup-20261105.json').read_text())
assert readback['status']=='review-only-not-deployed' and readback['productionWrites']==0 and readback['deploymentPerformed'] is False and readback['roomActivationPerformed'] is False
assert readback['writerInventoryComplete'] is False and readback['acceptanceCompleted'] is False
referee=json.loads((R/'release/community-referee/backend-manifest.json').read_text())
assert set(readback['refereeCandidateFileMatches'])==set(referee['files'])
for name,digest in readback['refereeCandidateFileMatches'].items():assert referee['files'][name]['candidateSha256']==digest,name
family=next(x for x in json.loads((R/'release/buckets/interactions/patch-manifest.json').read_text())['patches'] if x['function']=='familyRegistration')
assert readback['familyReviewSource']['baselineArchiveSha256']==family['archiveSha256']
assert readback['familyReviewSource']['candidateFileSha256']==family['patchedFileSha256']
assert readback['familyReviewSource']['changedMembers']==['family-registration.js'] and readback['familyReviewSource']['unchangedMembers']==103
assert readback['familyReviewSource']['verifiedClosureFiles']==family['deployedSourceReadback']['verifiedClosureFiles']
print(json.dumps({'componentFilesVerified':len(m['files']),'components':len(m['components']),'currentMainScriptParametersPreserved':True,'productionWrites':0}))
