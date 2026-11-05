"""Real Emulator REST permission checks for the captured live Rules + bucket guards.

Starts a private demo-project emulator. No cloud credential or SDK dependency.
"""
import base64
import json
import os
from pathlib import Path
import subprocess
import tempfile
import time
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parent
PROJECT = 'demo-bxh-bucket-delete'
PORT = 18189
BASE = f'http://127.0.0.1:{PORT}'
DOCS = f'projects/{PROJECT}/databases/(default)/documents'
OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def token(uid):
    def encode(value):
        return base64.urlsafe_b64encode(json.dumps(value).encode()).decode().rstrip('=')
    return encode({'alg': 'none', 'typ': 'JWT'}) + '.' + encode({
        'aud': PROJECT, 'iss': 'https://securetoken.google.com/' + PROJECT,
        'sub': uid, 'user_id': uid, 'iat': int(time.time()), 'exp': int(time.time()) + 3600,
        'auth_time': int(time.time()), 'firebase': {'sign_in_provider': 'custom', 'identities': {}}}) + '.'


def api(method, path, payload=None, uid='OWNER'):
    assert path.startswith('/')
    headers = {'Content-Type': 'application/json'}
    if uid:
        headers['Authorization'] = 'Bearer ' + ('owner' if uid == 'OWNER' else token(uid))
    request = urllib.request.Request(BASE + path, data=None if payload is None else json.dumps(payload).encode(),
                                     headers=headers, method=method)
    try:
        with OPENER.open(request, timeout=20) as response:
            return response.status, response.read().decode()
    except urllib.error.HTTPError as error:
        return error.code, error.read().decode()


def value(item):
    if isinstance(item, bool):
        return {'booleanValue': item}
    if isinstance(item, int):
        return {'integerValue': str(item)}
    if isinstance(item, str):
        return {'stringValue': item}
    if item is None:
        return {'nullValue': None}
    if isinstance(item, list):
        return {'arrayValue': {'values': [value(x) for x in item]}}
    return {'mapValue': {'fields': {k: value(v) for k, v in item.items()}}}


def update(path, data, partial=False):
    result = {'update': {'name': DOCS + '/' + path, 'fields': {k: value(v) for k, v in data.items()}}}
    if partial:
        result['updateMask'] = {'fieldPaths': list(data)}
    return result


def commit(writes, uid='OWNER'):
    return api('POST', '/v1/' + DOCS + ':commit', {'writes': writes}, uid)


CHECKS = 0
def check(name, response, allowed):
    global CHECKS
    CHECKS += 1
    status, body = response
    assert (200 <= status < 300) if allowed else status == 403, (name, status, body[:1000])


def fixture():
    profiles = {'host': {'active': True, 'role': 'staff'}, 'admin': {'active': True, 'role': 'super_admin'},
                'staff': {'active': True, 'role': 'staff'}, 'player': {'active': True, 'role': 'player'},
                'disabled': {'active': False, 'role': 'staff'},
                'tester': {'active': True, 'role': 'staff', 'isTestAccount': True}}
    room = {'eventAuthority': 'official', 'createdBy': 'host', 'ownerUid': 'host', 'createdByRole': 'staff',
            'assignedStaffUids': ['host', 'staff'], 'visibility': 'public', 'ladderMode': 'general',
            'tournamentPhase': 'waiting', 'archiveStatus': 'ongoing', 'registrationEnabled': False,
            'registrationStatus': 'closed', 'confirmedCount': 0, 'waitlistCount': 0, 'updatedAt': 1,
            'data': '{}', 'refereeSeatsV1': {'version': 1, 'revision': 1, 'courts': {}, 'requests': {}}}
    writes = [update('users/' + uid, profile) for uid, profile in profiles.items()]
    writes += [update('tournaments/BXH-PLAIN', room),
               update('publicTournaments/BXH-PLAIN', {k: v for k, v in room.items() if k not in ('data', 'refereeSeatsV1') } | {'bracketView': '{}'})]
    check('seed', commit(writes), True)
    return room


