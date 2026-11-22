#!/usr/bin/env python3
"""Post the verified historical group event result to the existing mood ticker.

Cloud Shell: python3 operator/BXH-CY69NM_system_result.py [--apply]
Uses the signed-in gcloud CLI, not application-default credentials.
"""
import hashlib
import json
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

CODE = 'BXH-CY69NM'
BASE = 'https://firestore.googleapis.com/v1/projects/bxh-arena/databases/(default)/documents'
KEY = 'tournament-result-' + CODE
DOC_ID = hashlib.sha256(KEY.encode()).hexdigest()
EVENT_NAME = '新光三越新天地-一戰成名'
PLACES = ('葉智欽', '張信忠', '蕭名宏', '邱崇維', '薛程宇', '陳冠宇', '楊靜萱', '林柏峰')
TITLES = ('冠軍', '亞軍', '季軍', '殿軍', '第五名', '第六名', '第七名', '第八名')


def require(condition, reason):
    if not condition:
        raise SystemExit('STOP: ' + reason)


def unpack(value):
    for key, cast in (('stringValue', str), ('integerValue', int), ('booleanValue', bool)):
        if key in value:
            return cast(value[key])
    if 'mapValue' in value:
        return {key: unpack(item) for key, item in value['mapValue'].get('fields', {}).items()}
    if 'arrayValue' in value:
        return [unpack(item) for item in value['arrayValue'].get('values', [])]
    return None


def pack(value):
    if isinstance(value, bool):
        return {'booleanValue': value}
    if isinstance(value, int):
        return {'integerValue': str(value)}
    if isinstance(value, str):
        return {'stringValue': value}
    if isinstance(value, list):
        return {'arrayValue': {'values': [pack(item) for item in value]}}
    if isinstance(value, dict):
        return {'mapValue': {'fields': {key: pack(item) for key, item in value.items()}}}
    raise TypeError(type(value))


def read_json(value, label):
    if isinstance(value, dict):
        return value
    require(isinstance(value, str), label + ' missing')
    try:
        result = json.loads(value)
    except ValueError as exc:
        raise SystemExit('STOP: ' + label + ' invalid JSON') from exc
    require(isinstance(result, dict), label + ' invalid object')
    return result


