"""Compose seat ownership protection with an explicitly supplied current rules file.
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
# Preserve all baseline predicates; only add a conjunct at both tournament update entrypoints.
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
      match /refereeSeatAudit/{id} { allow read, write: if false; }
''')
pathlib.Path(a.output).write_text(s)
print('Seat rules candidate generated; no deployment performed.')
