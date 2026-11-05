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
priority=json.loads((R/'release/buckets/integration/live-priority-writers-20261105.json').read_text())
assert priority['status']=='review-only-not-deployed' and priority['productionWrites']==0
assert priority['deploymentPerformed'] is False and priority['roomActivationPerformed'] is False
assert priority['writerInventoryComplete'] is False and priority['acceptanceCompleted'] is False
assert priority['captureArchiveSha256']=='37b6017285474d756ecd2eb9751ed5145aa8c53a4b978502163811de602ca6ef'
assert priority['captureReportSha256']=='26e05d0f4b148ab4cc956ecda3a2d215207f1540917d2ab03fe731b74b3b0c40'
expected_priority={
 'syncMyHostingProgress':('completion','tests/four-court-buckets/completion/fixtures/host-sync/hosting.js'),
 'manageRegistrationSelection':('deletion','tests/four-court-buckets/deletion/fixtures/selection/registration-selection.js'),
 'lotteryRegistration':('admissions','tests/four-court-buckets/admissions/fixtures/11/registration-selection.js'),
 'settleLadderTournament':('settlement','tests/four-court-buckets/settlement/fixtures/21/ladder-settlement.js'),
}
assert {x['name'] for x in priority['sources']}==set(expected_priority) and len(priority['sources'])==4
admission=json.loads((R/'release/buckets/admissions/patch-manifest.json').read_text())
completion=json.loads((R/'release/buckets/completion/patch-manifest.json').read_text())
deletion=json.loads((R/'release/buckets/deletion/manifest.json').read_text())
settlement=json.loads((R/'release/buckets/settlement/patch-manifest.json').read_text())
for row in priority['sources']:
 name=row['name'];family,fixture=expected_priority[name]
 assert row['candidateFamily']==family and row['stableDuringCapture'] is True and row['writerClassification']=='reviewed-path-only'
 assert row['source']['generation'].isdecimal() and row['source']['object']==name+'/function-source.zip'
 assert hashlib.sha256((R/fixture).read_bytes()).hexdigest()==row['reviewedBaselineFileSha256'],name
 if name=='syncMyHostingProgress':
  patch=next(x for x in completion['hostingPatches'] if x['function']==name)
  assert patch['archiveSha256']==row['sourceArchiveSha256'] and patch['baselineSha256']==row['reviewedBaselineFileSha256']
  assert completion['hostSyncCapture']['function']['storageSource']==row['source']
 elif name=='manageRegistrationSelection':
  assert deletion['selectionSourceSet']['archiveSha256']==row['sourceArchiveSha256']
  assert deletion['testFixtures']['fixtures/selection/registration-selection.js']==row['reviewedBaselineFileSha256']
 else:
  group=admission if name=='lotteryRegistration' else settlement
  patch=next(x for x in group['patches'] if x['function']==name)
  assert patch['archiveSha256']==row['sourceArchiveSha256'] and patch['baselineFileSha256']==row['reviewedBaselineFileSha256']
print(json.dumps({'componentFilesVerified':len(m['files']),'components':len(m['components']),'currentMainScriptParametersPreserved':True,'productionWrites':0}))