def request(token, path, data=None, method='GET'):
    payload = None if data is None else json.dumps(data, ensure_ascii=False).encode('utf-8')
    req = urllib.request.Request(BASE + path, data=payload, method=method, headers={
        'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=30) as response:
            return {key: unpack(value) for key, value in json.load(response).get('fields', {}).items()}
    except urllib.error.HTTPError as exc:
        if exc.code == 404:
            return None
        if exc.code == 409:
            return {'alreadyExists': True}
        raise


def preview(room, public, plan, existing):
    require(room and public and plan, 'missing private room, public room, or group plan')
    require(existing is None, 'system result already exists, including hidden posts')
    state = read_json(room.get('data'), 'room data')
    event = plan.get('event')
    require(plan.get('historical') is True and plan.get('rehearsal') is not True and
            isinstance(event, dict), 'not a completed historical group event')
    require(state.get('id') == plan.get('parentRoomId') and state.get('cloudCode') == CODE and
            state.get('historicalImportDigest') == plan.get('importDigest'), 'import changed')
    require(room.get('eventAuthority') == 'official' and room.get('ladderMode') == 'ranked' and
            not room.get('testMode') and not room.get('systemClosed') and
            not state.get('testMode') and not state.get('meta', {}).get('eventCancelled'),
            'not an eligible official event')
    require(room.get('archiveStatus') == state.get('archiveStatus') ==
            public.get('archiveStatus') == 'completed' and
            state.get('settlementPhase') == 'completed' and
            room.get('ladderPointsAwarded') is True and state.get('ladderPointsAwarded') is True,
            'archive or ladder settlement incomplete')
    require(state.get('meta', {}).get('name') == EVENT_NAME and
            isinstance(state.get('completedAt'), int) and state['completedAt'] > 0,
            'event name or completion time differs')
    groups = event.get('groups', {})
    results = event.get('results', {})
    keys = ('A', 'B', 'C', 'D')
    require(set(groups) == set(keys) and set(results) == set(keys + ('final-eight',)),
            'unexpected group stages')
    roster = [player for key in keys for player in groups[key]]
    by_id = {player['id']: player['name'] for player in roster}
    require(len(roster) == len(by_id) == len(state.get('players', [])) == 285 and
            all(state['players'][index].get('id') == player['id'] and
                state['players'][index].get('name') == player['name']
                for index, player in enumerate(roster)), '285-person roster differs')
    for key in keys:
        require(len(results[key].get('matches', [])) == len(groups[key]) - 2 and
                len(results[key].get('places', [])) == 2, 'group ' + key + ' incomplete')
    final = results['final-eight']
    ids = final.get('places', [])
    require(len(ids) == len(set(ids)) == 8 and
            tuple(by_id.get(player_id) for player_id in ids) == PLACES and
            set(ids) == {player_id for key in keys for player_id in results[key]['places']},
            'final-eight names or qualifiers differ')
    require(len(final.get('matches', [])) == 7 and
            sum(len(result['matches']) for result in results.values()) == 284 and
            all(match.get('completed') is True and
                match.get('winnerId') in (match.get('a', {}).get('playerId'), match.get('b', {}).get('playerId')) and
                match.get('loserId') in (match.get('a', {}).get('playerId'), match.get('b', {}).get('playerId')) and
                match['winnerId'] != match['loserId']
                for result in results.values() for match in result['matches']),
            '284 match results incomplete')
    settlement = plan.get('settlement', {})
    require(settlement.get('effectiveCount') == 285 and
            settlement.get('creditedCount') == 233 and
            len(state.get('ladderResults', [])) == 233 and
            settlement.get('seasonId') == room.get('ladderSeasonId'), 'settlement differs')
    message = ('🏆 恭喜' + '、'.join('【' + title + '】' + name for title, name in zip(TITLES, PLACES)) +
               '，於「' + EVENT_NAME + '」榮獲佳績！🎉')
    return message


def main():
    require(sys.argv[1:] in ([], ['--apply']), 'only --apply is accepted')
    token = subprocess.check_output(['gcloud', 'auth', 'print-access-token'], text=True).strip()
    room = request(token, '/tournaments/' + CODE)
    public = request(token, '/publicTournaments/' + CODE)
    plan = request(token, '/groupStagePlans/' + CODE)
    existing = request(token, '/moodStationMessages/' + DOC_ID)
    message = preview(room, public, plan, existing)
    print(json.dumps({'room': CODE, 'entrants': 285, 'matches': 284, 'credited': 233,
        'message': message, 'alreadyPosted': False, 'applyRequested': sys.argv[1:] == ['--apply']},
        ensure_ascii=False))
    if sys.argv[1:] == ['--apply']:
        now = int(time.time() * 1000)
        doc = {'ownerUid': 'system:tournament-result:' + DOC_ID, 'name': 'BXH 系統',
            'text': message, 'status': 'visible', 'createdAt': now, 'expiresAt': now + 86400000,
            'operationId': KEY, 'heartUids': {}, 'heartCount': 0, 'replies': [],
            'replyCount': 0, 'sourceType': 'tournament-result'}
        result = request(token, '/moodStationMessages?documentId=' + urllib.parse.quote(DOC_ID),
            {'fields': {key: pack(value) for key, value in doc.items()}}, 'POST')
        require(result and not result.get('alreadyExists') and result.get('name') == 'BXH 系統' and
                result.get('text') == message, 'duplicate or failed creation')
        print(json.dumps({'published': True, 'messageId': DOC_ID, 'expiresAt': now + 86400000},
            ensure_ascii=False))


if __name__ == '__main__':
    main()
