import importlib.util
import json
from pathlib import Path
import shutil
import tempfile
import unittest
import zipfile

SCRIPT = Path(__file__).resolve().parents[1]/'community-name-mode/diagnose-startup.py'

def module():
    spec=importlib.util.spec_from_file_location('startup',SCRIPT)
    m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
    return m

class StartupTests(unittest.TestCase):
    def test_cloud_output_excludes_unrelated_environment_values(self):
        m=module()
        data=m.safe_revision({'metadata':{'annotations':{'secret':'DO_NOT_PRINT'}},
             'spec':{'containers':[{'env':[{'name':'TOKEN','value':'DO_NOT_PRINT'},
                          {'name':'FUNCTION_TARGET','value':'familyRegistration'}]}]}})
        self.assertNotIn('DO_NOT_PRINT',json.dumps(data))
        self.assertEqual(data['startupEnvironment'],{'FUNCTION_TARGET':'familyRegistration'})

    def test_unreviewed_or_unsafe_archive_is_rejected(self):
        m=module()
        with tempfile.TemporaryDirectory() as td:
            root=Path(td);archive=root/'source.zip'
            with zipfile.ZipFile(archive,'w') as z:z.writestr('../escape.js','bad')
            with self.assertRaisesRegex(ValueError,'SOURCE_HASH_CHANGED'):
                m.extract(archive,root/'output','0'*64)
            with self.assertRaisesRegex(ValueError,'UNSAFE_ARCHIVE_PATH'):
                m.extract(archive,root/'output',m.sha(archive.read_bytes()))
            self.assertFalse((root/'escape.js').exists())

    def test_tcp_probe_checks_startup_and_stops_local_server(self):
        m=module();events=[];m.emit=lambda status,**fields:events.append({'status':status,**fields})
        with tempfile.TemporaryDirectory() as td:
            root=Path(td);framework=root/'framework.js'
            framework.write_text("const net=require('node:net'); const port=Number(process.argv.find(x=>x.startsWith('--port=')).slice(7)); if(process.env.FUNCTION_TARGET!=='familyRegistration')process.exit(2); net.createServer(s=>s.end()).listen(port,'127.0.0.1');")
            self.assertTrue(m.listen(Path(shutil.which('node')),framework,root,'candidate',root))
            self.assertTrue(events[-1]['listening'])
            self.assertTrue(events[-1]['stoppedAfterProbe'])
            self.assertIsNone(events[-1]['exitCode'])

    def test_failed_local_boot_is_reported(self):
        m=module();events=[];m.emit=lambda status,**fields:events.append({'status':status,**fields})
        with tempfile.TemporaryDirectory() as td:
            root=Path(td);framework=root/'framework.js';framework.write_text('process.exit(7);')
            self.assertFalse(m.listen(Path(shutil.which('node')),framework,root,'candidate',root))
            self.assertEqual(events[-1]['exitCode'],7)
            self.assertFalse(events[-1]['stoppedAfterProbe'])

if __name__=='__main__':unittest.main()
