"""Build an emulator-only policy overlay from a hash-pinned production Rules read."""
import hashlib,pathlib
ROOT=pathlib.Path(__file__).parent
source=(ROOT/'firestore.production.rules').read_text()
assert hashlib.sha256(source.encode()).hexdigest()=='16a63af99700746ed095120cb4652dafe38572d78806a638ad2fabace74988c8','production-baseline-changed'
helpers='''
    function partnerPolicyCreateValid(code, d) {
      let order = d.get('partnerContractOrderCode', '');
      let paid = d.get('createdByRole','') == 'partner_organizer' && order is string && order.size() > 0;
      let contract = paid ? get(/databases/$(database)/documents/partnerContracts/$(order)).data : {};
      let policy = contract.get('quotaPolicy','creation-v1');
      let fresh = paid && policy == 'start-v1';
      return !d.keys().hasAny(['partnerQuotaDebit','partnerStartedAt','rdwSnapshotDigest','rdwStartMode'])
        && (fresh
          ? (isPartnerTournamentData(myProfile(), d)
            && myProfile().partnerOrganizer.get('scope','') == 'contract'
            && myProfile().partnerOrganizer.get('quotaPolicy','creation-v1') == 'start-v1'
            && myProfile().partnerOrganizer.get('quotaPolicyVersion',0) == 1
            && contract.get('quotaPolicyVersion',0) == 1
            && d.get('ladderMode','') == 'ranked'
            && d.get('partnerQuotaPolicy','') == 'start-v1'
            && d.get('partnerStartState','') == 'draft'
            && contract.status == 'active' && contract.targetUid == request.auth.uid
            && contract.organizationCode == d.partnerOrganizationCode
            && contract.get('usedEvents',-1) is int && contract.get('usedEvents',-1) >= 0
            && contract.get('includedEvents',0) is int && contract.usedEvents < contract.includedEvents
            && getAfter(/databases/$(database)/documents/partnerContracts/$(order)).data.usedEvents == contract.usedEvents
            && existsAfter(/databases/$(database)/documents/publicTournaments/$(code))
            && getAfter(/databases/$(database)/documents/publicTournaments/$(code)).data.get('partnerQuotaPolicy','') == 'start-v1'
            && getAfter(/databases/$(database)/documents/publicTournaments/$(code)).data.get('partnerStartState','') == 'draft')
          : ((!paid || policy == 'creation-v1') && !d.keys().hasAny(['partnerQuotaPolicy','partnerStartState'])));
    }
    function partnerPolicyMirrorCreateValid(code, d) {
      let privateData = getAfter(/databases/$(database)/documents/tournaments/$(code)).data;
      return !d.keys().hasAny(['partnerQuotaDebit','partnerStartedAt','rdwSnapshotDigest','rdwStartMode'])
        && (privateData.get('partnerQuotaPolicy','') == 'start-v1'
          ? d.get('partnerQuotaPolicy','') == 'start-v1' && d.get('partnerStartState','') == 'draft'
          : !d.keys().hasAny(['partnerQuotaPolicy','partnerStartState']));
    }
    function partnerPolicyWriteValid() {
      let changed = request.resource.data.diff(resource.data).affectedKeys();
      return !changed.hasAny(['partnerQuotaPolicy','partnerStartState','partnerStartedAt','partnerQuotaDebit'])
        && (resource.data.get('partnerQuotaPolicy','') != 'start-v1'
          || !changed.hasAny(['rdwSnapshotDigest','rdwStartMode']));
    }
    match /partnerEventDebits/{code} { allow read, write: if false; }
'''
assert source.count('    function paidPartnerQuotaValid(')==1
source=source.replace('    function paidPartnerQuotaValid(',helpers+'    function paidPartnerQuotaValid(',1)
source=source.replace('|| paidPartnerQuotaValid(code, tournamentData.partnerContractOrderCode);',"|| tournamentData.get('partnerQuotaPolicy','') == 'start-v1'\n        || paidPartnerQuotaValid(code, tournamentData.partnerContractOrderCode);",1)
source=source.replace("&& resource.data.status == 'active'\n        && resource.data.targetUid", "&& resource.data.status == 'active'\n        && resource.data.get('quotaPolicy','creation-v1') == 'creation-v1'\n        && resource.data.targetUid",1)
private="allow create: if !request.resource.data.keys().hasAny(['registrationSelection','registeredCount','eventStaffAssignments']) && noOperationsCreate(request.resource.data) && ("
assert source.count(private)==1
source=source.replace(private,private.replace('if !','if partnerPolicyCreateValid(code,request.resource.data) && !'),1)
public="allow create: if !request.resource.data.keys().hasAny(['registrationSelection','registeredCount']) && noOperationsCreate(request.resource.data) && tournamentExistsAfterFor(code) && ("
assert source.count(public)==1
source=source.replace(public,public.replace('if !','if partnerPolicyMirrorCreateValid(code,request.resource.data) && !'),1)
assert source.count('allow update: if qrCheckinWriteValid(code)')==2
source=source.replace('allow update: if qrCheckinWriteValid(code)','allow update: if partnerPolicyWriteValid() && qrCheckinWriteValid(code)')
(ROOT/'firestore.candidate.rules').write_text(source)
print('Built partner policy Rules candidate; no deployment.')
