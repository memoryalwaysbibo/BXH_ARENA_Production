#!/usr/bin/env python3
"""Read current function sources and stage the community name change locally."""
import argparse
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import stat
import subprocess
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parent
PROJECT = 'bxh-arena'
REGION = 'asia-east1'
V2 = ('registrationQueueV2', 'registrationRosterQueueV2', 'registrationQueueV2Worker',
      'registrationQueueV2Sweep', 'registrationDrawV2', 'registrationStartV2')
NAMES = ('familyRegistration',) + V2

def need(value, reason):
    if not value:
        raise ValueError(reason)

def digest(value):
    return hashlib.sha256(value).hexdigest()

def command(*args):
    return subprocess.check_output(list(args), timeout=120)

def describe(name):
    info = json.loads(command('gcloud', 'functions', 'describe', name, '--gen2',
                             '--region='+REGION, '--project='+PROJECT, '--format=json'))
    need(info.get('name') == f'projects/{PROJECT}/locations/{REGION}/functions/{name}'
         and info.get('state') == 'ACTIVE' and info.get('environment') == 'GEN_2'
         and info['buildConfig'].get('entryPoint') == name
         and info['serviceConfig'].get('allTrafficOnLatestRevision') is True,
         name+': function-state')
    source = info['buildConfig']['sourceProvenance']['resolvedStorageSource']
    pointer = (source['bucket'], source['object'], str(source['generation']))
    need(all(pointer) and pointer[2].isdigit() and '#' not in pointer[1], name+': source-pointer')
    return info, pointer

def entries(archive):
    result = {}
    with zipfile.ZipFile(io.BytesIO(archive)) as z:
        need(sum(i.file_size for i in z.infolist()) < 200*1024*1024, 'archive-size')
        for entry in z.infolist():
            p = PurePosixPath(entry.filename)
            need(not p.is_absolute() and '..' not in p.parts
                 and not stat.S_ISLNK(entry.external_attr >> 16), 'unsafe-archive-path')
            if entry.is_dir():
                continue
            need(str(p) not in result, 'duplicate-archive-path')
            result[str(p)] = z.read(entry)
    return result

def configuration(info):
    value = {k: info.get(k) for k in ('name', 'description', 'environment', 'labels', 'kmsKeyName', 'eventTrigger')}
    value['serviceConfig'] = {k:v for k,v in info['serviceConfig'].items() if k != 'revision'}
    value['buildConfig'] = {k:v for k,v in info['buildConfig'].items()
                            if k not in ('build', 'source', 'sourceProvenance', 'runtimeVersion')}
    policy = value['buildConfig'].get('onDeployUpdatePolicy')
    if policy is not None:
        value['buildConfig']['onDeployUpdatePolicy'] = {k:v for k,v in policy.items() if k != 'runtimeVersion'}
    return digest(json.dumps(value, sort_keys=True, separators=(',', ':')).encode())

def validate_source(name, archive, reference):
    baseline = reference['familyRegistration' if name == 'familyRegistration' else 'registrationQueueV2']
    if name in ('familyRegistration', 'registrationQueueV2'):
        need(digest(archive) == baseline['archiveSha256'], name+': captured-source-changed')
    files = entries(archive)
    if name in V2:
        actual = {p:digest(v) for p,v in files.items() if p.startswith('writer-inputs/familyRegistration/')}
        need(actual == baseline['familyFiles'], name+': family-dependencies-changed')
    handler = baseline['handlerPath']
    need(handler in files and digest(files[handler]) == baseline['handlerSha256'], name+': handler-changed')
    package = json.loads(files['package.json'])
    need(package.get('engines', {}).get('node') == '22', name+': runtime-changed')
    helper = str(PurePosixPath(handler).parent / 'participant-names.js')
    need(helper not in files, name+': helper-already-present')
    return handler, helper, files

