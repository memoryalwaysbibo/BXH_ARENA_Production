"""Patch only the deployed referee engine's bronze prerequisite; preserve live source/config."""
import argparse
import copy
import hashlib
import io
import json
import os
from pathlib import Path
import subprocess
import tempfile
import time
import urllib.error
import urllib.request
import zipfile

PROJECT = 'bxh-arena'
ACCOUNT = 'memoryalwaysbibo@gmail.com'
FUNCTION = 'projects/bxh-arena/locations/asia-east1/functions/commitRefereeCommand'
API = 'https://cloudfunctions.googleapis.com/v2/'
OLD = '''function singleElimBronzeBeforeFinalBlocked(match,matches=state.matches,meta=state.meta){
  if(!match||match.bracket!=="SE") return false;
  const gate=singleElimBronzeGatePhase(matches,meta);
  if(!gate) return false;
  return Number(match.round||0)===Number(gate.finalRound);
}'''
NEW = '''function singleElimBronzeBeforeFinalBlocked(match,matches=state.matches,meta=state.meta){
  // Bronze keeps automatic queue priority; manual finals order is unrestricted.
  return false;
}'''


def sha(data):
    return hashlib.sha256(data).hexdigest()


def cli(*args):
    result = subprocess.run(['gcloud', *args, '--project='+PROJECT,
                             '--account='+ACCOUNT, '--quiet'],
                            capture_output=True, timeout=120)
    if result.returncode:
        raise RuntimeError('gcloud-command-failed: '+args[0])
    return result.stdout


def api(path, method='GET', body=None):
    token = cli('auth', 'print-access-token').decode().strip()
    data = None if body is None else json.dumps(body).encode()
    request = urllib.request.Request(API+path, data=data, method=method,
        headers={'Authorization':'Bearer '+token, 'Content-Type':'application/json'})
    with urllib.request.urlopen(request, timeout=120) as response:
        return json.load(response)


def storage_source(meta):
    source = meta.get('buildConfig', {}).get('source', {}).get('storageSource', {})
    if not all(source.get(k) for k in ('bucket', 'object', 'generation')):
        raise RuntimeError('missing-immutable-source')
    return source


def config(meta):
    service = dict(meta.get('serviceConfig', {}))
    service.pop('revision', None)
    build = dict(meta.get('buildConfig', {}))
    for field in ('source', 'sourceProvenance', 'build'):
        build.pop(field, None)
    return {'serviceConfig':service, 'buildConfig':build,
            'labels':meta.get('labels', {}), 'environment':meta.get('environment')}


