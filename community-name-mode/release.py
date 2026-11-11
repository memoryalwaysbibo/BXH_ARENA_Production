#!/usr/bin/env python3
"""Verify, publish, resume, or inspect the staged BXH community name sources."""
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import runpy
import subprocess
import tempfile
import time
from urllib.error import HTTPError
from urllib.parse import unquote, urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

ROOT = Path(__file__).resolve().parent
STAGE = runpy.run_path(str(ROOT/'stage-live.py'))
LOCATION = 'projects/bxh-arena/locations/asia-east1'
API = 'https://cloudfunctions.googleapis.com/v2/'
EXPECTED_MANIFEST_SHA = '8b8072bbc7760ed2f5d77c9670d94b12c9b5b2e8d71a7b6e439f7af6b1b41abf'

def need(value, reason):
    if not value:
        raise ValueError(reason)

def digest(value):
    return hashlib.sha256(value).hexdigest()

def emit(status, **fields):
    print(json.dumps({'status':status, **fields}), flush=True)

class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None

class Cloud:
    def __init__(self):
        self.opener = build_opener(NoRedirect())
        self.token_expiry = 0

    def api(self, path, method='GET', payload=None):
        if time.monotonic() >= self.token_expiry:
            self.token = subprocess.check_output(
                ['gcloud','auth','print-access-token','--quiet'], text=True, timeout=30).strip()
            need(self.token, 'CLOUD_SHELL_AUTH_REQUIRED')
            self.token_expiry = time.monotonic()+600
        data = None if payload is None else json.dumps(payload).encode()
        request = Request(API+path, data=data, method=method,
                          headers={'Authorization':'Bearer '+self.token,'Content-Type':'application/json'})
        with self.opener.open(request, timeout=60) as response:
            return json.load(response)

    def upload(self, archive, kms_key):
        args = {'environment':'GEN_2'}
        if kms_key:
            args['kmsKeyName'] = kms_key
        ticket = self.api(LOCATION+'/functions:generateUploadUrl','POST',args)
        url, source = ticket['uploadUrl'], ticket['storageSource']
        bucket, obj = source['bucket'], source['object']
        parsed = urlsplit(url)
        path = unquote(parsed.path, errors='strict')
        need(re.fullmatch(r'[a-z0-9][a-z0-9._-]+',bucket) and obj and not any(c in obj for c in '\r\n#')
             and parsed.scheme == 'https' and parsed.port in (None,443)
             and not (parsed.username or parsed.password or parsed.fragment) and parsed.query
             and ((parsed.hostname == 'storage.googleapis.com' and path == f'/{bucket}/{obj}')
                  or (parsed.hostname == f'{bucket}.storage.googleapis.com' and path == f'/{obj}')),
             'UPLOAD_URL_BINDING')
        request = Request(url,data=archive,headers={'Content-Type':'application/zip'},method='PUT')
        with self.opener.open(request,timeout=120) as response:
            generation = response.headers.get('x-goog-generation') or source.get('generation')
        binding = {'bucket':bucket,'object':obj}
        if generation:
            need(re.fullmatch(r'[0-9]+',str(generation)), 'UPLOAD_GENERATION')
            binding['generation'] = str(generation)
        return binding

    def submit(self, name, source):
        function = LOCATION+'/functions/'+name
        result = self.api(function+'?updateMask=buildConfig.source','PATCH',{
            'name':function,'buildConfig':{'source':{'storageSource':source}}})
        operation = result['name']
        need(re.fullmatch(r'projects/(bxh-arena|87261141693)/locations/asia-east1/operations/[A-Za-z0-9_-]+',operation),
             'OPERATION_SCOPE')
        return operation

    def wait(self, operation):
        deadline = time.monotonic()+1200
        last = 0
        while time.monotonic() < deadline:
            result = self.api(operation)
            if result.get('done'):
                need('error' not in result,'OPERATION_FAILED_'+str(result.get('error',{}).get('code')))
                return
            if time.monotonic()-last >= 30:
                emit('NAME_MODE_OPERATION_PENDING',operation=operation)
                last = time.monotonic()
            time.sleep(8)
        raise ValueError('OPERATION_PENDING_USE_RESUME')

