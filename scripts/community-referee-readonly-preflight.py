#!/usr/bin/env python3
"""Capture current BXH referee sources and Rules from an authenticated Cloud Shell.

Read-only: no deployment, IAM change, Firestore write or runtime flag change.
Credentials stay in memory; only the two requested source archives are downloaded.
"""
import argparse
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import urllib.error
import urllib.request

PROJECT = 'bxh-arena'
FUNCTIONS = ('manageRefereeSeats', 'commitRefereeCommand')
REVIEWED_RULES_HASH = 'cc92f06579800bd9dcbd7fca3af36fcbd4a80989f795164ec847b0211fe694a9'


def command(args):
    result = subprocess.run(args, check=False, capture_output=True, text=True, timeout=180)
    if result.returncode:
        # Do not copy CLI diagnostics or credentials into the capture.
        raise RuntimeError('gcloud read failed: ' + ' '.join(args[:3]))
    return result.stdout


def api(path, token):
    request = urllib.request.Request(path, headers={'Authorization': 'Bearer ' + token})
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        raise RuntimeError('Read API returned HTTP ' + str(error.code)) from None


def save_json(path, data):
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n')
    path.chmod(0o600)


def capture(destination):
    token = command(['gcloud', 'auth', 'print-access-token', '--quiet']).strip()
    if not token:
        raise RuntimeError('No configured gcloud identity')
    release = api('https://firebaserules.googleapis.com/v1/projects/' + PROJECT + '/releases/cloud.firestore', token)
    ruleset_name = release.get('rulesetName', '')
    if not ruleset_name.startswith('projects/' + PROJECT + '/rulesets/'):
        raise RuntimeError('Unexpected Rules project')
    ruleset = api('https://firebaserules.googleapis.com/v1/' + ruleset_name, token)
    source_files = ruleset.get('source', {}).get('files', [])
    if len(source_files) != 1 or not isinstance(source_files[0].get('content'), str):
        raise RuntimeError('Expected a single Firestore Rules source; manual reconciliation required')
    rules = source_files[0]['content'].encode('utf-8')
    (destination / 'firestore.live.rules').write_bytes(rules)
    (destination / 'firestore.live.rules').chmod(0o600)
    digest = hashlib.sha256(rules).hexdigest()
    save_json(destination / 'rules-release.json', release)
    manifest = {'project': PROJECT, 'capturedAt': dt.datetime.now(dt.timezone.utc).isoformat(),
                'readOnly': True, 'productionWrites': 0, 'rulesetName': ruleset_name,
                'rulesSha256': digest, 'matchesReviewedBaseline': digest == REVIEWED_RULES_HASH,
                'functions': [], 'errors': []}
    config_url = 'https://firestore.googleapis.com/v1/projects/' + PROJECT + '/databases/(default)/documents/systemConfig/refereeSeatsV1'
    try:
        config = api(config_url, token)
        # Only explicit rollout flags, never unrelated config or environment values.
        fields = config.get('fields', {})
        save_json(destination / 'referee-runtime-flags.json', {
            'updateTime': config.get('updateTime'),
            'flags': {key: fields.get(key) for key in
                      ('enabled', 'perCourtScoringVerified', 'communitySeatsEnabled', 'partnerSeatsEnabled')}})
    except RuntimeError as error:
        manifest['errors'].append({'read': 'referee-runtime-flags', 'error': str(error)})
    for name in FUNCTIONS:
        try:
            info = json.loads(command(['gcloud', 'functions', 'describe', name, '--gen2', '--region=asia-east1',
                                       '--project=' + PROJECT, '--format=json', '--quiet']))
            build, service = info.get('buildConfig', {}), info.get('serviceConfig', {})
            source = build.get('source', {}).get('storageSource', {})
            bucket, obj, generation = source.get('bucket'), source.get('object'), source.get('generation')
            if not bucket or not obj or not str(generation).isdigit():
                raise RuntimeError('No immutable storage source generation for ' + name)
            if '/' in bucket or '#' in obj:
                raise RuntimeError('Unexpected storage source path')
            archive = destination / (name + '.source.zip')
            command(['gcloud', 'storage', 'cp', 'gs://' + bucket + '/' + obj + '#' + str(generation), str(archive), '--quiet'])
            archive.chmod(0o600)
            metadata = {'name': info.get('name'), 'state': info.get('state'), 'updateTime': info.get('updateTime'),
                        'runtime': build.get('runtime'), 'entryPoint': build.get('entryPoint'), 'storageSource': source,
                        'service': {key: service.get(key) for key in ('service', 'revision', 'uri', 'timeoutSeconds', 'availableMemory', 'availableCpu', 'serviceAccountEmail', 'ingressSettings', 'maxInstanceCount', 'minInstanceCount')},
                        'environmentVariableNames': sorted(service.get('environmentVariables', {})),
                        'archiveSha256': hashlib.sha256(archive.read_bytes()).hexdigest()}
            save_json(destination / (name + '.metadata.json'), metadata)
            manifest['functions'].append(metadata)
        except (RuntimeError, subprocess.TimeoutExpired, json.JSONDecodeError) as error:
            manifest['errors'].append({'read': name, 'error': type(error).__name__ + ': ' + str(error)})
    save_json(destination / 'manifest.json', manifest)
    return manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.parse_args()
    os.umask(0o077)
    destination = Path(tempfile.mkdtemp(prefix='bxh-community-readonly-', dir=Path.home()))
    try:
        manifest = capture(destination)
    except (RuntimeError, subprocess.TimeoutExpired, OSError, json.JSONDecodeError) as error:
        save_json(destination / 'capture-error.json', {'readOnly': True, 'error': type(error).__name__ + ': ' + str(error)})
        raise SystemExit('Capture stopped; no production changes. Diagnostic directory: ' + str(destination)) from None
    archive = shutil.make_archive(str(destination), 'zip', destination)
    print(json.dumps({'readOnly': True, 'productionWrites': 0, 'bundle': archive,
                      'rulesMatchReviewedBaseline': manifest['matchesReviewedBaseline'],
                      'sourcesCaptured': len(manifest['functions']), 'errors': manifest['errors']}, ensure_ascii=False, indent=2))
    if manifest['errors']:
        raise SystemExit(1)


if __name__ == '__main__':
    main()
