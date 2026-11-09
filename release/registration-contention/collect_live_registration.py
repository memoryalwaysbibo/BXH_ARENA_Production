#!/usr/bin/env python3
"""Read-only Cloud Shell capture; never deploys or changes cloud resources."""
import argparse
import datetime
import hashlib
import json
from pathlib import Path
import subprocess
import tempfile
import zipfile


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--project', default='bxh-arena')
    parser.add_argument('--region', default='asia-east1')
    parser.add_argument('--function', default='familyRegistration')
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    description = subprocess.run(
        ['gcloud', 'functions', 'describe', args.function, '--gen2',
         '--project=' + args.project, '--region=' + args.region, '--format=json'],
        check=True, capture_output=True, text=True,
    )
    metadata = json.loads(description.stdout)
    expected = f'projects/{args.project}/locations/{args.region}/functions/{args.function}'
    if metadata.get('name') != expected or metadata.get('environment') != 'GEN_2':
        raise SystemExit('Unexpected function identity or generation; no source downloaded.')
    source = metadata.get('buildConfig', {}).get('source', {}).get('storageSource', {})
    bucket, obj, generation = (source.get(key) for key in ('bucket', 'object', 'generation'))
    if not all(isinstance(value, (str, int)) and str(value) for value in (bucket, obj, generation)):
        raise SystemExit('No exact source generation in describe response; capture stopped.')
    config = metadata.get('serviceConfig', {})
    stamp = datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=8))).strftime('%Y%m%d-%H%M%S')
    output = (args.output or Path(f'registration-live-readonly-{stamp}.zip')).resolve()
    if output.exists():
        raise SystemExit('Output exists; select a different --output. Nothing overwritten.')
    with tempfile.TemporaryDirectory(prefix='registration-live-readonly-') as tmp:
        source_path = Path(tmp) / 'source.zip'
        subprocess.run(['gcloud', 'storage', 'cp', f'gs://{bucket}/{obj}#{generation}',
                        str(source_path), '--project=' + args.project], check=True, capture_output=True)
        if not zipfile.is_zipfile(source_path):
            raise SystemExit('Downloaded source is not a ZIP archive; capture stopped.')
        report = {
            'name': metadata['name'], 'updateTime': metadata.get('updateTime'),
            'sourceGeneration': str(generation),
            'sourceArchiveSha256': hashlib.sha256(source_path.read_bytes()).hexdigest(),
            'serviceConfigSha256': hashlib.sha256(json.dumps(config, sort_keys=True, separators=(',', ':')).encode()).hexdigest(),
            'runtime': metadata.get('buildConfig', {}).get('runtime'),
            'serviceLimits': {key: config.get(key) for key in (
                'timeoutSeconds', 'availableMemory', 'availableCpu',
                'maxInstanceCount', 'minInstanceCount', 'maxInstanceRequestConcurrency')},
            'cloudMutations': 0,
        }
        # Keep the full config privately in this local capture, never print its
        # environment values or place live configuration in repository commits.
        with output.open('xb') as stream, zipfile.ZipFile(stream, 'w', zipfile.ZIP_DEFLATED) as archive:
            archive.write(source_path, 'source.zip')
            archive.writestr('function-description.json', description.stdout)
            archive.writestr('report.json', json.dumps(report, indent=2) + '\n')
    print(json.dumps({'archive': str(output), **report}, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