def candidate(archive, handler, helper, patched, helper_bytes):
    original = entries(archive)
    output = io.BytesIO()
    with zipfile.ZipFile(io.BytesIO(archive)) as source, zipfile.ZipFile(output, 'w') as target:
        for entry in source.infolist():
            target.writestr(entry, patched if entry.filename == handler else source.read(entry))
        target.writestr(helper, helper_bytes, compress_type=zipfile.ZIP_DEFLATED)
    updated = entries(output.getvalue())
    need(set(updated) == set(original) | {helper}, 'candidate-file-set')
    need(all(updated[p] == v for p,v in original.items() if p != handler), 'unrelated-source-changed')
    need(updated[handler] == patched and updated[helper] == helper_bytes, 'candidate-content')
    return output.getvalue()

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    need(not args.output.exists(), 'output-already-exists')
    reference = json.loads((ROOT/'release-inputs.json').read_text())
    helper = ROOT/'participant-names.js'
    if not helper.is_file():
        helper = ROOT.parent/'modules/main-app/participant-names.js'
    helper_bytes = helper.read_bytes()
    need(digest(helper_bytes) == reference['helperSha256'], 'helper-hash')
    need(digest((ROOT/'prepare-family.cjs').read_bytes()) == reference['patcherSha256'], 'patcher-hash')
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='bxh-name-stage-', dir=args.output.parent) as temp:
        stage = Path(temp)
        os.chmod(stage, 0o700)
        receipt = {'status':'NAME_MODE_BACKEND_STAGED', 'project':PROJECT, 'region':REGION,
                   'productionWrites':0, 'writers':{}}
        cache = {}
        for name in NAMES:
            before, pointer = describe(name)
            if pointer not in cache:
                raw = stage/'download.zip'
                command('gcloud', 'storage', 'cp', f'gs://{pointer[0]}/{pointer[1]}#{pointer[2]}', str(raw), '--project='+PROJECT, '--quiet')
                cache[pointer] = raw.read_bytes()
                raw.unlink()
            archive = cache[pointer]
            handler, helper_path, files = validate_source(name, archive, reference)
            folder = stage/name
            folder.mkdir(mode=0o700)
            source = folder/'handler.js'
            source.write_bytes(files[handler])
            patched = command('node', str(ROOT/'prepare-family.cjs'), str(source), digest(files[handler]))
            source.write_bytes(patched)
            command('node', '--check', str(source))
            source.unlink()
            built = candidate(archive, handler, helper_path, patched, helper_bytes)
            (folder/'original.zip').write_bytes(archive)
            (folder/'candidate.zip').write_bytes(built)
            (folder/'function.json').write_text(json.dumps(before, indent=2)+'\n')
            need(describe(name) == (before, pointer), name+': changed-during-staging')
            receipt['writers'][name] = {'revision':before['serviceConfig']['revision'],
                'sourcePointer':list(pointer), 'configurationSha256':configuration(before),
                'originalSha256':digest(archive), 'candidateSha256':digest(built),
                'handlerPath':handler, 'handlerSha256':digest(patched), 'helperPath':helper_path}
        for name in NAMES:
            now, pointer = describe(name)
            row = receipt['writers'][name]
            need(list(pointer) == row['sourcePointer'] and now['serviceConfig']['revision'] == row['revision']
                 and configuration(now) == row['configurationSha256'], name+': final-baseline-changed')
        (stage/'manifest.json').write_text(json.dumps(receipt, indent=2)+'\n')
        os.rename(stage, args.output)
    print(json.dumps({'status':receipt['status'], 'output':str(args.output),
                      'functions':len(NAMES), 'productionWrites':0}))

if __name__ == '__main__':
    try:
        main()
    except (OSError, ValueError, KeyError, subprocess.SubprocessError, zipfile.BadZipFile) as error:
        reason = str(error) if type(error) is ValueError else type(error).__name__
        print(json.dumps({'status':'NAME_MODE_STAGING_STOPPED', 'reason':reason, 'productionWrites':0}))
        raise SystemExit(1)
