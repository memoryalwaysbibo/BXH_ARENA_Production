"""Mocked release protocol, not a real deployment or production smoke test."""
import copy
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('release816',ROOT/'operator/BXH816_release_trial.py')
M=importlib.util.module_from_spec(spec);spec.loader.exec_module(M)
NAME='projectBucketPublicScore'

class TrialRelease(unittest.TestCase):
    def fixture(self, directory):
        info={'name':M.PARENT+'/functions/'+NAME,'state':'ACTIVE','updateTime':'before','environment':'GEN_2',
              'buildConfig':{'runtime':'nodejs22','entryPoint':NAME,'source':{'storageSource':{'bucket':'original','object':'source.zip','generation':'1'}}},
              'serviceConfig':{'revision':'before','timeoutSeconds':30,'maxInstanceCount':1,'environmentVariables':{'BXH_BUCKET_RUNTIME_ENABLED':'true','PRIVATE':'never print'}}}
        raw=b'synthetic candidate';(directory/'candidate').mkdir();(directory/'candidate'/(NAME+'.zip')).write_bytes(raw)
        report={'functions':{NAME:{'source':copy.deepcopy(info['buildConfig']['source']['storageSource']),'revision':'before'}},
                'archives':{NAME:{'backupSha256':M.digest(b'synthetic backup')}}}
        return info,report,raw

    def exercise(self, directory, info, report, raw, apply=False, rollback=False, fail_after_patch=False):
        calls=[]
        def api(resource, method='GET', body=None):
            calls.append((resource,method,copy.deepcopy(body)))
            if method=='POST':return {'uploadUrl':'https://storage.googleapis.com/secret-signature','storageSource':{'bucket':'upload','object':'x'}}
            if method=='PATCH':
                self.assertEqual(resource,info['name']+'?updateMask=buildConfig.source')
                self.assertEqual(set(body),{'name','buildConfig'});self.assertEqual(set(body['buildConfig']),{'source'})
                info['updateTime']='after';info['serviceConfig']['revision']='rolled-back' if rollback else 'released'
                info['buildConfig']['source']['storageSource']={'bucket':'final','object':'immutable.zip','generation':'2'}
                if fail_after_patch:raise OSError('network interruption after accepted PATCH')
                return {'name':M.PARENT+'/operations/one'}
            if '/operations/' in resource:return {'done':True}
            return copy.deepcopy(info)
        def command(args):
            self.assertEqual(args[:3],['gcloud','storage','cp'])
            Path(args[4]).write_bytes(b'synthetic backup' if rollback else raw)
            return ''
        with patch.object(M,'load_review',return_value=(directory,report)),patch.object(M,'token',return_value='test-only'),patch.object(M.PREP,'policy_snapshot'),patch.object(M,'api',side_effect=api),patch.object(M,'upload') as upload,patch.object(M.CAP,'command',side_effect=command),patch.dict(M.CANDIDATES,{NAME:M.digest(raw)}):
            result=M.run(directory,NAME,apply,rollback)
        return result,calls,upload

    def test_dry_run_makes_no_cloud_mutations(self):
        with tempfile.TemporaryDirectory() as d:
            directory=Path(d);info,report,raw=self.fixture(directory)
            result,calls,upload=self.exercise(directory,info,report,raw)
            self.assertEqual(result['productionWrites'],0);self.assertTrue(all(method=='GET' for _,method,_ in calls));upload.assert_not_called()

    def test_source_only_release_verified_and_repeated_apply_does_not_redeploy(self):
        with tempfile.TemporaryDirectory() as d:
            directory=Path(d);info,report,raw=self.fixture(directory)
            result,calls,_=self.exercise(directory,info,report,raw,True)
            self.assertEqual(result['status'],'complete');self.assertEqual(sum(method=='PATCH' for _,method,_ in calls),1)
            self.assertTrue(result['protectedSettingsPreserved'])
            self.assertNotIn('PRIVATE',(directory/('release-'+NAME+'.json')).read_text())
            second,calls,upload=self.exercise(directory,info,report,raw,True)
            self.assertTrue(second['alreadyComplete']);self.assertTrue(all(method=='GET' for _,method,_ in calls));upload.assert_not_called()

    def test_rollback_uses_original_source_without_upload_or_setting_mutation(self):
        with tempfile.TemporaryDirectory() as d:
            directory=Path(d);info,report,raw=self.fixture(directory)
            self.exercise(directory,info,report,raw,True)
            result,calls,upload=self.exercise(directory,info,report,raw,True,True)
            self.assertEqual(result['action'],'rollback');upload.assert_not_called()
            payload=next(body for _,method,body in calls if method=='PATCH')
            self.assertEqual(payload['buildConfig']['source']['storageSource'],report['functions'][NAME]['source'])

    def test_unknown_patch_outcome_blocks_repeated_mutation(self):
        with tempfile.TemporaryDirectory() as d:
            directory=Path(d);info,report,raw=self.fixture(directory)
            with self.assertRaises(OSError):self.exercise(directory,info,report,raw,True,fail_after_patch=True)
            self.assertEqual(json.loads((directory/('release-'+NAME+'.json')).read_text())['status'],'patching')
            with self.assertRaisesRegex(ValueError,'Ambiguous'):self.exercise(directory,info,report,raw,True)

    def test_protected_field_snapshots_identify_changes_without_secret_values(self):
        original={'serviceConfig':{'environmentVariables':{'PRIVATE':'secret-token'},'timeoutSeconds':30},'eventTrigger':{'retryPolicy':'RETRY_POLICY_RETRY'}}
        changed=copy.deepcopy(original);changed['eventTrigger']['retryPolicy']='RETRY_POLICY_DO_NOT_RETRY'
        a=M.protected_fields(original);b=M.protected_fields(changed)
        self.assertEqual([k for k in a if a[k]!=b[k]],['eventTrigger.retryPolicy'])
        self.assertNotIn('PRIVATE',json.dumps(a));self.assertNotIn('secret-token',json.dumps(a))

    def test_filter_order_recovery_requires_the_entire_old_fingerprint(self):
        info={'serviceConfig':{'timeoutSeconds':30},'eventTrigger':{'eventFilters':[{'attribute':'database','value':'(default)'},{'attribute':'document','value':'tournaments/{code}/matchBuckets/{bucketId}'}],'retryPolicy':'RETRY_POLICY_RETRY'}}
        expected=M.digest(M.protected(info));changed=copy.deepcopy(info)
        changed['eventTrigger']['eventFilters'].reverse()
        self.assertEqual(M.settings_comparison(changed,expected),'event-filter-order-only')
        changed['eventTrigger']['eventFilters'][0]['value']='different'
        self.assertIsNone(M.settings_comparison(changed,expected))
        changed=copy.deepcopy(info);changed['eventTrigger']['eventFilters'].reverse();changed['serviceConfig']['timeoutSeconds']=60
        self.assertIsNone(M.settings_comparison(changed,expected))

    def test_verify_pending_release_never_uploads_or_patches(self):
        with tempfile.TemporaryDirectory() as d:
            directory=Path(d);info,report,raw=self.fixture(directory)
            state={'action':'release','status':'pending','operation':M.PARENT+'/operations/one', 'protectedSha256':M.digest(M.protected(info))}
            journal=directory/('release-'+NAME+'.json');journal.write_text(json.dumps(state))
            info['serviceConfig']['revision']='released'
            info['buildConfig']['source']['storageSource']['generation']='2'
            def api(resource,method='GET',body=None):
                self.assertEqual(method,'GET')
                return {'done':True} if '/operations/' in resource else copy.deepcopy(info)
            def command(args):Path(args[4]).write_bytes(raw);return ''
            with patch.object(M,'load_review',return_value=(directory,report)),patch.object(M,'token',return_value='test-only'),patch.object(M.PREP,'policy_snapshot'),patch.object(M,'api',side_effect=api),patch.object(M,'upload') as upload,patch.object(M.CAP,'command',side_effect=command),patch.dict(M.CANDIDATES,{NAME:M.digest(raw)}):
                result=M.run(directory,NAME,verify=True)
                self.assertTrue(result['verificationOnly']);self.assertEqual(result['status'],'complete');upload.assert_not_called()
            self.assertEqual(json.loads(journal.read_text())['protectedSha256'],state['protectedSha256'])

    def test_signed_upload_rejects_non_google_host(self):
        with self.assertRaises(ValueError):M.upload('https://evil.example/upload',b'zip')

if __name__=='__main__':unittest.main()