def plain_checks(label):
    fixture()
    for uid in ('host', 'admin'):
        check(label + ' manager ' + uid, commit([
            update('tournaments/BXH-PLAIN', {'data': '{"marker":"' + uid + '"}', 'updatedAt': 2}, True),
            update('publicTournaments/BXH-PLAIN', {'bracketView': '{"marker":"' + uid + '"}', 'updatedAt': 2}, True)], uid), True)
    for uid in ('staff', 'player'):
        check(label + ' direct score denied ' + uid, commit([
            update('tournaments/BXH-PLAIN', {'data': '{"score":1}', 'updatedAt': 3}, True)], uid), False)
    check(label + ' seats immutable', commit([update('tournaments/BXH-PLAIN', {'refereeSeatsV1': {'version': 1, 'revision': 999}}, True)], 'admin'), False)
    community = {'eventAuthority': 'community', 'ownerUid': 'player', 'createdBy': 'player', 'bracketView': '{}',
                 'visibility': 'public', 'qrCheckinManaged': False}
    check('orphan seed', commit([update('publicTournaments/BXH-ORPHAN', community)]), True)
    check(label + ' orphan community mirror delete', commit([{'delete': DOCS + '/publicTournaments/BXH-ORPHAN'}], 'player'), True)


def bucket_checks():
    room = fixture()
    manifest = {'schema': 'bxh-match-buckets-v1', 'status': 'active', 'code': 'BXH-BUCKET',
                'epoch': 'acceptance-epoch', 'roomId': 'acceptance-room'}
    bucket = manifest | {'bucketId': 'court-1', 'revision': 0, 'matches': '[]'}
    check('bucket seed', commit([update('tournaments/BXH-BUCKET', room | {'scoreStorage': manifest}),
        update('publicTournaments/BXH-BUCKET', {'visibility': 'public', 'bracketView': '{}'}),
        update('tournaments/BXH-BUCKET/matchBuckets/court-1', bucket),
        update('systemConfig/fourCourtScoreBuckets', {'privateReadsEnabled': True})]), True)
    path = '/v1/' + DOCS + '/tournaments/BXH-BUCKET/matchBuckets/court-1'
    for uid in ('host', 'admin', 'staff'):
        check('official staff get ' + uid, api('GET', path, uid=uid), True)
    for uid in ('player', 'disabled', 'tester', None):
        check('unauthorized get ' + str(uid), api('GET', path, uid=uid), False)
    check('no list', api('GET', '/v1/' + DOCS + '/tournaments/BXH-BUCKET/matchBuckets', uid='admin'), False)
    for path, data in [('tournaments/BXH-BUCKET', {'data': '{"score":1}'}),
                       ('tournaments/BXH-BUCKET', {'scoreStorage': None}),
                       ('publicTournaments/BXH-BUCKET', {'bracketView': '{"score":1}'}),
                       ('tournaments/BXH-BUCKET/matchBuckets/court-1', {'matches': '[1]'})]:
        check('legacy write ' + path, commit([update(path, data, True)], 'admin'), False)
    for kind in ('bucketScoreOperations', 'bucketScoreAudit', 'bucketSeatOperations', 'bucketSeatAudit',
                 'bucketMigrationBackups', 'bucketMigrationOperations', 'bucketMigrationEpochs'):
        p = 'tournaments/BXH-BUCKET/' + kind + '/private'
        check('private seed', commit([update(p, {'fixture': True})]), True)
        check('private get ' + kind, api('GET', '/v1/' + DOCS + '/' + p, uid='admin'), False)
        check('private write ' + kind, commit([update(p, {'fixture': False})], 'admin'), False)
    for path in ('tournaments/BXH-BUCKET', 'publicTournaments/BXH-BUCKET'):
        check('bucket delete ' + path, commit([{'delete': DOCS + '/' + path}], 'admin'), False)
    check('marker introduction', commit([update('tournaments/BXH-PLAIN', {'scoreStorage': manifest}, True)], 'admin'), False)
    check('migration metadata', commit([update('tournaments/BXH-PLAIN', {'bucketMigration': {'version': 1}}, True)], 'admin'), False)
    check('read flag off', commit([update('systemConfig/fourCourtScoreBuckets', {'privateReadsEnabled': False})]), True)
    check('closed read denied', api('GET', '/v1/' + DOCS + '/tournaments/BXH-BUCKET/matchBuckets/court-1', uid='admin'), False)


