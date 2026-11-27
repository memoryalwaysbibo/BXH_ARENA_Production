#!/usr/bin/env python3
"""Read-only #894 source evidence capture; no deployment or cloud writes."""
import hashlib
import json
import os
import subprocess
import tempfile
import zipfile
from pathlib import Path, PurePosixPath

FUNCTIONS = (
    'registrationRosterQueueV2', 'manageRefereeSeats', 'commitRefereeCommand',
    'manageBucketRefereeSeats', 'commitBucketRefereeCommand', 'projectBucketPublicScore',
)
SELECTED = {
    'core.cjs', 'service.cjs', 'scoring-core.cjs', 'scoring-service.cjs',
    'bucket-scoring-service.cjs', 'dispatch-core.cjs', 'bucket-legacy-fence.cjs',
    'bucket-public-projection.cjs', 'bucket-state.cjs', 'bucket-seat-service.cjs',
    'event-staff-core.cjs', 'bindings.cjs', 'lifecycle.cjs', 'ticket-room-create.cjs',
    'index.js', 'index.cjs',
}


def digest(data):
    return hashlib.sha256(data).hexdigest()


def wanted(name):
    path = PurePosixPath(name)
    if path.is_absolute() or '..' in path.parts:
        raise ValueError('invalid archive path')
    return (path.name in SELECTED or
            ('engine' in path.parts and path.name in {
                'court-retirement.cjs', 'double-elimination.cjs', 'fault.cjs',
                'index.cjs', 'manifest.json', 'match-utils.cjs', 'pass-return.cjs',
            }))


def copy_review(name, record, archive, output):
    with zipfile.ZipFile(archive) as source:
        entries = source.namelist()
        if len(entries) != len(set(entries)):
            raise ValueError(f'duplicate archive entries: {name}')
        count = 0
        for path, expected in record['files'].items():
            if not wanted(path):
                continue
            data = source.read(path)
            if digest(data) != expected:
                raise ValueError(f'fingerprint mismatch: {name}/{path}')
            output.writestr(name + '/' + path, data)
            count += 1
        if not count:
            raise ValueError(f'empty review: {name}')
        return count


def capture(inventory_path, output_path):
    inventory = json.loads(inventory_path.read_text())
    if set(inventory) != set(FUNCTIONS):
        raise ValueError('expected the six #894 functions')
    with tempfile.TemporaryDirectory(prefix='ptn894-review-') as tmp:
        stage = Path(tmp) / 'review.zip'
        with zipfile.ZipFile(stage, 'w', zipfile.ZIP_DEFLATED) as output:
            for name in FUNCTIONS:
                record = inventory[name]
                print('Checking:', name, flush=True)
                info = json.loads(subprocess.check_output([
                    'gcloud', 'functions', 'describe', name, '--gen2',
                    '--region=asia-east1', '--project=bxh-arena', '--format=json',
                ]))
                build = info['buildConfig']
                source = build['source']['storageSource']
                generation = str(source['generation'])
                if generation != str(record['generation']) or build.get('runtime') != record['runtime']:
                    raise ValueError(f'live version changed: {name}; refresh inventory')
                archive = Path(tmp) / 'source.zip'
                subprocess.run([
                    'gcloud', 'storage', 'cp',
                    f"gs://{source['bucket']}/{source['object']}#{generation}", str(archive),
                ], check=True)
                count = copy_review(name, record, archive, output)
                archive.unlink()
                print('Verified files:', count, flush=True)
        # Only publish a complete local review ZIP. Staging runs in /tmp.
        with tempfile.NamedTemporaryFile(dir=output_path.parent, prefix='.ptn894-review-', delete=False) as target:
            pending = Path(target.name)
            try:
                target.write(stage.read_bytes())
                target.flush()
                os.fsync(target.fileno())
                target.close()
                os.replace(pending, output_path)
            finally:
                pending.unlink(missing_ok=True)
    print('PTN894_SOURCE_REVIEW_COMPLETE', flush=True)


if __name__ == '__main__':
    capture(Path.home() / 'PTN894_inventory.json', Path.home() / 'PTN894_source_review.zip')
