#!/usr/bin/env python3
"""Verify the closed deployment; --apply enables only communitySeatsEnabled.

Requires the original pinned community_referee_deploy.py beside this file.
No automatic write retry. An uncertain response requires a read-only rerun.
"""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import urllib.parse

DEPLOY_SHA = 'ee243f9b45d547945b5461b4a059509b110f84ab9e8b92981b9d45acb50ade68'


def load_operator():
    path = Path(__file__).with_name('community_referee_deploy.py')
    if hashlib.sha256(path.read_bytes()).hexdigest() != DEPLOY_SHA:
        raise RuntimeError('STOP: deployment operator checksum mismatch')
    spec = importlib.util.spec_from_file_location('community_deploy', path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def enable(cloud, document, apply, operator):
    fields = document.get('fields', {})
    for key in ('enabled', 'perCourtScoringVerified', 'partnerSeatsEnabled'):
        operator.need(fields.get(key) == {'booleanValue': True}, 'required flag unavailable: ' + key)
    value = fields.get('communitySeatsEnabled')
    operator.need(value is None or value in ({'booleanValue': False}, {'booleanValue': True}),
                  'community flag has unexpected type')
    if value == {'booleanValue': True}:
        return 'ALREADY_ENABLED'
    if not apply:
        return 'READY_TO_ENABLE'
    timestamp = document.get('updateTime')
    operator.need(bool(timestamp), 'config updateTime unavailable')
    query = urllib.parse.urlencode({'updateMask.fieldPaths': 'communitySeatsEnabled',
                                   'currentDocument.updateTime': timestamp})
    cloud.request('PATCH', operator.FLAGS + '?' + query,
                  {'fields': {'communitySeatsEnabled': {'booleanValue': True}}})
    actual = cloud.request('GET', operator.FLAGS).get('fields', {})
    expected = dict(fields, communitySeatsEnabled={'booleanValue': True})
    operator.need(actual == expected, 'post-write config differs; inspect before any retry')
    return 'COMMUNITY_ENABLED'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--journal', type=Path, required=True)
    parser.add_argument('--bundle', type=Path, default=Path.home() / 'BXH-community-referee-candidate-dbafbd9.zip')
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    operator = load_operator()
    receipt = json.loads((args.journal / 'state.json').read_text())
    operator.need(receipt.get('status') == 'DEPLOYED_WITH_COMMUNITY_CLOSED'
                  and receipt.get('candidateCommit') == operator.COMMIT
                  and receipt.get('project') == operator.PROJECT,
                  'deployment receipt does not match the closed candidate')
    ref, manifest, files, rules = operator.bundle(args.bundle)
    cloud = operator.Cloud()
    with tempfile.TemporaryDirectory(prefix='community-enable-') as temporary:
        deployment = operator.Deployment(cloud, ref, manifest, files, rules, journal=Path(temporary))
        release, source = deployment.live_rules()
        operator.need(release.get('rulesetName') == receipt.get('candidateRuleset')
                      and operator.digest(source['content'].encode()) == manifest['rulesCandidateSha256'],
                      'live Rules differ from deployed candidate')
        for old in ref['functions']:
            entry = receipt.get('functions', {}).get(old['entryPoint'], {})
            operator.need(entry.get('verified') is True, 'function deployment not verified')
            # A successful source deployment creates a new Cloud Run revision.
            # Pin that revision to the verified receipt, while retaining every
            # other captured service setting as the expected configuration.
            expected = dict(old, service=dict(old['service'], revision=entry.get('revision')))
            info = deployment.check_function(expected, entry.get('source'))
            operator.need(info.get('serviceConfig', {}).get('revision') == entry.get('revision'),
                          'function revision changed after deployment')
            deployment.verify_source(old['entryPoint'], info)
        document = cloud.request('GET', operator.FLAGS)
        result = enable(cloud, document, args.apply, operator)
        print(json.dumps({'status': result, 'project': operator.PROJECT,
                          'cloudReads': cloud.reads, 'flagWriteRequests': cloud.writes,
                          'communityEnabled': result in ('COMMUNITY_ENABLED', 'ALREADY_ENABLED')}))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        raise SystemExit('STOP: ' + str(error))
