import copy
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

SCRIPT = Path(__file__).resolve().parents[1]/'community-name-mode/release.py'

def module():
    spec = importlib.util.spec_from_file_location('name_mode_release',SCRIPT)
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value

class ReleaseTests(unittest.TestCase):
    def setUp(self):
        self.m = module()
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.names = self.m.STAGE['NAMES']
        self.infos = {}
        self.payloads = {}
        self.rows = {}
        for name in self.names:
            original,candidate = (name+'-original').encode(),(name+'-candidate').encode()
            folder = self.root/name
            folder.mkdir();(folder/'candidate.zip').write_bytes(candidate)
            pointer = ('test-bucket',name+'/source.zip','1')
            info = {'name':self.m.LOCATION+'/functions/'+name,'state':'ACTIVE','environment':'GEN_2',
                    'serviceConfig':{'revision':name+'-old','allTrafficOnLatestRevision':True,'timeoutSeconds':60},
                    'buildConfig':{'entryPoint':name,'runtime':'nodejs22'}}
            self.infos[name] = (info,pointer)
            self.payloads[pointer] = original
            self.rows[name] = {'revision':name+'-old','sourcePointer':list(pointer),
                'configurationSha256':self.m.STAGE['configuration'](info),
                'originalSha256':self.m.digest(original),'candidateSha256':self.m.digest(candidate)}
        self.manifest = {'writers':self.rows}
        self.m.verify_local = lambda root:(self.manifest,'test-manifest-sha')
        self.m.STAGE['describe'] = lambda name:copy.deepcopy(self.infos[name])
        self.reads = []
        def command(*args):
            self.assertEqual(args[:3],('gcloud','storage','cp'))
            self.reads.append(args[3])
            pointer = next(p for p in self.payloads if args[3] == f'gs://{p[0]}/{p[1]}#{p[2]}')
            Path(args[4]).write_bytes(self.payloads[pointer])
            return b''
        self.m.STAGE['command'] = command
        self.events = []
        self.m.emit = lambda status,**fields:self.events.append({'status':status,**fields})
        self.uploads = []
        self.submits = []
        self.waits = []
        self.fail_wait_once = False
        self.lost_submit = None
        self.race = False
        owner = self
        class FakeCloud:
            def upload(self,archive,kms):
                owner.uploads.append(archive)
                if owner.race:
                    name = owner.names[0]
                    owner.infos[name][0]['serviceConfig']['timeoutSeconds'] = 90
                return {'bucket':'test-upload','object':'payload.zip','generation':'2'}
            def submit(self,name,source):
                owner.submits.append(name)
                if owner.lost_submit == 'not-submitted':
                    raise TimeoutError('response-lost')
                owner.activate(name)
                if owner.lost_submit == 'submitted':
                    owner.lost_submit = None
                    raise TimeoutError('response-lost')
                return owner.m.LOCATION+'/operations/'+name
            def wait(self,operation):
                owner.waits.append(operation)
                if owner.fail_wait_once:
                    owner.fail_wait_once = False
                    raise TimeoutError('poll-interrupted')
            def api(self,operation):
                return {'done':True}
        self.m.Cloud = FakeCloud

    def tearDown(self):
        self.temp.cleanup()

    def activate(self,name):
        info,_ = self.infos[name]
        info = copy.deepcopy(info)
        info['serviceConfig']['revision'] = name+'-new'
        pointer = ('test-bucket',name+'/source.zip','2')
        self.infos[name] = (info,pointer)
        self.payloads[pointer] = (self.root/name/'candidate.zip').read_bytes()

    def records(self):
        return [json.loads(line) for line in (self.root/'name-mode-release.jsonl').read_text().splitlines()]

    def test_check_reads_all_sources_without_upload_or_submit(self):
        self.m.run(self.root,'check')
        self.assertEqual(len(self.reads),7)
        self.assertEqual(self.uploads,[]);self.assertEqual(self.submits,[])
        self.assertEqual(self.events[-1]['status'],'NAME_MODE_RELEASE_READY')

    def test_apply_verifies_all_seven_and_preserves_settings(self):
        self.m.run(self.root,'apply')
        self.assertEqual(self.submits,list(self.names))
        self.assertEqual(len([r for r in self.records() if r['status']=='VERIFIED']),7)
        self.assertEqual(self.records()[-1]['status'],'BACKEND_RELEASE_VERIFIED')
        for name in self.names:
            self.assertEqual(self.m.STAGE['configuration'](self.infos[name][0]),self.rows[name]['configurationSha256'])
        self.assertFalse(self.records()[-1]['frontendPublished'])

    def test_any_changed_baseline_blocks_all_function_updates(self):
        self.infos[self.names[-1]][0]['serviceConfig']['timeoutSeconds']=90
        with self.assertRaisesRegex(ValueError,'live-baseline-changed'):
            self.m.run(self.root,'apply')
        self.assertEqual(self.uploads,[]);self.assertEqual(self.submits,[])

    def test_race_after_upload_blocks_submit(self):
        self.race=True
        with self.assertRaisesRegex(ValueError,'baseline-changed-after-upload'):
            self.m.run(self.root,'apply')
        self.assertEqual(len(self.uploads),1);self.assertEqual(self.submits,[])

    def test_resume_follows_existing_operation_without_resubmitting(self):
        self.fail_wait_once=True
        with self.assertRaises(TimeoutError):self.m.run(self.root,'apply')
        self.assertEqual(self.records()[-1]['status'],'OPERATION')
        self.m.run(self.root,'resume')
        self.assertEqual(self.submits.count(self.names[0]),1)
        self.assertEqual(self.records()[-1]['status'],'BACKEND_RELEASE_VERIFIED')

    def test_lost_submit_response_reconciles_deployed_source(self):
        self.lost_submit='submitted'
        with self.assertRaises(TimeoutError):self.m.run(self.root,'apply')
        self.assertEqual(self.records()[-1]['status'],'SUBMITTING')
        self.m.run(self.root,'resume')
        self.assertEqual(self.submits.count(self.names[0]),1)
        self.assertEqual(self.records()[-1]['status'],'BACKEND_RELEASE_VERIFIED')

    def test_unconfirmed_submit_is_never_repeated(self):
        self.lost_submit='not-submitted'
        with self.assertRaises(TimeoutError):self.m.run(self.root,'apply')
        with self.assertRaisesRegex(ValueError,'SUBMISSION_UNCONFIRMED'):
            self.m.run(self.root,'resume')
        self.assertEqual(self.submits,[self.names[0]])

    def test_completed_function_changed_later_blocks_resume(self):
        self.m.run(self.root,'apply')
        self.infos[self.names[0]][0]['serviceConfig']['revision']='unrelated-new-revision'
        with self.assertRaisesRegex(ValueError,'deployed-baseline-changed'):
            self.m.run(self.root,'resume')
        self.assertEqual(len(self.submits),7)

    def test_second_apply_does_not_repeat_release(self):
        self.m.run(self.root,'apply')
        with self.assertRaises(FileExistsError):self.m.run(self.root,'apply')
        self.assertEqual(len(self.submits),7)

    def test_wrong_deployed_source_stops_before_next_function(self):
        original=self.activate
        def activate(name):
            original(name)
            self.payloads[self.infos[name][1]]=b'wrong-source'
        self.activate=activate
        with self.assertRaisesRegex(ValueError,'live-source-hash'):
            self.m.run(self.root,'apply')
        self.assertEqual(self.submits,[self.names[0]])
        self.assertFalse(any(r['status']=='VERIFIED' for r in self.records()))

    def test_changed_deployed_settings_stop_before_next_function(self):
        original=self.activate
        def activate(name):
            original(name)
            self.infos[name][0]['serviceConfig']['timeoutSeconds']=120
        self.activate=activate
        with self.assertRaisesRegex(ValueError,'deployed-settings-or-revision'):
            self.m.run(self.root,'apply')
        self.assertEqual(self.submits,[self.names[0]])

