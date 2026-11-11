#!/usr/bin/env python3
"""Read the ready and failed image startup metadata; no image or service writes."""
import hashlib
import json
import re
import subprocess
from urllib.error import HTTPError
from urllib.parse import urljoin, urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

HOST = 'asia-east1-docker.pkg.dev'
PREFIX = HOST+'/bxh-arena/gcf-artifacts/'
REVISIONS = ('familyregistration-00042-wor','familyregistration-00043-xet')
ACCEPT = ', '.join(('application/vnd.oci.image.manifest.v1+json',
    'application/vnd.docker.distribution.manifest.v2+json',
    'application/vnd.oci.image.index.v1+json',
    'application/vnd.docker.distribution.manifest.list.v2+json'))

def need(value, reason):
    if not value:
        raise ValueError(reason)

class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self,*args,**kwargs):return None

class Registry:
    def __init__(self,token,opener=None):
        self.token=token
        self.opener=opener or build_opener(NoRedirect())

    def read(self,url,expected):
        need(re.fullmatch(r'sha256:[a-f0-9]{64}',expected),'INVALID_IMAGE_DIGEST')
        for _ in range(4):
            target=urlsplit(url)
            need(target.scheme=='https' and target.port in (None,443)
                 and not (target.username or target.password or target.fragment),'UNSAFE_IMAGE_URL')
            same=target.hostname==HOST
            storage=target.hostname=='storage.googleapis.com' or (target.hostname or '').endswith('.storage.googleapis.com')
            need(same or storage and bool(target.query),'UNEXPECTED_IMAGE_DOWNLOAD_HOST')
            headers={'Accept':ACCEPT}
            if same:headers['Authorization']='Bearer '+self.token
            try:
                with self.opener.open(Request(url,headers=headers),timeout=60) as response:
                    data=response.read(16*1024*1024+1)
                need(len(data)<=16*1024*1024,'IMAGE_METADATA_TOO_LARGE')
                need('sha256:'+hashlib.sha256(data).hexdigest()==expected,'IMAGE_METADATA_HASH_MISMATCH')
                return json.loads(data)
            except HTTPError as error:
                if error.code not in (301,302,303,307,308):raise
                location=error.headers.get('Location')
                need(location,'IMAGE_REDIRECT_WITHOUT_LOCATION')
                url=urljoin(url,location)
        raise ValueError('IMAGE_REDIRECT_LIMIT')

    def config(self,image):
        need(image.startswith(PREFIX),'IMAGE_PROJECT_SCOPE')
        name,digest=image.split('@',1)
        repository=name[len(HOST)+1:]
        need(re.fullmatch(r'bxh-arena/gcf-artifacts/[a-zA-Z0-9_.-]+',repository),'IMAGE_REPOSITORY_SCOPE')
        root='https://'+HOST+'/v2/'+repository
        manifest=self.read(root+'/manifests/'+digest,digest)
        if 'manifests' in manifest:
            choices=[m for m in manifest['manifests'] if m.get('platform',{}).get('os')=='linux'
                     and m.get('platform',{}).get('architecture')=='amd64']
            need(len(choices)==1,'AMBIGUOUS_IMAGE_PLATFORM')
            child=choices[0]['digest']
            manifest=self.read(root+'/manifests/'+child,child)
        config=manifest['config']['digest']
        return self.read(root+'/blobs/'+config,config)

def summary(value):
    config=value.get('config',{})
    environment={s.split('=',1)[0]:s.split('=',1)[1] for s in config.get('Env',[]) if '=' in s}
    allowed=('PATH','NODE_ENV','NODE_OPTIONS','FUNCTION_TARGET','FUNCTION_SIGNATURE_TYPE',
             'GOOGLE_FUNCTION_TARGET','GOOGLE_FUNCTION_SIGNATURE_TYPE','GOOGLE_ENTRYPOINT',
             'CNB_PROCESS_TYPE','GOOGLE_RUNTIME_VERSION','GOOGLE_NODEJS_VERSION')
    labels=config.get('Labels',{})
    def label(name):
        try:return json.loads(labels.get(name,'{}'))
        except (TypeError,ValueError):return {}
    build=label('io.buildpacks.build.metadata')
    lifecycle=label('io.buildpacks.lifecycle.metadata')
    return {'architecture':value.get('architecture'),'os':value.get('os'),
        'entrypoint':config.get('Entrypoint'),'cmd':config.get('Cmd'),
        'workingDir':config.get('WorkingDir'),'user':config.get('User'),
        'startupEnvironment':{k:environment[k] for k in allowed if k in environment},
        'processes':build.get('processes'),
        'buildpacks':[{k:b[k] for k in ('id','key','version') if k in b} for b in build.get('buildpacks',[])],
        'runImage':lifecycle.get('runImage'),
        'stackRunImage':lifecycle.get('stack',{}).get('runImage')}

def main():
    token=subprocess.check_output(['gcloud','auth','print-access-token','--quiet'],text=True,timeout=30).strip()
    need(token,'CLOUD_SHELL_AUTH_REQUIRED')
    registry=Registry(token)
    for revision in REVISIONS:
        image=subprocess.check_output(['gcloud','run','revisions','describe',revision,
            '--region=asia-east1','--project=bxh-arena','--format=value(spec.containers[0].image)'],
            text=True,timeout=60).strip()
        value=summary(registry.config(image))
        print(json.dumps({'status':'IMAGE_STARTUP_METADATA','revision':revision,'image':image,**value}),flush=True)
    print(json.dumps({'status':'IMAGE_COMPARISON_COMPLETE','cloudWrites':0}),flush=True)

if __name__=='__main__':
    try:main()
    except HTTPError as error:
        print(json.dumps({'status':'IMAGE_INSPECTION_STOPPED','reason':'HTTP_'+str(error.code),'cloudWrites':0}))
        raise SystemExit(1) from None
    except Exception as error:
        print(json.dumps({'status':'IMAGE_INSPECTION_STOPPED','reason':str(error) if type(error) is ValueError else type(error).__name__,'cloudWrites':0}))
        raise SystemExit(1) from None
