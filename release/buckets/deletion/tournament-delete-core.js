'use strict';

function millis(value){
  if(value&&typeof value.toMillis==='function')return value.toMillis();
  const number=Number(value);
  return Number.isFinite(number)?number:0;
}

function isTestIdentity(actor){
  return actor?.role==='tester'||actor?.isTestAccount===true;
}

function acceptedEventStaff(tournament,uid){
  const assignment=tournament?.eventStaffAssignments?.[uid];
  return assignment?.status==='accepted'&&assignment?.effective!==false;
}

function canDeleteTournament(actor,uid,tournament,now=Date.now()){
  if(!actor||actor.active!==true||isTestIdentity(actor)&&actor.role!=='tester')return false;
  if(['super_admin','admin'].includes(actor.role)&&!isTestIdentity(actor))return true;
  if(actor.role==='staff'&&!isTestIdentity(actor)){
    return tournament?.createdBy===uid
      ||(Array.isArray(tournament?.assignedStaffUids)&&tournament.assignedStaffUids.includes(uid))
      ||acceptedEventStaff(tournament,uid);
  }
  if(actor.role==='tester'){
    return tournament?.testMode===true
      &&tournament?.eventAuthority==='test'
      &&tournament?.createdBy===uid
      &&tournament?.ownerUid===uid
      &&millis(tournament?.testExpiresAt)>now;
  }
  const grant=actor.partnerOrganizer;
  const expiresAt=Number(grant?.expiresAtMs)||Date.parse(grant?.expiresAt||'')||0;
  const orderCode=grant?.orderCode||actor.partnerContractOrderCode||'';
  return actor.role==='player'
    &&grant?.status==='active'
    &&expiresAt>now
    &&tournament?.eventAuthority==='official'
    &&tournament?.createdBy===uid
    &&tournament?.createdByRole==='partner_organizer'
    &&tournament?.partnerOrganizationCode===grant?.organizationId
    &&tournament?.partnerContractOrderCode===orderCode;
}

module.exports={canDeleteTournament,acceptedEventStaff,isTestIdentity,millis};
