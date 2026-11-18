#!/usr/bin/env python3
"""Read the immutable live PASS backend source and report compatibility; never deploy."""
import hashlib
import json
import subprocess
import tempfile
import zipfile
from pathlib import Path

PROJECT = 'bxh-arena'
FUNCTION = 'commitRefereeCommand'
REGION = 'asia-east1'
EXPECTED = {
    'engine/index.cjs': '3e40412b390fac6115c9e93771fd1a15961b3a053956bf013497740fa811eb0b',
    'dispatch-core.cjs': '4be700ad894bf35b95e1da39585544ad14d596df5c12d00362d0ec93a90efe3b',
    'scoring-core.cjs': 'aed04819b97a1bdfed2feb6a9a9a097363c5a3381155cf1c0445c618494bd15e',
}

def describe():
    return json.loads(subprocess.check_output([
        'gcloud', 'functions', 'describe', FUNCTION, '--gen2',
        '--project='+PROJECT, '--region='+REGION, '--format=json', '--quiet'
    ], text=True))

def main():
    before = describe()
    if before.get('name') != f'projects/{PROJECT}/locations/{REGION}/functions/{FUNCTION}' or before.get('state') != 'ACTIVE':
        raise RuntimeError('Unexpected function or non-ACTIVE state')
    source = before.get('buildConfig', {}).get('source', {}).get('storageSource', {})
    if source.get('bucket') != 'gcf-v2-sources-87261141693-asia-east1' or source.get('object') != FUNCTION+'/function-source.zip' or not str(source.get('generation', '')).isdigit():
        raise RuntimeError('Unexpected immutable source location')
    uri = 'gs://'+source['bucket']+'/'+source['object']+'#'+str(source['generation'])
    with tempfile.TemporaryDirectory(prefix='BXH817_audit_') as folder:
        archive = Path(folder)/'source.zip'
        subprocess.run(['gcloud', 'storage', 'cp', uri, str(archive), '--project='+PROJECT, '--quiet'], check=True)
        if archive.stat().st_size > 50_000_000:
            raise RuntimeError('Source archive exceeds audit limit')
        with zipfile.ZipFile(archive) as z:
            entries = z.infolist()
            if len(entries) > 2048 or sum(e.file_size for e in entries) > 200_000_000:
                raise RuntimeError('Source archive exceeds audit limit')
            names = [e.filename for e in entries]
            if len(names) != len(set(names)):
                raise RuntimeError('Duplicate archive member')
            # No archive member is extracted or executed. Only these code files are hashed.
            hashes = {p: hashlib.sha256(z.read(p)).hexdigest() if p in names else None for p in EXPECTED}
    after = describe()
    if before.get('updateTime') != after.get('updateTime') or source != after.get('buildConfig', {}).get('source', {}).get('storageSource', {}):
        raise RuntimeError('Live function changed during audit; run again')
    print(json.dumps({
        'readOnly': True, 'deployed': False,
        'revision': before.get('serviceConfig', {}).get('revision'),
        'updateTime': before.get('updateTime'),
        'sourceGeneration': str(source['generation']),
        'hashes': hashes,
        'reviewedBaselineMatches': hashes == EXPECTED,
    }, ensure_ascii=False, indent=2))

if __name__ == '__main__':
    try:
        main()
    except (RuntimeError, subprocess.CalledProcessError, OSError, ValueError, zipfile.BadZipFile) as error:
        raise SystemExit('STOP: '+str(error)) from None
