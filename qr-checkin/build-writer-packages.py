"""Prepare review-only writer packages from pinned deployed sources; never deploy.

Every service keeps its own source generation. No service is rebuilt from another
service's newer/older copy of a shared module. All inputs are verified before any
output is created. The report explicitly does not certify deployment readiness.
"""
import argparse
import hashlib
import json
import os
import pathlib
import re
import tempfile

ROOT = pathlib.Path(__file__).resolve().parent
PIN = ROOT / 'reference/backend-sources-20261016.json'
PIN_HASH = '63e788cd3f56dbd325b66c7a1d5965d2022b0deb5d8f2a1d327d774aa8909c76'
ADMIN = re.compile(r"require\((['\"])firebase-admin/firestore\1\)")


def build(source, output):
    if hashlib.sha256(PIN.read_bytes()).hexdigest() != PIN_HASH:
        raise ValueError('Pinned source manifest changed')
    manifest = json.loads(PIN.read_text())
    source, output = pathlib.Path(source).resolve(), pathlib.Path(output).resolve()
    if output.exists():
        raise ValueError('Output already exists; refusing to overwrite')
    inputs = []
    for service in manifest['functions']:
        for name, expected in service['files'].items():
            relative = pathlib.PurePosixPath(service['name'], name)
            path = source / relative
            if '..' in relative.parts or not path.resolve().is_relative_to(source):
                raise ValueError('Unsafe source path')
            content = path.read_bytes()
            if len(content) != expected['bytes'] or hashlib.sha256(content).hexdigest() != expected['sha256']:
                raise ValueError('Deployed source mismatch: ' + str(relative))
            inputs.append((relative, content))
    # Create atomically only after the complete baseline passes verification.
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=output.parent, prefix='qr-writers-') as scratch:
        staged = pathlib.Path(scratch) / 'packages'
        staged.mkdir()
        changes = {f['name']: [] for f in manifest['functions']}
        for relative, content in inputs:
            dest = staged / relative
            dest.parent.mkdir(parents=True, exist_ok=True)
            if dest.suffix in ('.js', '.cjs'):
                text = content.decode('utf8')
                shim = pathlib.Path(relative.parts[0], '_qr_checkin/admin-firestore.cjs')
                link = os.path.relpath(shim, relative.parent).replace(os.sep, '/')
                if not link.startswith('.'):
                    link = './' + link
                text, count = ADMIN.subn(lambda _: 'require(' + json.dumps(link) + ')', text)
                if count:
                    changes[relative.parts[0]].append({'path': str(pathlib.PurePosixPath(*relative.parts[1:])), 'importsWrapped': count})
                content = text.encode('utf8')
            dest.write_bytes(content)
        shim_source = """'use strict';
const admin=require('firebase-admin/firestore');
const {guardFirestore}=require('./guard-firestore.cjs');
module.exports={...admin,getFirestore:(...args)=>guardFirestore(admin.getFirestore(...args))};
"""
        for service in manifest['functions']:
            dest = staged / service['name'] / '_qr_checkin'
            dest.mkdir()
            (dest / 'admin-firestore.cjs').write_text(shim_source)
            for name in ('guard-firestore.cjs', 'qr-checkin-fence.cjs'):
                (dest / name).write_bytes((ROOT / 'backend' / name).read_bytes())
        report = {
            'kind': 'REVIEW_ONLY_NOT_DEPLOYABLE', 'deploymentReady': False,
            'project': manifest['project'], 'sourceAuditRunId': manifest['auditRunId'],
            'verifiedSourceFiles': len(inputs),
            'unresolved': ['direct and batch writers require coverage review',
                           'onsite checkIn must use the shared immutable audit',
                           'each actual handler requires emulator regression coverage'],
            'services': [{'name': f['name'], 'sourceGeneration': f['sourceGeneration'],
                          'wrappedImports': changes[f['name']]} for f in manifest['functions']],
        }
        (staged / 'REVIEW.json').write_text(json.dumps(report, indent=2) + '\n')
        staged.rename(output)
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--sources', required=True)
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    report = build(args.sources, args.output)
    print(json.dumps({k: report[k] for k in ('kind', 'verifiedSourceFiles', 'deploymentReady')}))
