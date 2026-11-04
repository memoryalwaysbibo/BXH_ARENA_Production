"""Offline deployment transport tests: all API/CLI calls are local fakes."""
import contextlib
import copy
import importlib.util
import io
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('deploy', Path(__file__).with_name('community_referee_deploy.py'))
deploy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(deploy)
ROOT = Path(__file__).resolve().parents[1]


class FakeCloud:
    def __init__(self, ref, original_rules):
        self.ref, self.reads, self.writes, self.calls = ref, 0, 0, []
        self.release = ref['rulesetName']
        self.rules = {self.release: original_rules.decode()}
        self.functions = {}
        self.payload = None
        self.fail_reply = self.bad_config = self.change_rules = self.bad_download = self.flip_flag = False
        self.fields = {key: value for key, value in ref['runtimeFlags']['flags'].items() if value is not None}
        for old in ref['functions']:
            self.functions[old['name']] = {'name': old['name'], 'state': 'ACTIVE',
                'buildConfig': {'runtime': old['runtime'], 'entryPoint': old['entryPoint'], 'source': {'storageSource': old['storageSource']}},
                'serviceConfig': {**old['service'], 'environmentVariables': {'SECRET': 'do-not-persist-environment-value'}}}

    def request(self, method, url, data=None):
        self.calls.append((method, url, copy.deepcopy(data)))
        if method == 'GET':
            self.reads += 1
            if url == deploy.RULES + deploy.RELEASE:
                return {'name': deploy.RELEASE, 'rulesetName': self.release}
            if url.startswith(deploy.RULES + 'projects/bxh-arena/rulesets/'):
                return {'source': {'files': [{'name': 'firestore.rules', 'content': self.rules[url[len(deploy.RULES):]]}]}}
            if url == deploy.FLAGS:
                return {'fields': copy.deepcopy(self.fields)}
            if url.startswith(deploy.CF):
                return copy.deepcopy(self.functions[url[len(deploy.CF):]])
            raise AssertionError('Unexpected GET ' + url)
        self.writes += 1
        if method == 'POST' and url.endswith('/functions:generateUploadUrl'):
            return {'uploadUrl': 'https://storage.googleapis.com/fake-source?signed=do-not-persist-url',
                    'storageSource': {'bucket': 'fake-uploads', 'object': 'candidate.zip', 'generation': '0'}}
        if method == 'PATCH' and url.startswith(deploy.CF):
            self_test = self.functions[url[len(deploy.CF):].split('?')[0]]
            assert url.endswith('?updateMask=buildConfig.source')
            assert set(data) == {'name', 'buildConfig'} and set(data['buildConfig']) == {'source'}
            self_test['buildConfig']['source']['storageSource'] = {'bucket': 'fake-deployed', 'object': self_test['buildConfig']['entryPoint']+'.zip', 'generation': '12345'}
            self_test['serviceConfig']['revision'] = 'new-revision'
            if self.bad_config:
                self_test['serviceConfig']['timeoutSeconds'] = 999
            if self.change_rules:
                self.release = 'projects/bxh-arena/rulesets/concurrent-change'
                self.rules[self.release] = 'concurrent-rules'
            if self.fail_reply:
                raise deploy.Stop('PATCH API reply unavailable')
            return {'name': deploy.PARENT+'/operations/fixture', 'done': True}
        if method == 'POST' and url == deploy.RULES+'projects/bxh-arena/rulesets':
            name = 'projects/bxh-arena/rulesets/candidate'
            self.rules[name] = data['source']['files'][0]['content']
            return {'name': name}
        if method == 'PATCH' and url == deploy.RULES + deploy.RELEASE:
            assert set(data) == {'release', 'updateMask'} and data['updateMask'] == 'rulesetName'
            self.release = data['release']['rulesetName']
            return data['release']
        raise AssertionError('Unexpected mutation ' + method + ' ' + url)

    def upload(self, url, data):
        self.writes += 1
        self.payload = data
        if self.flip_flag:
            self.fields['communitySeatsEnabled'] = {'booleanValue': True}


class DeploymentTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.bundle = ROOT.parent/'BXH-community-referee-candidate-dbafbd9.zip'
        cls.ref, cls.manifest, cls.files, cls.rules = deploy.bundle(cls.bundle)
        cls.original = (ROOT/'referee-seats/reference/firestore.production-20261104.rules').read_bytes()

    def setup_deployment(self):
        cloud = FakeCloud(self.ref, self.original)
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        obj = deploy.Deployment(cloud, self.ref, self.manifest, self.files, self.rules, Path(temporary.name), wait=lambda _:None)
        return obj, cloud

    @contextlib.contextmanager
    def downloaded(self, cloud):
        def run(args, **kwargs):
            self.assertEqual(args[:3], ['gcloud', 'storage', 'cp'])
            self.assertTrue(args[3].endswith('#12345'))
            Path(args[4]).write_bytes(cloud.payload if not cloud.bad_download else b'not-a-source-archive')
            return subprocess.CompletedProcess(args, 0, '', '')
        with patch.object(subprocess, 'run', side_effect=run):
            yield

    def execute(self, obj, cloud):
        with contextlib.redirect_stdout(io.StringIO()), self.downloaded(cloud):
            obj.preflight()
            obj.apply()

    def test_readonly_preflight_has_five_reads_and_zero_writes(self):
        obj, cloud = self.setup_deployment()
        with contextlib.redirect_stdout(io.StringIO()): obj.preflight()
        self.assertEqual((cloud.reads, cloud.writes), (5, 0))

    def test_apply_updates_only_two_sources_and_rules_and_keeps_flags_config(self):
        obj, cloud = self.setup_deployment()
        self.execute(obj, cloud)
        self.assertEqual(obj.state['status'], 'DEPLOYED_WITH_COMMUNITY_CLOSED')
        self.assertEqual(cloud.writes, 6)
        source_patches = [url for method,url,_ in cloud.calls if method=='PATCH' and url.startswith(deploy.CF)]
        self.assertEqual(len(source_patches), 2)
        self.assertEqual(cloud.fields, {k:v for k,v in self.ref['runtimeFlags']['flags'].items() if v is not None})
        self.assertFalse(any(method!='GET' and url.startswith('https://firestore.googleapis.com/') for method,url,_ in cloud.calls))
        journal = (obj.journal/'state.json').read_text()
        self.assertNotIn('do-not-persist', journal)
        for name in ('flagWrites','iamWrites','firestoreDataWrites'): self.assertEqual(obj.state[name],0)

    def test_changed_rules_preflight_never_writes(self):
        obj, cloud = self.setup_deployment();cloud.rules[cloud.release]='changed'
        with self.assertRaisesRegex(deploy.Stop,'live Rules changed'): obj.preflight()
        self.assertEqual(cloud.writes,0)

    def test_lost_patch_reply_is_never_retried(self):
        obj, cloud = self.setup_deployment();cloud.fail_reply=True
        with self.assertRaisesRegex(deploy.Stop,'reply unavailable'): self.execute(obj, cloud)
        self.assertEqual(sum(method=='PATCH' for method,_,_ in cloud.calls),1)
        self.assertEqual(obj.state['status'],'FUNCTION_SUBMITTING')

    def test_changed_config_stops_before_second_function_or_rules(self):
        obj, cloud = self.setup_deployment();cloud.bad_config=True
        with self.assertRaisesRegex(deploy.Stop,'configuration'): self.execute(obj,cloud)
        self.assertEqual(sum(method=='PATCH' for method,_,_ in cloud.calls),1)

    def test_concurrent_rules_change_stops_before_second_function(self):
        obj, cloud = self.setup_deployment();cloud.change_rules=True
        with self.assertRaisesRegex(deploy.Stop,'Rules changed'): self.execute(obj,cloud)
        self.assertEqual(sum(method=='PATCH' for method,_,_ in cloud.calls),1)

    def test_runtime_flag_change_after_upload_prevents_function_patch(self):
        obj, cloud = self.setup_deployment();cloud.flip_flag=True
        with self.assertRaisesRegex(deploy.Stop,'already enabled'): self.execute(obj,cloud)
        self.assertFalse(any(method=='PATCH' for method,_,_ in cloud.calls))

    def test_corrupt_source_readback_prevents_rules_publish(self):
        obj, cloud = self.setup_deployment();cloud.bad_download=True
        with self.assertRaises(deploy.zipfile.BadZipFile): self.execute(obj,cloud)
        self.assertFalse(any(method=='POST' and url.endswith('/rulesets') for method,url,_ in cloud.calls))

    def test_signed_upload_has_no_oauth_header(self):
        cloud = deploy.Cloud();seen=[]
        def open_fake(request, **kwargs):seen.append(request);return io.BytesIO()
        with patch.object(deploy.urllib.request, 'urlopen', side_effect=open_fake):
            cloud.upload('https://storage.googleapis.com/source?signature=fake', b'zip')
        self.assertNotIn('Authorization', seen[0].headers)
        self.assertEqual(seen[0].get_method(),'PUT')
        self.assertEqual(seen[0].headers['Content-type'],'application/zip')


if __name__ == '__main__':
    unittest.main()
