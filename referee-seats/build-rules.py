"""Compose seat and bucket ownership guards with an explicitly supplied rules baseline.
Never deploy this file without first reconciling the live rules baseline.
"""
import argparse,pathlib
p=argparse.ArgumentParser();p.add_argument('--source',required=True);p.add_argument('--output',required=True);a=p.parse_args()
s=pathlib.Path(a.source).read_text()
assert 'function refereeSeatWriteValid(' not in s,'seat guard already present'
helper='''
    // Seat ownership / request changes are callable-only, including administrator changes.
    function refereeSeatWriteValid(code, privateDoc) {
      let room = get(tourPath(code)).data;
      let changed = request.resource.data.diff(resource.data).affectedKeys();
      let enabled = room.get('refereeSeatsV1', {}).get('version', 0) == 1;
      return !changed.hasAny(['refereeSeatsV1','refereeSeatNames'])
        && (!enabled || !privateDoc || !changed.hasAny(['refereeStationAssignments','refereeStationNames','refereeStationUids','refereeStationRestrictionEnabled']))
        && (!enabled || !privateDoc || !changed.hasAny(['data'])
          || isAdminOrAbove() || isStaffOfficialCreatorExistingData(room))
        && (!enabled || privateDoc || !changed.hasAny(['bracketView'])
          || isAdminOrAbove() || isStaffOfficialCreatorExistingData(room));
    }
'''
anchor='    // ==== 路徑輔助函式 ===='
assert s.count(anchor)==1;s=s.replace(anchor,helper+'\n'+anchor)
for kind in ('true','false'):
 old='allow update: if qrCheckinWriteValid(code) && onsiteWaitlistWriteValid(code, '+kind+')'
 assert s.count(old)==1,old
 s=s.replace(old,'allow update: if refereeSeatWriteValid(code, '+kind+') && qrCheckinWriteValid(code) && onsiteWaitlistWriteValid(code, '+kind+')')
old="function noOperationsCreate(d) { return !d.keys().hasAny(["
assert s.count(old)==1;s=s.replace(old,old+"'refereeSeatsV1','refereeSeatNames',")
anchor='    match /tournaments/{code} {'
assert s.count(anchor)==1;s=s.replace(anchor,anchor+'''
      match /refereeSeatOperations/{id} { allow read, write: if false; }
      match /refereeScoreOperations/{id} { allow read, write: if false; }
      match /refereeScoreAudit/{id} { allow read, write: if false; }
      match /matchBuckets/{id} { allow read, write: if false; }
      match /bucketScoreOperations/{id} { allow read, write: if false; }
      match /bucketScoreAudit/{id} { allow read, write: if false; }
      match /bucketSeatOperations/{id} { allow read, write: if false; }
      match /bucketSeatAudit/{id} { allow read, write: if false; }
      match /refereeSeatAudit/{id} { allow read, write: if false; }
''')

def once(value,old,new):
 assert value.count(old)==1,old
 return value.replace(old,new)

private,tournament_anchor,public=s.partition('    match /tournaments/{code} {')
assert tournament_anchor and public.count('    match /publicTournaments/{code} {')==1
room,public_anchor,mirror=public.partition('    match /publicTournaments/{code} {')
room=once(room,"      allow create: if !request.resource.data.keys().hasAny(['registrationSelection','registeredCount','eventStaffAssignments']) && noOperationsCreate(request.resource.data) && (","      allow create: if !request.resource.data.keys().hasAny(['registrationSelection','registeredCount','eventStaffAssignments','scoreStorage']) && noOperationsCreate(request.resource.data) && (")
room=once(room,"      allow delete: if resource.data.get('qrCheckinManaged', false) != true && (!onsiteWaitlistOwned(resource.data)","      allow delete: if !('scoreStorage' in resource.data) && resource.data.get('qrCheckinManaged', false) != true && (!onsiteWaitlistOwned(resource.data)")
room=once(room,"      allow update: if refereeSeatWriteValid(code, true) && qrCheckinWriteValid(code)","      // Bucket rooms reject every legacy browser edit; migration is Admin SDK only.\n      allow update: if !('scoreStorage' in resource.data) && !('scoreStorage' in request.resource.data) && refereeSeatWriteValid(code, true) && qrCheckinWriteValid(code)")
mirror=once(mirror,"      allow delete: if resource.data.get('qrCheckinManaged', false) != true && (!onsiteWaitlistOwned(resource.data)","      allow delete: if !('scoreStorage' in get(tourPath(code)).data) && resource.data.get('qrCheckinManaged', false) != true && (!onsiteWaitlistOwned(resource.data)")
mirror=once(mirror,"      allow create: if !request.resource.data.keys().hasAny(['registrationSelection','registeredCount']) && noOperationsCreate(request.resource.data) && tournamentExistsAfterFor(code) && (","      allow create: if !request.resource.data.keys().hasAny(['registrationSelection','registeredCount']) && noOperationsCreate(request.resource.data) && tournamentExistsAfterFor(code) && !('scoreStorage' in tournamentDataAfterFor(code)) && (")
mirror=once(mirror,"      allow update: if refereeSeatWriteValid(code, false) && qrCheckinWriteValid(code)","      allow update: if tournamentExistsFor(code) && tournamentExistsAfterFor(code) && !('scoreStorage' in tournamentDataFor(code)) && !('scoreStorage' in tournamentDataAfterFor(code)) && refereeSeatWriteValid(code, false) && qrCheckinWriteValid(code)")
s=private+tournament_anchor+room+public_anchor+mirror
pathlib.Path(a.output).write_text(s)
print('Seat and bucket rules candidate generated; no deployment performed.')
