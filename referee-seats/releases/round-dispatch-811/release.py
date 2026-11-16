#!/usr/bin/env python3
"""Pinned live-source overlay for BXH PR #811; default is staging only."""
import argparse
import base64
import gzip
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import stat
import subprocess
import tempfile
import zipfile

PROJECT = 'bxh-arena'
REGION = 'asia-east1'
FUNCTION = 'commitRefereeCommand'
EXPECTED_REVISION = 'commitrefereecommand-00007-bib'
EXPECTED_GENERATION = '1794716878951598'
EXPECTED_BUCKET = 'gcf-v2-sources-87261141693-asia-east1'
EXPECTED_OBJECT = 'commitRefereeCommand/function-source.zip'
OVERLAY_DATA = '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'
VERIFY_DATA = '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'


def unpack(value):
    return gzip.decompress(base64.b64decode(value)).decode('utf-8')


def sha(data):
    return hashlib.sha256(data).hexdigest()


def run(args, capture=False):
    return subprocess.run(args, check=True, text=True, capture_output=capture)


def describe():
    return json.loads(run(['gcloud', 'functions', 'describe', FUNCTION, '--gen2',
                          '--region=' + REGION, '--project=' + PROJECT, '--format=json'], True).stdout)


def source_info(info):
    return info['buildConfig']['source']['storageSource']


def extract(archive, destination):
    with zipfile.ZipFile(archive) as z:
        entries = z.infolist()
        if not entries or len(entries) > 10000 or sum(i.file_size for i in entries) > 100 * 1024 * 1024:
            raise RuntimeError('Unexpected source archive size; stopped')
        seen = set()
        for item in entries:
            p = PurePosixPath(item.filename)
            if p.is_absolute() or '..' in p.parts or '\\' in item.filename or item.filename in seen:
                raise RuntimeError('Unsafe source path; stopped')
            seen.add(item.filename)
            mode = item.external_attr >> 16
            if stat.S_ISLNK(mode):
                raise RuntimeError('Symlinks are not allowed in the source snapshot')
        z.extractall(destination)
    roots = [p.parent for p in destination.rglob('scoring-core.cjs')
             if (p.parent / 'engine/index.cjs').is_file() and (p.parent / 'index.js').is_file()
             and 'node_modules' not in p.parts]
    if len(roots) != 1:
        raise RuntimeError('Expected exactly one function source root')
    return roots[0]


def patch_source(root, overlay):
    engine_file = root / 'engine/index.cjs'
    source = engine_file.read_text()
    if sha(engine_file.read_bytes()) != overlay['baseEngineSha256']:
        raise RuntimeError('Live engine differs from the verified historical source; stopped')
    for change in overlay['changes']:
        if source.count(change['before']) != 1:
            raise RuntimeError('Function baseline mismatch: ' + change['name'])
        source = source.replace(change['before'], change['after'], 1)
    if source.count(overlay['exportBefore']) != 1 or 'function singleElimRoundDispatchBlocked(' in source:
        raise RuntimeError('Engine export mismatch; stopped')
    source = source.replace(overlay['exportBefore'], overlay['helpers'] + '\n ' + overlay['exportAfter'], 1)
    if sha(source.encode()) != overlay['patchedEngineSha256']:
        raise RuntimeError('Patched engine hash mismatch')
    engine_file.write_text(source)
    scoring_file = root / 'scoring-core.cjs'
    scoring = scoring_file.read_text()
    if scoring.count(overlay['scoringAnchor']) != 1 or 'previous-round-waiting' in scoring:
        raise RuntimeError('Scoring gate anchor differs; stopped before deployment')
    scoring_file.write_text(scoring.replace(overlay['scoringAnchor'],
                                           overlay['scoringAnchor'] + overlay['scoringGuard'], 1))
    return {str(p.relative_to(root)): sha(p.read_bytes()) for p in [engine_file, scoring_file]}


def file_map(root):
    return {str(p.relative_to(root)): sha(p.read_bytes()) for p in root.rglob('*') if p.is_file()}


def deploy_command(root):
    # Existing function update: no IAM, environment, timeout, scaling or trigger flags.
    return ['gcloud', 'functions', 'deploy', FUNCTION, '--gen2', '--project=' + PROJECT,
            '--region=' + REGION, '--runtime=nodejs22', '--entry-point=' + FUNCTION,
            '--source=' + str(root), '--quiet']


