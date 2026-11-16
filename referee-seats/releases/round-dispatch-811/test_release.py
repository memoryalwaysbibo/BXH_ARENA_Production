from pathlib import Path
import importlib.util, json, os, sys, tempfile, zipfile, subprocess, tarfile, io
from unittest.mock import patch
repo=Path(__file__).resolve().parents[3]
root=Path(tempfile.mkdtemp(prefix='bxh-811-release-test-'))
data=subprocess.check_output(['git','archive','46559a743041d5cb3bb380d124f764e31cc29456','referee-seats/functions'],cwd=repo)
with tarfile.open(fileobj=io.BytesIO(data)) as archive:archive.extractall(root,filter='data')
source=root/'referee-seats/functions'
spec=importlib.util.spec_from_file_location('release',Path(__file__).with_name('release.py'));m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
mockdir=root/'mock-bin';mockdir.mkdir(exist_ok=True)
mockhome=root/'mock-home';mockhome.mkdir(exist_ok=True)
zip_path=root/'original.zip'
with zipfile.ZipFile(zip_path,'w') as z:
 for p in source.rglob('*'):
  if p.is_file():z.write(p,str(p.relative_to(source)))
info={'state':'ACTIVE','updateTime':'before','buildConfig':{'runtime':'nodejs22','entryPoint':m.FUNCTION,'source':{'storageSource':{'bucket':m.EXPECTED_BUCKET,'object':m.EXPECTED_OBJECT,'generation':m.EXPECTED_GENERATION}}},'serviceConfig':{'service':'projects/bxh-arena/locations/asia-east1/services/commitrefereecommand','revision':m.EXPECTED_REVISION,'timeoutSeconds':30,'availableMemory':'256M','environmentVariables':{'TEST':'preserved'}}}
state=root/'mock-state.json';state.write_text(json.dumps(info))
code='''#!/usr/bin/env python3
from pathlib import Path
import json,sys,shutil,zipfile
root=Path('__FIXTURE_ROOT__')
a=sys.argv[1:]
with (root/'mock-commands.jsonl').open('a') as f:f.write(json.dumps(a)+'\\n')
state=root/'mock-state.json'
if a[:2]==['functions','describe']:print(state.read_text())
elif a[:3]==['run','services','describe']:
 info=json.loads(state.read_text());r=info['serviceConfig']['revision'];print(json.dumps({'status':{'latestReadyRevisionName':r,'traffic':[{'revisionName':r,'percent':100}]}}))
elif a[:2]==['storage','cp']:
 src=root/('original.zip' if a[2].endswith('#1794716878951598') else 'deployed.zip');shutil.copyfile(src,a[3])
elif a[:2]==['functions','deploy']:
 folder=Path(next(x.split('=',1)[1] for x in a if x.startswith('--source=')))
 with zipfile.ZipFile(root/'deployed.zip','w') as z:
  for p in folder.rglob('*'):
   if p.is_file():z.write(p,str(p.relative_to(folder)))
 info=json.loads(state.read_text());info['serviceConfig']['revision']='commitrefereecommand-test-overlay';info['updateTime']='after';info['buildConfig']['source']['storageSource']['generation']='999';state.write_text(json.dumps(info))
else:raise SystemExit('unexpected mock command')
'''
(mockdir/'gcloud').write_text(code.replace('__FIXTURE_ROOT__',str(root)));(mockdir/'gcloud').chmod(0o755)
commands=root/'mock-commands.jsonl';commands.write_text('')
with patch.dict(os.environ,{'PATH':str(mockdir)+':'+os.environ['PATH']}),patch.object(Path,'home',return_value=mockhome),patch.object(sys,'argv',['release.py','--deploy']):m.main()
logs=[json.loads(x) for x in commands.read_text().splitlines()]
assert sum(x[:2]==['functions','deploy'] for x in logs)==1
reports=list(mockhome.glob('BXH_811_release_*/release-report.json'));assert json.loads(reports[-1].read_text())['verified']
print('PASS end-to-end release with mock cloud boundary and real JavaScript engine tests')
# A stale production revision must stop before any deploy call.
info['serviceConfig']['revision']='different-revision';state.write_text(json.dumps(info));commands.write_text('')
try:
 with patch.dict(os.environ,{'PATH':str(mockdir)+':'+os.environ['PATH']}),patch.object(Path,'home',return_value=mockhome),patch.object(sys,'argv',['release.py','--deploy']):m.main()
except RuntimeError:pass
else:raise AssertionError('stale production not rejected')
assert not any(json.loads(x)[:2]==['functions','deploy'] for x in commands.read_text().splitlines())
print('PASS stale production stops before deployment')
# A source mismatch and a scoring anchor mismatch fail closed.
import shutil
for label,relative,mutation in [('engine mismatch','engine/index.cjs',lambda s:s+'\\n// changed'),('scoring anchor mismatch','scoring-core.cjs',lambda s:s.replace("bronze-before-final","changed-anchor"))]:
 target=root/('negative-'+label.replace(' ','-'));shutil.copytree(source,target,dirs_exist_ok=True)
 p=target/relative;p.write_text(mutation(p.read_text()))
 try:m.patch_source(target,json.loads(m.unpack(m.OVERLAY_DATA)))
 except RuntimeError:pass
 else:raise AssertionError(label+' not rejected')
 print('PASS',label)
