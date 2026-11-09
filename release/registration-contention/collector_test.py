import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
import zipfile


class CaptureTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='registration-capture-test-')
        self.root = Path(self.tmp.name)
        self.output = self.root / 'capture.zip'
        self.record = self.root / 'commands.jsonl'
        stub = self.root / 'gcloud'
        stub.write_text('''#!/usr/bin/env python3
import json,os,sys,zipfile
from pathlib import Path
with open(os.environ['REGISTRATION_TEST_COMMANDS'],'a') as f:f.write(json.dumps(sys.argv[1:])+'\\n')
if sys.argv[1:3]==['functions','describe']:
 print(json.dumps({'name':'projects/bxh-arena/locations/asia-east1/functions/'+os.environ.get('REGISTRATION_TEST_FUNCTION','familyRegistration'),'environment':'GEN_2','buildConfig':{'runtime':'nodejs22','source':{'storageSource':{'bucket':'fixture-bucket','object':'source.zip','generation':'1000'}}},'serviceConfig':{'timeoutSeconds':60,'maxInstanceRequestConcurrency':80,'environmentVariables':{'PRIVATE_TEST_VALUE':'synthetic-private-value'}}}))
elif sys.argv[1:3]==['storage','cp']:
 with zipfile.ZipFile(sys.argv[4],'w') as z:z.writestr('index.js','// synthetic source only')
else:raise SystemExit('Unexpected gcloud command')
''')
        stub.chmod(0o700)
        self.env = {**os.environ, 'PATH':str(self.root)+os.pathsep+os.environ['PATH'],
                    'REGISTRATION_TEST_COMMANDS':str(self.record)}

    def tearDown(self):
        self.tmp.cleanup()

    def run_capture(self):
        return subprocess.run([sys.executable, str(Path(__file__).with_name('collect_live_registration.py')),
                               '--output',str(self.output)], env=self.env, capture_output=True, text=True)

    def test_only_describe_and_generation_pinned_copy_preserving_private_config(self):
        result=self.run_capture()
        self.assertEqual(result.returncode,0,result.stderr)
        self.assertNotIn('synthetic-private-value',result.stdout)
        report=json.loads(result.stdout)
        self.assertEqual(report['cloudMutations'],0)
        commands=[json.loads(line) for line in self.record.read_text().splitlines()]
        self.assertEqual(len(commands),2)
        self.assertEqual(commands[0][:3],['functions','describe','familyRegistration'])
        self.assertIn('gs://fixture-bucket/source.zip#1000',commands[1])
        with zipfile.ZipFile(self.output) as capture:
            self.assertEqual(set(capture.namelist()),{'source.zip','report.json','function-description.json'})
            self.assertEqual(hashlib.sha256(capture.read('source.zip')).hexdigest(),report['sourceArchiveSha256'])
            self.assertIn('synthetic-private-value',capture.read('function-description.json').decode())

    def test_existing_output_is_never_overwritten(self):
        self.output.write_bytes(b'keep-existing')
        result=self.run_capture()
        self.assertNotEqual(result.returncode,0)
        self.assertEqual(self.output.read_bytes(),b'keep-existing')
        self.assertEqual(len(self.record.read_text().splitlines()),1)

    def test_wrong_identity_stops_before_download(self):
        self.env['REGISTRATION_TEST_FUNCTION']='wrongFunction'
        result=self.run_capture()
        self.assertNotEqual(result.returncode,0)
        self.assertFalse(self.output.exists())
        self.assertEqual(len(self.record.read_text().splitlines()),1)


if __name__=='__main__':
    unittest.main()