def verify_local(root):
    manifest_path = root/'manifest.json'
    need(manifest_path.is_file() and not manifest_path.is_symlink(), 'LOCAL_MANIFEST_REQUIRED')
    manifest_bytes = manifest_path.read_bytes()
    need(digest(manifest_bytes) == EXPECTED_MANIFEST_SHA, 'STAGING_MANIFEST_CHANGED')
    manifest = json.loads(manifest_bytes)
    need((manifest.get('status'),manifest.get('project'),manifest.get('region'),manifest.get('productionWrites'))
         == ('NAME_MODE_BACKEND_STAGED','bxh-arena','asia-east1',0), 'MANIFEST_SCOPE')
    need(set(manifest.get('writers',{})) == set(STAGE['NAMES']), 'FUNCTION_SET')
    reference = json.loads((ROOT/'release-inputs.json').read_text())
    helper = ROOT/'participant-names.js'
    if not helper.is_file():
        helper = ROOT.parent/'modules/main-app/participant-names.js'
    helper_bytes = helper.read_bytes()
    patcher = ROOT/'prepare-family.cjs'
    need(digest(helper_bytes) == reference['helperSha256']
         and digest(patcher.read_bytes()) == reference['patcherSha256'], 'LOCAL_POLICY_HASH')
    for name,row in manifest['writers'].items():
        folder = root/name
        for filename in ('original.zip','candidate.zip','function.json'):
            need((folder/filename).is_file() and not (folder/filename).is_symlink(), name+': local-file')
        original = (folder/'original.zip').read_bytes()
        candidate = (folder/'candidate.zip').read_bytes()
        need(digest(original) == row['originalSha256'] and digest(candidate) == row['candidateSha256'],name+': archive-hash')
        handler, helper_path, before = STAGE['validate_source'](name,original,reference)
        after = STAGE['entries'](candidate)
        with tempfile.TemporaryDirectory(prefix='bxh784-local-') as temp:
            source = Path(temp)/'handler.js'
            source.write_bytes(before[handler])
            patched = subprocess.check_output(['node',str(patcher),str(source),digest(before[handler])],timeout=30)
            source.write_bytes(patched)
            subprocess.check_call(['node','--check',str(source)],timeout=30)
        need(row['handlerPath'] == handler and row['helperPath'] == helper_path
             and row['handlerSha256'] == digest(patched), name+': policy-path-or-hash')
        need(set(after) == set(before)|{helper_path} and after[helper_path] == helper_bytes
             and after[handler] == patched and all(after[p] == value for p,value in before.items() if p != handler),
             name+': unexpected-source-change')
        info = json.loads((folder/'function.json').read_text())
        need(info.get('name') == LOCATION+'/functions/'+name
             and info['buildConfig'].get('entryPoint') == name
             and info['serviceConfig']['revision'] == row['revision']
             and STAGE['configuration'](info) == row['configurationSha256'],name+': saved-settings')
        need(len(row['sourcePointer']) == 3 and all(isinstance(x,str) and x for x in row['sourcePointer']),name+': saved-pointer')
    return manifest,digest(manifest_bytes)

def read_source(name, info, pointer, expected):
    with tempfile.TemporaryDirectory(prefix='bxh784-source-') as temp:
        target = Path(temp)/'source.zip'
        STAGE['command']('gcloud','storage','cp',f'gs://{pointer[0]}/{pointer[1]}#{pointer[2]}',str(target),
                         '--project=bxh-arena','--quiet')
        need(digest(target.read_bytes()) == expected,name+': live-source-hash')
    need(STAGE['describe'](name) == (info,pointer),name+': source-changed-during-read')

def original_baseline(name,row,read_archive=True):
    info,pointer = STAGE['describe'](name)
    need(info['serviceConfig']['revision'] == row['revision'] and list(pointer) == row['sourcePointer']
         and STAGE['configuration'](info) == row['configurationSha256'],name+': live-baseline-changed')
    if read_archive:
        read_source(name,info,pointer,row['originalSha256'])
    return info,pointer

def deployed_baseline(name,row,verified=None):
    info,pointer = STAGE['describe'](name)
    need(info['serviceConfig']['revision'] != row['revision']
         and STAGE['configuration'](info) == row['configurationSha256'],name+': deployed-settings-or-revision')
    if verified:
        need(info['serviceConfig']['revision'] == verified['revision']
             and list(pointer) == verified['sourcePointer'],name+': deployed-baseline-changed')
    read_source(name,info,pointer,row['candidateSha256'])
    return {'revision':info['serviceConfig']['revision'],'sourcePointer':list(pointer),
            'configurationSha256':row['configurationSha256'],'candidateSha256':row['candidateSha256']}