def patch_archive(blob):
    if len(blob) > 20*1024*1024:
        raise RuntimeError('source-archive-too-large')
    with zipfile.ZipFile(io.BytesIO(blob)) as archive:
        infos = archive.infolist()
        names = [i.filename for i in infos]
        if len(names) != len(set(names)) or len(names) > 2048:
            raise RuntimeError('unexpected-source-layout')
        if sum(i.file_size for i in infos) > 40*1024*1024:
            raise RuntimeError('expanded-source-too-large')
        for item in infos:
            if item.filename.startswith('/') or '..' in Path(item.filename).parts or item.flag_bits & 1:
                raise RuntimeError('unsafe-source-entry')
        candidates = [name for name in names if name in ('engine/index.cjs', 'functions/engine/index.cjs')]
        if len(candidates) != 1:
            raise RuntimeError('engine-layout-changed')
        target = candidates[0]
        files = {item.filename:archive.read(item) for item in infos}
        source = files[target].decode()
        if NEW in source:
            return None, target
        if source.count(OLD) != 1:
            raise RuntimeError('live-engine-anchor-changed')
        files[target] = source.replace(OLD, NEW).encode()
        # Every other entry, including exports, dependencies, community support,
        # bucket guards and scoring logic, must remain byte-identical.
        output = io.BytesIO()
        with zipfile.ZipFile(output, 'w') as result:
            for item in infos:
                result.writestr(copy.copy(item), files[item.filename])
        candidate = output.getvalue()
        with zipfile.ZipFile(io.BytesIO(candidate)) as result:
            changed = [name for name in names if archive.read(name) != result.read(name)]
            if changed != [target]:
                raise RuntimeError('unexpected-change-scope')
        return candidate, target


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument('--check', action='store_true')
    mode.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    os.umask(0o077)
    before = api(FUNCTION)
    if before.get('state') != 'ACTIVE' or before.get('buildConfig', {}).get('entryPoint') != 'commitRefereeCommand':
        raise RuntimeError('function-not-active-or-entrypoint-changed')
    source = storage_source(before)
    uri = 'gs://'+source['bucket']+'/'+source['object']+'#'+str(source['generation'])
    baseline = cli('storage', 'cat', uri)
    candidate, target = patch_archive(baseline)
    if candidate is None:
        print(json.dumps({'status':'ALREADY_RELEASED', 'cloudWrites':0})); return
    journal = Path(tempfile.mkdtemp(prefix='bxh-finals-order-735-'))
    (journal/'baseline.zip').write_bytes(baseline)
    (journal/'candidate.zip').write_bytes(candidate)
    (journal/'baseline-function.json').write_text(json.dumps(before, indent=2))
    # Syntax validation uses only node, never evaluates cloud code or installs dependencies.
    with zipfile.ZipFile(io.BytesIO(candidate)) as archive:
        engine = journal/'engine.cjs'; engine.write_bytes(archive.read(target))
    subprocess.run(['node', '--check', str(engine)], check=True, capture_output=True)
    print(json.dumps({'status':'CANDIDATE_READY', 'changedFiles':[target],
                      'baselineSha256':sha(baseline), 'candidateSha256':sha(candidate),
                      'cloudWrites':0, 'journal':str(journal)}), flush=True)
    if args.check:
        return
    latest = api(FUNCTION)
    if latest.get('updateTime') != before.get('updateTime') or storage_source(latest) != source or config(latest) != config(before):
        raise RuntimeError('live-function-changed-before-upload')
    upload = api('projects/'+PROJECT+'/locations/asia-east1/functions:generateUploadUrl', 'POST', {})
    request = urllib.request.Request(upload['uploadUrl'], data=candidate, method='PUT',
                                    headers={'Content-Type':'application/zip'})
    with urllib.request.urlopen(request, timeout=120) as response:
        response.read()
    latest = api(FUNCTION)
    if latest.get('updateTime') != before.get('updateTime') or config(latest) != config(before):
        raise RuntimeError('live-function-changed-before-submit')
    operation = api(FUNCTION+'?updateMask=buildConfig.source', 'PATCH',
                    {'name':FUNCTION, 'buildConfig':{'source':{'storageSource':upload['storageSource']}}})
    (journal/'operation.json').write_text(json.dumps(operation, indent=2))
    print(json.dumps({'status':'FUNCTION_OPERATION_PENDING', 'journal':str(journal)}), flush=True)
    deadline = time.monotonic()+1800
    while not operation.get('done'):
        if time.monotonic() > deadline:
            raise RuntimeError('operation-pending-check-journal-do-not-resubmit')
        time.sleep(10)
        operation = api(operation['name'])
        (journal/'operation.json').write_text(json.dumps(operation, indent=2))
    if operation.get('error'):
        raise RuntimeError('function-operation-failed-code-'+str(operation['error'].get('code')))
    after = api(FUNCTION)
    (journal/'released-function.json').write_text(json.dumps(after, indent=2))
    if after.get('state') != 'ACTIVE' or config(after) != config(before):
        raise RuntimeError('released-function-config-mismatch')
    resolved = storage_source(after)
    released = cli('storage', 'cat', 'gs://'+resolved['bucket']+'/'+resolved['object']+'#'+str(resolved['generation']))
    if sha(released) != sha(candidate):
        raise RuntimeError('released-source-mismatch')
    print(json.dumps({'status':'RELEASE_VERIFIED', 'function':'commitRefereeCommand',
                      'revision':after.get('serviceConfig', {}).get('revision'),
                      'candidateSha256':sha(candidate), 'journal':str(journal)}))


if __name__ == '__main__':
    try:
        main()
    except urllib.error.HTTPError as error:
        print(json.dumps({'status':'STOP', 'reason':'http-'+str(error.code)})); raise SystemExit(1)
    except Exception as error:
        reason = str(error) if type(error) is RuntimeError else type(error).__name__
        print(json.dumps({'status':'STOP', 'reason':reason})); raise SystemExit(1)
