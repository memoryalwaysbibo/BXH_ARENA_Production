"""Build a candidate against the exact read-only Production rules snapshot."""
import hashlib,pathlib
ROOT=pathlib.Path(__file__).resolve().parent
SOURCE=ROOT/'reference/firestore.production-20261016.rules'
EXPECTED='da88176f471ba88fd288b2d4a6d953bc9c63f83952559f61947abc7a28572118'
raw=SOURCE.read_bytes()
if hashlib.sha256(raw).hexdigest()!=EXPECTED:raise SystemExit('Production snapshot hash mismatch')
s=raw.decode()
functions='''
    // QR check-in candidate: unchanged original role predicates still apply.
    function qrCheckinManagedWriteValid(code) {
      let before = get(tourPath(code)).data;
      let after = getAfter(tourPath(code)).data;
      let pubBefore = get(pubPath(code)).data;
      let pubAfter = getAfter(pubPath(code)).data;
      return after.qrCheckinManaged == true
        && after.qrCheckin == before.qrCheckin
        && before.qrCheckinRevision is int
        && after.qrCheckinRevision == before.qrCheckinRevision + 1
        && after.data.matches('.*"qrCheckinRevision":' + string(after.qrCheckinRevision) + '[,}].*')
        && pubAfter.qrCheckinManaged == true
        && pubAfter.qrCheckinRevision == after.qrCheckinRevision
        && pubBefore.qrCheckinRevision == before.qrCheckinRevision;
    }
    function qrCheckinWriteValid(code) {
      return resource.data.get('qrCheckinManaged', false) == true
        ? qrCheckinManagedWriteValid(code)
        : !request.resource.data.diff(resource.data).affectedKeys().hasAny(['qrCheckin','qrCheckinManaged','qrCheckinRevision']);
    }
'''
anchor='    // ==== 路徑輔助函式 ===='
assert s.count(anchor)==1
s=s.replace(anchor,functions+'\n'+anchor)
for kind in ['true','false']:
 old='allow update: if onsiteWaitlistWriteValid(code, '+kind+')'
 assert s.count(old)==1
 s=s.replace(old,'allow update: if qrCheckinWriteValid(code) && onsiteWaitlistWriteValid(code, '+kind+')')
old="allow delete: if (!onsiteWaitlistOwned(resource.data)"
assert s.count(old)==2
s=s.replace(old,"allow delete: if resource.data.get('qrCheckinManaged', false) != true && (!onsiteWaitlistOwned(resource.data)")
old="function noOperationsCreate(d) { return !d.keys().hasAny(["
assert s.count(old)==1
s=s.replace(old,old+"'qrCheckin','qrCheckinManaged','qrCheckinRevision',")
# Only existing runtime-write allowlists receive this counter. The new guard
# requires both mirrors and retains the existing role/ownership predicates.
old="hasOnly(['onsiteWaitlistRuntimeRevision',"
assert s.count(old)==12
s=s.replace(old,"hasOnly(['qrCheckinRevision','onsiteWaitlistRuntimeRevision',")
for collection in ['tournaments','publicTournaments']:
 anchor='    match /'+collection+'/{code} {'
 assert s.count(anchor)==1
 if collection=='tournaments':
  s=s.replace(anchor,anchor+'''
      match /checkinReceipts/{id} { allow read, write: if false; }
      match /checkinAudit/{id} { allow read, write: if false; }
      match /checkinOperations/{id} { allow read, write: if false; }
''')
(ROOT/'firestore.candidate.rules').write_text(s)
print('Candidate built; not deployed')