def lease_checks(candidate):
    base = fixture()
    for marker in (None, {}, {'status': 'deleting'}, {'status': 'active', 'version': 1}):
        room = base | {'bucketMigration': marker}
        public = {'eventAuthority':'official','visibility':'public','bracketView':'{}','bucketMigration':marker}
        for path in ('tournaments/BXH-LEASE', 'publicTournaments/BXH-LEASE'):
            check('seed lease delete', commit([update('tournaments/BXH-LEASE',room),update('publicTournaments/BXH-LEASE',public)]), True)
            check('lease delete ' + path, commit([{'delete':DOCS+'/'+path}], 'admin'), not candidate)
        for path, patch in [('tournaments/BXH-LEASE', {'data':'{}','updatedAt':7}),('publicTournaments/BXH-LEASE',{'bracketView':'{}','updatedAt':7})]:
            check('seed lease update',commit([update('tournaments/BXH-LEASE',room),update('publicTournaments/BXH-LEASE',public)]),True)
            check('lease update '+path,commit([update(path,patch,True)],'admin'),not candidate)
    if candidate:
        # Public mirror update cannot accompany a client-introduced private
        # migration marker, even though its optimized guard reads current root.
        check('same-batch lease introduction denied',commit([
            update('tournaments/BXH-PLAIN',{'bucketMigration':{'status':'deleting'}},True),
            update('publicTournaments/BXH-PLAIN',{'bracketView':'{}','updatedAt':9},True)],'admin'),False)
        # A retained public lease must remain protected even if an old failure removed the parent.
        check('orphan lease seed',commit([{'delete':DOCS+'/tournaments/BXH-LEASE'},update('publicTournaments/BXH-LEASE',{'eventAuthority':'community','ownerUid':'player','createdBy':'player','bracketView':'{}','bucketMigration':{'status':'deleting'}})]),True)
        check('orphan lease delete denied',commit([{'delete':DOCS+'/publicTournaments/BXH-LEASE'}],'player'),False)
        # A client cannot create a public mirror while a retained private deletion lease exists.
        check('lease mirror recreation seed',commit([update('tournaments/BXH-LEASE',room),{'delete':DOCS+'/publicTournaments/BXH-LEASE'}]),True)
        check('lease mirror recreation denied',commit([update('publicTournaments/BXH-LEASE',{'eventAuthority':'official','visibility':'public','bracketView':'{}'})],'admin'),False)


def contention_check():
    # Real Firestore write preconditions model the root read serialized by SDK transactions.
    room=fixture()
    check('contention seed',commit([update('tournaments/BXH-RACE',room)]),True)
    status,body=api('GET','/v1/'+DOCS+'/tournaments/BXH-RACE')
    assert status==200
    version=json.loads(body)['updateTime']
    migration=update('tournaments/BXH-RACE',{'scoreStorage':{'status':'active'}},True)
    migration['currentDocument']={'updateTime':version}
    check('migration wins root commit',commit([migration]),True)
    deletion=update('tournaments/BXH-RACE',{'bucketMigration':{'status':'deleting'}},True)
    deletion['currentDocument']={'updateTime':version}
    status,_=commit([deletion])
    assert status in (400,409,412),(status,'stale lease write unexpectedly accepted')


def main():
    import socket
    jar=Path(os.environ['FIRESTORE_EMULATOR_JAR'])
    assert jar.is_file()
    with socket.socket() as sock:
        sock.bind(('127.0.0.1',PORT))
    with tempfile.TemporaryFile() as log:
        process=subprocess.Popen(['java','-Xmx512m','-jar',str(jar),'--host','127.0.0.1','--port',str(PORT),'--project_id',PROJECT],stdout=log,stderr=log)
        try:
            for attempt in range(450):
                if process.poll() is not None:raise RuntimeError('Private demo emulator failed to start')
                try:api('GET','/');break
                except urllib.error.URLError:time.sleep(.1)
            else:raise RuntimeError('Private emulator startup deadline exceeded')
            baseline=Path(os.environ.get('BASELINE_RULES_PATH',str(ROOT/'fixtures/baseline.rules')))
            candidate=Path(os.environ.get('CANDIDATE_RULES_PATH',str(ROOT.parents[2]/'release/buckets/firestore.rules')))
            for label,path in [('baseline',baseline),('candidate',candidate)]:
                compiled=api('PUT',f'/emulator/v1/projects/{PROJECT}:securityRules',{'rules':{'files':[{'name':'firestore.rules','content':path.read_text()}]}})
                check(label+' compilation',compiled,True)
                assert not [i for i in json.loads(compiled[1]).get('issues',[]) if i.get('severity')=='ERROR']
                plain_checks(label);bucket_checks();lease_checks(label=='candidate')
                if label=='candidate':contention_check()
                print('PASS '+label+' emulator checks',flush=True)
        finally:
            process.terminate();process.wait(timeout=15)
    print(json.dumps({'checks':CHECKS,'productionWrites':0,'emulatorProject':PROJECT,'rulesDeploymentPerformed':False}))


if __name__=='__main__':main()