def verify(root, workspace):
    for name in ['engine/index.cjs', 'scoring-core.cjs', 'index.js']:
        run(['node', '--check', str(root / name)])
    verifier = workspace / 'verify-overlay.cjs'
    verifier.write_text(unpack(VERIFY_DATA))
    run(['node', str(verifier), str(root)])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--deploy', action='store_true', help='deploy after all source and behavioral checks pass')
    args = parser.parse_args()
    if not shutil.which('gcloud') or not shutil.which('node'):
        raise RuntimeError('Run this in Cloud Shell with gcloud and Node available')
    info = describe()
    src = source_info(info)
    if (info.get('state') != 'ACTIVE' or info.get('serviceConfig', {}).get('revision') != EXPECTED_REVISION
        or str(src.get('generation')) != EXPECTED_GENERATION or src.get('bucket') != EXPECTED_BUCKET
        or src.get('object') != EXPECTED_OBJECT or info.get('buildConfig', {}).get('runtime') != 'nodejs22'
        or info.get('buildConfig', {}).get('entryPoint') != FUNCTION):
        raise RuntimeError('Production revision/source/runtime changed; stopped without deploying')
    workspace = Path(tempfile.mkdtemp(prefix='BXH_811_release_', dir=Path.home()))
    os.chmod(workspace, 0o700)
    print('WORKSPACE=' + str(workspace), flush=True)
    (workspace / 'before.json').write_text(json.dumps(info, indent=2))
    original_zip = workspace / 'before.zip'
    uri = 'gs://' + src['bucket'] + '/' + src['object'] + '#' + str(src['generation'])
    run(['gcloud', 'storage', 'cp', uri, str(original_zip)])
    original = extract(original_zip, workspace / 'original')
    staged = workspace / 'staged'
    shutil.copytree(original, staged)
    overlay = json.loads(unpack(OVERLAY_DATA))
    expected = patch_source(staged, overlay)
    before, after = file_map(original), file_map(staged)
    changed = {p for p in before.keys() | after.keys() if before.get(p) != after.get(p)}
    if changed != {'engine/index.cjs', 'scoring-core.cjs'}:
        raise RuntimeError('Unexpected source changes: ' + repr(changed))
    verify(staged, workspace)
    print('STAGE_VERIFIED=true', flush=True)
    print('CHANGED_FILES=' + ','.join(sorted(changed)), flush=True)
    report = {'project': PROJECT, 'function': FUNCTION, 'beforeRevision': EXPECTED_REVISION,
              'sourceGeneration': EXPECTED_GENERATION, 'patchedHashes': expected,
              'rollbackCommand': deploy_command(original), 'deployed': False}
    report_file = workspace / 'release-report.json'
    report_file.write_text(json.dumps(report, indent=2))
    if not args.deploy:
        print('Staging only. To deploy, rerun the same pinned script with --deploy.')
        return
    latest = describe()
    if latest.get('updateTime') != info.get('updateTime') or latest.get('serviceConfig', {}).get('revision') != EXPECTED_REVISION:
        raise RuntimeError('Another deployment changed production during validation; stopped')
    print('Deploying only ' + FUNCTION + '; frontend remains unchanged.', flush=True)
    run(deploy_command(staged))
    deployed = describe()
    revision = deployed.get('serviceConfig', {}).get('revision')
    if deployed.get('state') != 'ACTIVE' or not revision or revision == EXPECTED_REVISION:
        raise RuntimeError('Deployment has not reached a new ACTIVE revision; inspect saved before.json')
    current_source = source_info(deployed)
    if (current_source['bucket'], current_source['object'], str(current_source['generation'])) == (src['bucket'], src['object'], str(src['generation'])):
        raise RuntimeError('Deployment still references the old source')
    deployed_zip = workspace / 'deployed.zip'
    uri = 'gs://' + current_source['bucket'] + '/' + current_source['object'] + '#' + str(current_source['generation'])
    run(['gcloud', 'storage', 'cp', uri, str(deployed_zip)])
    deployed_root = extract(deployed_zip, workspace / 'deployed')
    for name, expected_hash in expected.items():
        if sha((deployed_root / name).read_bytes()) != expected_hash:
            raise RuntimeError('Deployed source mismatch: ' + name)
    # Check every original source file, including the diagnostic entrypoint and services.
    for name, expected_hash in after.items():
        target = deployed_root / name
        if not target.is_file() or sha(target.read_bytes()) != expected_hash:
            raise RuntimeError('Deployed source differs from staged source: ' + name)
    verify(deployed_root, workspace)
    # Unexpected changes to runtime/security/scaling are reported without printing their values.
    protected = ['serviceAccountEmail', 'ingressSettings', 'vpcConnector', 'vpcConnectorEgressSettings',
                 'availableMemory', 'availableCpu', 'timeoutSeconds', 'maxInstanceCount', 'minInstanceCount',
                 'maxInstanceRequestConcurrency', 'environmentVariables', 'secretEnvironmentVariables',
                 'secretVolumes', 'securityLevel']
    old_cfg, new_cfg = info.get('serviceConfig', {}), deployed.get('serviceConfig', {})
    changed_settings = [key for key in protected if old_cfg.get(key) != new_cfg.get(key)]
    if changed_settings:
        raise RuntimeError('Unexpected configuration changes: ' + ','.join(changed_settings))
    service = deployed.get('serviceConfig', {}).get('service', '').rsplit('/', 1)[-1]
    if not service:
        raise RuntimeError('Missing Cloud Run service reference; cannot verify live traffic')
    serving = json.loads(run(['gcloud', 'run', 'services', 'describe', service,
                              '--region=' + REGION, '--project=' + PROJECT, '--format=json'], True).stdout)
    status = serving.get('status', {})
    traffic = status.get('traffic', [])
    actual = sum(int(t.get('percent', 0)) for t in traffic if t.get('revisionName') == revision)
    if status.get('latestReadyRevisionName') != revision or actual != 100:
        raise RuntimeError('The verified revision is not serving 100 percent of live traffic')
    report.update(deployed=True, revision=revision, deployedSource=current_source,
                  unchangedFiles=len(after) - len(changed), verified=True)
    report_file.write_text(json.dumps(report, indent=2))
    print('BACKEND_VERIFIED=true', flush=True)
    print('REVISION=' + revision, flush=True)
    print('REPORT=' + str(report_file), flush=True)
    print('Frontend not published yet. Share these final lines to continue PR #811 publication.', flush=True)


if __name__ == '__main__':
    try:
        main()
    except (RuntimeError, subprocess.CalledProcessError, KeyError, ValueError, OSError, zipfile.BadZipFile) as exc:
        raise SystemExit('STOP: ' + str(exc))