def run(root,mode):
    root = root.resolve()
    manifest,manifest_sha = verify_local(root)
    journal_path = root/'name-mode-release.jsonl'
    if mode == 'check':
        need(not journal_path.exists(),'RELEASE_ALREADY_STARTED_USE_STATUS_OR_RESUME')
        for name in STAGE['NAMES']:
            original_baseline(name,manifest['writers'][name])
            emit('NAME_MODE_SOURCE_VERIFIED',function=name)
        emit('NAME_MODE_RELEASE_READY',functions=len(STAGE['NAMES']),manifestSha256=manifest_sha,productionWrites=0)
        return
    if mode == 'status':
        need(journal_path.is_file(),'RELEASE_NOT_STARTED')
        with journal_path.open() as stream:
            fcntl.flock(stream.fileno(),fcntl.LOCK_SH|fcntl.LOCK_NB)
            records = [json.loads(line) for line in stream]
        need(records and records[0].get('manifestSha256') == manifest_sha,'JOURNAL_MANIFEST')
        latest = {r['function']:r for r in records if 'function' in r}
        for name in STAGE['NAMES']:
            row = latest.get(name,{'status':'NOT_STARTED'})
            emit('NAME_MODE_FUNCTION_STATUS',function=name,state=row['status'])
            if row['status'] == 'OPERATION':
                observed = Cloud().api(row['operation'])
                emit('NAME_MODE_OPERATION_STATUS',function=name,done=observed.get('done',False),errorCode=observed.get('error',{}).get('code'))
        return
    flags = os.O_RDWR|os.O_APPEND|os.O_NOFOLLOW
    if mode == 'apply':
        flags |= os.O_CREAT|os.O_EXCL
    else:
        need(journal_path.is_file(),'RELEASE_NOT_STARTED')
    with os.fdopen(os.open(journal_path,flags,0o600),'a+') as journal:
        fcntl.flock(journal.fileno(),fcntl.LOCK_EX|fcntl.LOCK_NB)
        journal.seek(0)
        records = [json.loads(line) for line in journal]
        def record(status,**fields):
            row = {'status':status,**fields}
            journal.write(json.dumps(row)+'\n');journal.flush();os.fsync(journal.fileno())
            records.append(row);emit('NAME_MODE_'+status,**fields)
        if mode == 'apply':
            record('STARTED',manifestSha256=manifest_sha)
        need(records and records[0].get('manifestSha256') == manifest_sha,'JOURNAL_MANIFEST')
        latest = {r['function']:r for r in records if 'function' in r}
        cloud = Cloud()
        # Check every unstarted source before changing the first function.
        for name in STAGE['NAMES']:
            row = manifest['writers'][name]
            previous = latest.get(name)
            if not previous or previous['status'] == 'UPLOADING':
                original_baseline(name,row)
            elif previous['status'] == 'VERIFIED':
                deployed_baseline(name,row,previous)
            elif previous['status'] not in ('SUBMITTING','OPERATION'):
                raise ValueError(name+': journal-state')
        for name in STAGE['NAMES']:
            row = manifest['writers'][name]
            previous = latest.get(name)
            if previous and previous['status'] == 'VERIFIED':
                continue
            if previous and previous['status'] == 'OPERATION':
                cloud.wait(previous['operation'])
            elif previous and previous['status'] == 'SUBMITTING':
                # Never resubmit a PATCH whose response may have been lost.
                try:
                    observed = deployed_baseline(name,row)
                except Exception:
                    raise ValueError(name+': SUBMISSION_UNCONFIRMED_DO_NOT_REAPPLY') from None
                record('VERIFIED',function=name,**observed)
                continue
            else:
                before,pointer = original_baseline(name,row,read_archive=False)
                record('UPLOADING',function=name)
                source = cloud.upload((root/name/'candidate.zip').read_bytes(),before.get('kmsKeyName'))
                need(STAGE['describe'](name) == (before,pointer),name+': baseline-changed-after-upload')
                record('SUBMITTING',function=name)
                operation = cloud.submit(name,source)
                record('OPERATION',function=name,operation=operation)
                cloud.wait(operation)
            observed = deployed_baseline(name,row)
            record('VERIFIED',function=name,**observed)
        verified = {r['function']:r for r in records if r['status'] == 'VERIFIED'}
        for name in STAGE['NAMES']:
            deployed_baseline(name,manifest['writers'][name],verified[name])
        record('BACKEND_RELEASE_VERIFIED',functions=len(STAGE['NAMES']),manifestSha256=manifest_sha,
               frontendPublished=False)

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('staging',type=Path)
    modes = parser.add_mutually_exclusive_group(required=True)
    for label in ('check','apply','resume','status'):
        modes.add_argument('--'+label,dest='mode',action='store_const',const=label)
    args = parser.parse_args()
    try:
        run(args.staging,args.mode)
    except HTTPError as error:
        emit('NAME_MODE_RELEASE_STOPPED',reason='HTTP_'+str(error.code))
        raise SystemExit(1) from None
    except Exception as error:
        emit('NAME_MODE_RELEASE_STOPPED',reason=str(error) if type(error) is ValueError else type(error).__name__)
        raise SystemExit(1) from None