class ProtocolTests(unittest.TestCase):
    def test_unreviewed_staging_manifest_is_rejected_before_cloud_access(self):
        m=module()
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);(root/'manifest.json').write_text('{}')
            with self.assertRaisesRegex(ValueError,'STAGING_MANIFEST_CHANGED'):
                m.verify_local(root)

    def test_patch_only_changes_build_source(self):
        m=module();cloud=m.Cloud();calls=[]
        def api(path,method='GET',payload=None):
            calls.append((path,method,payload))
            return {'name':m.LOCATION+'/operations/verified-operation'}
        cloud.api=api
        source={'bucket':'source-bucket','object':'source.zip','generation':'1'}
        cloud.submit('familyRegistration',source)
        path,method,payload=calls[0]
        self.assertEqual(path,m.LOCATION+'/functions/familyRegistration?updateMask=buildConfig.source')
        self.assertEqual(method,'PATCH')
        self.assertEqual(set(payload),{'name','buildConfig'})
        self.assertEqual(payload['buildConfig'],{'source':{'storageSource':source}})

    def test_unbound_upload_url_is_rejected_before_transferring_bytes(self):
        m=module();cloud=m.Cloud()
        cloud.api=lambda *args:{'uploadUrl':'https://example.com/untrusted?token=x',
                                'storageSource':{'bucket':'source-bucket','object':'source.zip'}}
        with self.assertRaisesRegex(ValueError,'UPLOAD_URL_BINDING'):
            cloud.upload(b'zip',None)

if __name__=='__main__':
    unittest.main()
