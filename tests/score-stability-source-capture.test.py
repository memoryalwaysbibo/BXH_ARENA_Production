"""Offline source capture boundaries. No Cloud access."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import zipfile
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('capture',ROOT/'operator/BXH816_capture_bucket_sources.py')
M=importlib.util.module_from_spec(spec);spec.loader.exec_module(M)

class Capture(unittest.TestCase):
    def test_only_code_and_package_files_selected_and_nothing_executed(self):
        with tempfile.TemporaryDirectory() as directory:
            p=Path(directory)/'source.zip'
            with zipfile.ZipFile(p,'w') as z:
                for name in ['index.js','package.json','package-lock.json','engine/index.cjs','bucket-state.cjs','.env','credentials.json','node_modules/private.cjs','unrelated/code.cjs']:
                    z.writestr(name,'synthetic '+name)
            result=M.select_source(p)
            self.assertEqual(set(result),{'index.js','package.json','package-lock.json','engine/index.cjs','bucket-state.cjs'})
            self.assertEqual(list(Path(directory).iterdir()),[p])

    def test_unsafe_archive_and_missing_entrypoint_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            p=Path(directory)/'source.zip'
            for name in ['../x','/x','a\\x','ordinary.txt']:
                with zipfile.ZipFile(p,'w') as z:z.writestr(name,'synthetic')
                with self.assertRaises(ValueError):M.select_source(p)

    def test_deployment_generation_is_immutable_and_project_fixed(self):
        name='commitBucketRefereeCommand'
        info={'name':f'projects/bxh-arena/locations/asia-east1/functions/{name}','state':'ACTIVE','buildConfig':{'source':{'storageSource':{'bucket':'gcf-v2-sources-87261141693-asia-east1','object':name+'/function-source.zip','generation':M.GENERATIONS[name]}}},'serviceConfig':{}}
        with patch.object(M,'command',return_value=json.dumps(info)):self.assertEqual(M.describe(name)['source']['generation'],M.GENERATIONS[name])
        info['buildConfig']['source']['storageSource']['generation']='changed'
        with patch.object(M,'command',return_value=json.dumps(info)):
            with self.assertRaises(RuntimeError):M.describe(name)

if __name__=='__main__':unittest.main()
