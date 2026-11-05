#!/usr/bin/env python3
"""Compose only the reviewed registration files into an exact captured source ZIP."""
import argparse
import hashlib
import io
import json
from pathlib import Path, PurePosixPath
import zipfile


def digest(data):
    return hashlib.sha256(data).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--capture', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    here = Path(__file__).resolve().parent
    fixture = json.loads((here / 'live-source-20261105.json').read_text())
    with zipfile.ZipFile(args.capture) as capture:
        original = capture.read('source.zip')
        metadata = json.loads(capture.read('function-description.json'))
    if digest(original) != fixture['sourceArchiveSha256']:
        raise SystemExit('Source archive drift: recapture/rebase before composing.')
    config_hash = digest(json.dumps(metadata['serviceConfig'], sort_keys=True, separators=(',', ':')).encode())
    if config_hash != fixture['serviceConfigSha256']:
        raise SystemExit('Service configuration drift: capture does not match reviewed baseline.')
    if metadata['buildConfig']['source']['storageSource']['generation'] != fixture['sourceGeneration']:
        raise SystemExit('Source generation mismatch.')
    if metadata.get('name') != 'projects/bxh-arena/locations/asia-east1/functions/familyRegistration':
        raise SystemExit('Wrong function identity.')
    with zipfile.ZipFile(io.BytesIO(original)) as source:
        files = {item.filename: source.read(item) for item in source.infolist() if not item.is_dir()}
        if len(files) != len([item for item in source.infolist() if not item.is_dir()]):
            raise SystemExit('Duplicate ZIP paths.')
    for name in files:
        path = PurePosixPath(name)
        if path.is_absolute() or '..' in path.parts:
            raise SystemExit('Unsafe source ZIP path.')
    for name, expected in fixture['files'].items():
        if name not in files or digest(files[name]) != expected:
            raise SystemExit('Captured source mismatch: ' + name)
    if digest(files['index.js']) != fixture['entrypointIndexSha256']:
        raise SystemExit('Entrypoint index mismatch.')
    if 'registration-admission.cjs' in files:
        raise SystemExit('Source already owns admission module; rebase required.')
    replacements = {name: (here / 'candidate' / name).read_bytes()
                    for name in ('family-registration.js', 'registration-admission.cjs')}
    candidate = {**files, **replacements}
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, 'w', zipfile.ZIP_DEFLATED) as output:
        for name, data in candidate.items():
            output.writestr(name, data)
    data = buffer.getvalue()
    with zipfile.ZipFile(io.BytesIO(data)) as check:
        for name, original_bytes in files.items():
            if name not in replacements and check.read(name) != original_bytes:
                raise SystemExit('Unexpected source mutation: ' + name)
    manifest = {
        'sourceGeneration': fixture['sourceGeneration'],
        'originalSourceArchiveSha256': digest(original),
        'candidateSourceArchiveSha256': digest(data),
        'serviceConfigSha256': config_hash,
        'changedOrAdded': {name: digest(value) for name, value in replacements.items()},
        'unchangedFileCount': len(files) - 1,
        'cloudMutations': 0,
        'deployableWithoutLivePreflight': False,
    }
    args.output.mkdir(parents=True, exist_ok=False)
    (args.output / 'candidate-source.zip').write_bytes(data)
    (args.output / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    print(json.dumps(manifest, indent=2))


if __name__ == '__main__':
    main()
