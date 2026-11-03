"""Offline tests only. No GCP requests or real credentials."""
from pathlib import Path
import importlib.util,json,sys,tempfile,zipfile
from unittest.mock import patch
ROOT=Path(__file__).resolve().parents[3]
spec=importlib.util.spec_from_file_location('capture',ROOT/'scripts/bucketcapturehostsync.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
assert [x['name'] for x in m.TARGETS]==['syncMyHostingProgress']
class Fake:
    PARENT='projects/bxh-arena/locations/asia-east1'
    captures=0
    closed_checks=0
    drift=False
    def run(self,args):
        assert args==['gcloud','config','get-value','project','--quiet']
        return 'bxh-arena'
    def closed(self):self.closed_checks+=1
    def describe(self,name):
        assert name=='syncMyHostingProgress'
        t=m.TARGETS[0]
        return {'name':self.PARENT+'/functions/'+name,'state':'ACTIVE','updateTime':'changed' if self.drift else t['updateTime'],'buildConfig':{'entryPoint':name,'runtime':'nodejs22','source':{'storageSource':t['storageSource']}}}
    def capture(self,fn,temp,name):
        self.captures+=1
        return b'fixture source zip',{'hosting.js':b'exports.fixture=true;', '.env':b'not-exported','credential.js':b'not-exported','node_modules/private.js':b'not-exported'}
checks=0
with tempfile.TemporaryDirectory() as folder:
    f=Fake()
    with patch.object(m,'helper',return_value=f),patch.object(m.Path,'home',return_value=Path(folder)),patch.object(sys,'argv',['capture','prepare']):m.main()
    outputs=list(Path(folder).glob('bucket-host-sync-source-*.zip'));assert len(outputs)==1 and f.captures==1 and f.closed_checks==2
    with zipfile.ZipFile(outputs[0]) as z:
        report=json.loads(z.read('report.json'));assert report['stage']=='HOST_SYNC_SOURCE_CAPTURE' and report['productionWrites']==0 and report['roomDataReads']==0 and not report['deploymentPerformed']
        assert [x['name'] for x in report['functions']]==['syncMyHostingProgress']
        assert sorted(z.namelist())==['report.json','sources/0/hosting.js']
    checks+=1
with tempfile.TemporaryDirectory() as folder:
    f=Fake();f.drift=True
    with patch.object(m,'helper',return_value=f),patch.object(m.Path,'home',return_value=Path(folder)),patch.object(sys,'argv',['capture','prepare']):
        try:m.main()
        except ValueError as e:assert 'Source metadata changed' in str(e)
        else:raise AssertionError('drift accepted')
    assert f.captures==0 and not list(Path(folder).iterdir());checks+=1
try:m.selected({'../escape.js':b'bad'})
except ValueError:checks+=1
else:raise AssertionError('unsafe path accepted')
print(json.dumps({'hostSyncCaptureOfflineChecks':checks,'productionRequests':0,'productionWrites':0}))
