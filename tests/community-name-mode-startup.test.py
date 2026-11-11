import importlib.util
import json
import io
from pathlib import Path
import shutil
import tempfile
import tarfile
import unittest
import zipfile

SCRIPT = Path(__file__).resolve().parents[1]/'community-name-mode/diagnose-startup.py'

def module():
    spec=importlib.util.spec_from_file_location('startup',SCRIPT)
    m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
    return m

class StartupTests(unittest.TestCase):
    def fixture_download(self,m,valid=True):
        filename='node-v22.1.0-linux-x64.tar.xz'
        data=io.BytesIO()
        with tarfile.open(fileobj=data,mode='w:xz') as tar:
            node=b'fixture-node-binary';entry=tarfile.TarInfo(filename[:-7]+'/bin/node');entry.size=len(node)
            tar.addfile(entry,io.BytesIO(node))
        archive=data.getvalue();checksum=m.sha(archive) if valid else '0'*64
        class Response(io.BytesIO):
            def __init__(self,data,url):super().__init__(data);self.url=url
            def geturl(self):return self.url
        calls=[]
        def opener(request,timeout):
            url=request.full_url;calls.append(url)
            body=(checksum+'  '+filename+'\n').encode() if url.endswith('SHASUMS256.txt') else archive
            return Response(body,url)
        return opener,calls

    def test_official_node_download_verifies_checksum_and_extracts_only_binary(self):
        m=module();m.emit=lambda *args,**kwargs:None
        opener,calls=self.fixture_download(m)
        with tempfile.TemporaryDirectory() as temp:
            node=m.download_node22(Path(temp),opener=opener,machine='x86_64')
            self.assertEqual(node.read_bytes(),b'fixture-node-binary')
            self.assertEqual(node.stat().st_mode&0o777,0o700)
            self.assertEqual(list(Path(temp).glob('*.xz')),[])
        self.assertTrue(calls[1].endswith('/v22.1.0/node-v22.1.0-linux-x64.tar.xz'))

    def test_bad_node_download_checksum_blocks_binary_creation(self):
        m=module();opener,_=self.fixture_download(m,valid=False)
        with tempfile.TemporaryDirectory() as temp:
            with self.assertRaisesRegex(ValueError,'NODE22_DOWNLOAD_CHECKSUM_MISMATCH'):
                m.download_node22(Path(temp),opener=opener,machine='x86_64')
            self.assertFalse((Path(temp)/'runtime/bin/node').exists())

    def test_node_download_rejects_an_unexpected_origin(self):
        m=module()
        class Response(io.BytesIO):
            def geturl(self):return 'https://example.com/SHASUMS256.txt'
        with tempfile.TemporaryDirectory() as temp:
            with self.assertRaisesRegex(ValueError,'NODE_DOWNLOAD_ORIGIN'):
                m.download_node22(Path(temp),opener=lambda *args,**kwargs:Response(b''),machine='x86_64')

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
