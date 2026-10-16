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
PIN_HASH = 'c5660b5980c62a7ebb53aed7a0860d0c01d0e3cc81458359d81633206fb38fb0'
ADMIN = re.compile(r"require\((['\"])firebase-admin/firestore\1\)")
ONSITE_SOURCE_HASHES = {
    'onsite-waitlist/core.js': 'ded4853ec976cdac18bfe0603c9fcca73faeb4e1ebabf3755d8f1615c15b3b82',
    'onsite-waitlist/firestore-store.js': '5dc921853c45912b77c869854384a2b3b9acc8e05d12427e1f67558b42e4b9d2',
}


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
            if service['name'] == 'manageOnsiteWaitlist' and name in ONSITE_SOURCE_HASHES and expected['sha256'] != ONSITE_SOURCE_HASHES[name]:
                raise ValueError('Onsite source changed; rebase integration before packaging')
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
                is_onsite = relative.parts[0] == 'manageOnsiteWaitlist'
                local_name = str(pathlib.PurePosixPath(*relative.parts[1:]))
                if is_onsite and local_name == 'onsite-waitlist/core.js':
                    text = (ROOT / 'backend/onsite/core.cjs').read_text()
                if is_onsite and local_name == 'onsite-waitlist/firestore-store.js':
                    text = (ROOT / 'backend/onsite/firestore-store.cjs').read_text().replace("require('./core.cjs')", "require('./core')").replace("require('../onsite-commit.cjs')", "require('../_qr_checkin/onsite-commit.cjs')")
                shim = pathlib.Path(relative.parts[0], '_qr_checkin/admin-firestore.cjs')
                link = os.path.relpath(shim, relative.parent).replace(os.sep, '/')
                if not link.startswith('.'):
                    link = './' + link
                # The onsite store handles intentional audited attendance itself.
                # A generic preservation wrapper would undo that valid mutation.
                text, count = (text, 0) if is_onsite else ADMIN.subn(lambda _: 'require(' + json.dumps(link) + ')', text)
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
            if service['name'] == 'manageOnsiteWaitlist':
                for name in ('core.cjs', 'event-staff-core.cjs'):
                    (dest / name).write_bytes((ROOT / 'backend' / name).read_bytes())
                text = (ROOT / 'backend/onsite-commit.cjs').read_text().replace("require('./onsite/core.cjs')", "require('../onsite-waitlist/core')")
                (dest / 'onsite-commit.cjs').write_text(text)
        report = {
            'kind': 'REVIEW_ONLY_NOT_DEPLOYABLE', 'deploymentReady': False,
            'project': manifest['project'], 'sourceAuditRunId': manifest['auditRunId'],
            'missingServices': manifest.get('missingServices', []),
            'verifiedSourceFiles': len(inputs),
            'unresolved': ['direct and batch writers require coverage review',
                           'onsite integration requires its additional server rollout flag and regression validation',
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
