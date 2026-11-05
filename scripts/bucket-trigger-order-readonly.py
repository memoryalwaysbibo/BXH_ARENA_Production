#!/usr/bin/env python3
"""One authenticated GET to diagnose the BXH activity trigger digest difference."""
import argparse
import datetime as dt
import hashlib
import itertools
import json
import subprocess
import urllib.request

PROJECT = 'bxh-arena'
NAME = 'projects/bxh-arena/locations/asia-east1/functions/trackTournamentRegistrationActivity'
OLD = '2eb93766c1791a2c06647df3053324b378955a3d42029ba2ec8ae3be3ede24fb'
FOLLOWUP = 'ac1f10a47f42759b4009a9fe237858b509816facf4971044d6aafbc62f56d2a7'
BUILD = '25fcb86159e71219690719c7b4045502bd03abf26bd0fddefb4db91fb9e2401d'
SERVICE = 'cacf4c3643c3ceb383f583572fc3b24a211a142eb0ae16e3ea10da830c82859e'


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def compare_orders(trigger, expected=(OLD, FOLLOWUP)):
    filters = trigger.get('eventFilters') if isinstance(trigger, dict) else None
    if not isinstance(filters, list) or not 1 <= len(filters) <= 8 or not all(isinstance(x, dict) for x in filters):
        raise ValueError('Unexpected trigger filter shape')
    if len(json.dumps(trigger).encode()) > 8192:
        raise ValueError('Trigger exceeds comparison size budget')
    found = set()
    for order in itertools.permutations(filters):
        found.add(digest({**trigger, 'eventFilters': list(order)}))
    return {value: value in found for value in expected}


def cli(args):
    result = subprocess.run(args, capture_output=True, text=True, timeout=120, check=False)
    if result.returncode:
        raise RuntimeError('Read-only gcloud command failed')
    return result.stdout.strip()


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        raise RuntimeError('API redirect refused')


def main():
    argparse.ArgumentParser(description=__doc__).parse_args()
    result = {'stage': 'BUCKET_TRIGGER_ORDER_READONLY', 'function': NAME,
              'productionWrites': 0, 'deploymentPerformed': False, 'acceptanceCompleted': False}
    try:
        if cli(['gcloud', 'config', 'get-value', 'project', '--quiet']) != PROJECT:
            raise RuntimeError('Wrong active project')
        token = cli(['gcloud', 'auth', 'print-access-token', '--quiet'])
        if not token:
            raise RuntimeError('No gcloud identity')
        request = urllib.request.Request('https://cloudfunctions.googleapis.com/v2/' + NAME,
                                         headers={'Authorization': 'Bearer ' + token}, method='GET')
        with urllib.request.build_opener(NoRedirect()).open(request, timeout=60) as response:
            raw = response.read(1024 * 1024 + 1)
        if len(raw) > 1024 * 1024:
            raise ValueError('Response exceeds size budget')
        info = json.loads(raw)
        if info.get('name') != NAME or info.get('state') != 'ACTIVE':
            raise ValueError('Function identity or state differs')
        trigger = info.get('eventTrigger')
        matches = compare_orders(trigger, (OLD, FOLLOWUP))
        config_matches = (digest(info.get('buildConfig', {})) == BUILD
                          and digest(info.get('serviceConfig', {})) == SERVICE)
        result.update({'observedAt': dt.datetime.now(dt.timezone.utc).isoformat(),
                       'updateTime': info.get('updateTime'), 'rawTriggerSha256': digest(trigger),
                       'filterCount': len(trigger['eventFilters']),
                       'buildAndServiceMatchFollowup': config_matches,
                       'oldHashMatchesFilterPermutation': matches[OLD],
                       'followupHashMatchesFilterPermutation': matches[FOLLOWUP],
                       'status': 'FILTER_ORDER_ONLY' if config_matches and all(matches.values()) else 'UNRESOLVED_DRIFT'})
    except Exception as error:
        # Never print tokens, raw API/configuration payloads or server messages.
        result.update({'status': 'READ_INCOMPLETE', 'errorType': type(error).__name__})
    print(json.dumps(result))
    if result['status'] != 'FILTER_ORDER_ONLY':
        raise SystemExit(1)


if __name__ == '__main__':
    main()
