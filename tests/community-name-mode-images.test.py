import hashlib
import importlib.util
import io
import json
from pathlib import Path
import unittest
from urllib.error import HTTPError

SCRIPT=Path(__file__).resolve().parents[1]/'community-name-mode/inspect-images.py'

def module():
    spec=importlib.util.spec_from_file_location('images',SCRIPT)
    m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m

class ImageTests(unittest.TestCase):
    def test_startup_summary_omits_unrelated_environment_values(self):
        m=module();result=m.summary({'config':{'Env':['TOKEN=SECRET','PATH=/layers/node/bin'],
             'Labels':{'io.buildpacks.build.metadata':json.dumps({'processes':[{'type':'web','command':'framework'}]})}}})
        self.assertNotIn('SECRET',json.dumps(result))
        self.assertEqual(result['startupEnvironment'],{'PATH':'/layers/node/bin'})
        self.assertEqual(result['processes'][0]['command'],'framework')

    def test_redirect_to_signed_storage_does_not_forward_access_token(self):
        m=module();data=b'{}';digest='sha256:'+hashlib.sha256(data).hexdigest();calls=[]
        class Opener:
            def open(self,request,timeout):
                calls.append(request)
                if len(calls)==1:raise HTTPError(request.full_url,302,'redirect',{'Location':'https://storage.googleapis.com/object?signature=x'},None)
                return io.BytesIO(data)
        self.assertEqual(m.Registry('SECRET_TOKEN',Opener()).read('https://'+m.HOST+'/v2/repo/blobs/'+digest,digest),{})
        self.assertEqual(calls[0].get_header('Authorization'),'Bearer SECRET_TOKEN')
        self.assertIsNone(calls[1].get_header('Authorization'))

    def test_wrong_blob_digest_is_rejected(self):
        m=module()
        class Opener:
            def open(self,*args,**kwargs):return io.BytesIO(b'{}')
        with self.assertRaisesRegex(ValueError,'IMAGE_METADATA_HASH_MISMATCH'):
            m.Registry('token',Opener()).read('https://'+m.HOST+'/v2/repo/blobs/sha256:'+'0'*64,'sha256:'+'0'*64)

    def test_manifest_index_selects_linux_amd64_and_verified_config(self):
        m=module();registry=m.Registry('token');calls=[]
        top,child,config=['sha256:'+x*64 for x in 'abc']
        def read(url,digest):
            calls.append((url,digest))
            return {top:{'manifests':[{'digest':child,'platform':{'os':'linux','architecture':'amd64'}}]},
                    child:{'config':{'digest':config}},config:{'config':{'Entrypoint':['launcher']}}}[digest]
        registry.read=read
        result=registry.config(m.PREFIX+'image@'+top)
        self.assertEqual(result['config']['Entrypoint'],['launcher'])
        self.assertEqual([x[1] for x in calls],[top,child,config])

if __name__=='__main__':unittest.main()
