#!/usr/bin/env python3
"""Close the one legacy PTN pilot room without awarding ladder points.

Dry run by default. The --apply path uses a two-document atomic Firestore
commit with update-time preconditions and leaves match results unchanged.
"""
import argparse
import json
import subprocess
import time
import urllib.error
import urllib.request

PROJECT = 'bxh-arena'
CODE = 'PTN-E50A3E'
ROOT = ('https://firestore.googleapis.com/v1/projects/' + PROJECT +
        '/databases/(default)/documents')
RESOURCE = 'projects/' + PROJECT + '/databases/(default)/documents'
REASON = 'legacy-ptn-pilot-no-points'


def request(token, url, payload=None):
    headers = {'Authorization': 'Bearer ' + token}
    if payload is not None:
        headers['Content-Type'] = 'application/json'
    req = urllib.request.Request(
        url, data=None if payload is None else json.dumps(payload).encode(),
        headers=headers)
    with urllib.request.urlopen(req, timeout=30) as response:
        return json.load(response)


def scalar(field):
    if field is None:
        return None
    for kind in ('stringValue', 'integerValue', 'doubleValue', 'booleanValue'):
        if kind in field:
            return field[kind]
    if 'nullValue' in field:
        return None
    raise ValueError('unexpected Firestore field type')


def get(token, collection):
    doc = request(token, ROOT + '/' + collection + '/' + CODE)
    if doc.get('name') != RESOURCE + '/' + collection + '/' + CODE or not doc.get('updateTime'):
        raise ValueError('room document identity changed')
    return doc


def ledger_exists(token):
    result = request(token, ROOT + ':runQuery', {'structuredQuery': {
        'from': [{'collectionId': 'ladderTransactions'}],
        'where': {'fieldFilter': {'field': {'fieldPath': 'eventCode'},
                                  'op': 'EQUAL', 'value': {'stringValue': CODE}}},
        'select': {'fields': [{'fieldPath': 'eventCode'}]}, 'limit': 1}})
    return any('document' in row for row in result)


def field(value):
    if value is None:
        return {'nullValue': None}
    if isinstance(value, bool):
        return {'booleanValue': value}
    if isinstance(value, int):
        return {'integerValue': str(value)}
    if isinstance(value, str):
        return {'stringValue': value}
    raise ValueError('unsupported write field')


def check_matches(state):
    matches = [m for m in state.get('matches', []) if not m.get('isBye')]
    if len(matches) != 1 or matches[0].get('completed') is not True:
        raise ValueError('legacy pilot match count/completion changed')
    champion, runner = state.get('championId'), state.get('runnerUpId')
    if not champion or not runner or champion == runner:
        raise ValueError('final placements incomplete')
    if matches[0].get('winnerId') != champion or matches[0].get('loserId') != runner:
        raise ValueError('match and placements disagree')
    return matches


def prepare(token, now):
    private = get(token, 'tournaments')
    public = get(token, 'publicTournaments')
    a, b = private['fields'], public['fields']
    if ledger_exists(token):
        raise ValueError('ladder transaction already exists; stop')
    for label, fields in [('private', a), ('public', b)]:
        if (scalar(fields.get('eventAuthority')) != 'ticket' or
                scalar(fields.get('ptnSettlementVersion')) is not None or
                scalar(fields.get('tournamentPhase')) != 'live' or
                scalar(fields.get('archiveStatus')) != 'ongoing' or
                scalar(fields.get('ladderPointsAwarded')) is True):
            raise ValueError(label + ' room is not the unclosed legacy pilot')
    state = json.loads(scalar(a['data']))
    view = json.loads(scalar(b['bracketView']))
    for label, body in [('private data', state), ('public bracketView', view)]:
        if (not isinstance(body, dict) or body.get('archiveStatus') != 'ongoing' or
                body.get('ladderPointsAwarded') is True):
            raise ValueError(label + ' state changed')
        check_matches(body)
    bucket_keys = ('scoreStorage', 'scoreBucketProjection', 'bucketMigration',
                   'deletionStatus')
    if (any(key in a or key in state for key in bucket_keys) or
            state['championId'] != view['championId'] or
            state['runnerUpId'] != view['runnerUpId'] or
            any(state.get(key) for key in ('ladderResults', 'ladderAwardedAt', 'settlementCompletedAt'))):
        raise ValueError('bucket ownership, results, or settlement evidence changed')
    private_after = dict(state)
    public_after = dict(view)
    common = {'archiveStatus': 'completed', 'completedAt': now,
              'archivedAt': now, 'settlementPhase': 'completed',
              'settlementCompletedAt': now, 'ladderPointsAwarded': False}
    private_after.update(common)
    private_after.update({'settlementRoute': 'no-ladder',
                          'officialLadderSkippedReason': REASON,
                          'settlementError': None, 'settlementErrorCode': None,
                          'updatedAt': now})
    public_after.update({k: common[k] for k in ('archiveStatus', 'completedAt',
                                                'archivedAt', 'ladderPointsAwarded')})

    def write(doc, patch):
        return {'update': {'name': doc['name'],
                           'fields': {key: field(value) for key, value in patch.items()}},
                'updateMask': {'fieldPaths': list(patch)},
                'currentDocument': {'updateTime': doc['updateTime']}}

    private_patch = {'data': json.dumps(private_after, ensure_ascii=False,
                                        separators=(',', ':')),
                     'tournamentPhase': 'done', 'archiveStatus': 'completed',
                     'completedAt': now, 'archivedAt': now,
                     'ladderPointsAwarded': False, 'updatedAt': now}
    public_patch = {'bracketView': json.dumps(public_after, ensure_ascii=False,
                                              separators=(',', ':')),
                    'tournamentPhase': 'done', 'archiveStatus': 'completed',
                    'completedAt': now, 'archivedAt': now,
                    'ladderPointsAwarded': False, 'updatedAt': now}
    return [write(private, private_patch), write(public, public_patch)]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    token = subprocess.check_output(['gcloud', 'auth', 'print-access-token'],
                                    text=True).strip()
    writes = prepare(token, int(time.time() * 1000))
    print('PTN_LEGACY_CLOSE_PREFLIGHT_OK', CODE,
          'one completed match, zero ladder transactions', flush=True)
    if not args.apply:
        print('PREPARE_ONLY: no production changes')
        return
    if ledger_exists(token):
        raise ValueError('ladder transaction appeared; stop')
    request(token, ROOT + ':commit', {'writes': writes})
    a, b = get(token, 'tournaments'), get(token, 'publicTournaments')
    if (any(scalar(doc['fields'].get('tournamentPhase')) != 'done' or
            scalar(doc['fields'].get('archiveStatus')) != 'completed'
            for doc in (a, b)) or ledger_exists(token)):
        raise ValueError('post-write state/ledger requires investigation')
    print('PTN_LEGACY_CLOSED_NO_POINTS', CODE)


if __name__ == '__main__':
    main()
