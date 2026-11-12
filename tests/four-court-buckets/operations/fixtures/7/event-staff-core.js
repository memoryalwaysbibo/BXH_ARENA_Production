'use strict';

const DUTIES=Object.freeze(['event_assistant','checkin','referee','head_referee']);
const STATUSES=Object.freeze(['invited','accepted','rejected','revoked']);

function text(value,limit,code){
  const result=String(value??'').normalize('NFKC').trim();
  if(!result||result.length>limit||result.includes('/'))throw Error(code);
  return result;
}
function normalizeEventCode(value){
  const code=text(value,32,'invalid-event-code').toUpperCase();
  if(!/^BXH-[A-Z0-9]{4,24}$/.test(code))throw Error('invalid-event-code');
  return code;
}
function normalizeUid(value){
  const uid=text(value,128,'invalid-target-uid');
  if(!/^[A-Za-z0-9_-]+$/.test(uid))throw Error('invalid-target-uid');
  return uid;
}
function normalizeDuties(value){
  if(!Array.isArray(value))throw Error('invalid-duties');
  const duties=[...new Set(value.map(v=>String(v||'').trim()).filter(Boolean))];
  if(!duties.length||duties.some(v=>!DUTIES.includes(v)))throw Error('invalid-duties');
  return duties;
}
function expiryMs(profile){
  const grant=profile&&profile.partnerOrganizer||{};
  const raw=Number(grant.expiresAtMs||grant.expiresAt||0);
  if(Number.isFinite(raw)&&raw>0)return raw;
  const parsed=Date.parse(grant.expiresAt||'');
  return Number.isFinite(parsed)?parsed:0;
}
function startsAtMs(profile){
  const grant=profile&&profile.partnerOrganizer||{};
  const raw=Number(grant.startsAtMs||0);
  if(Number.isFinite(raw)&&raw>0)return raw;
  const parsed=Date.parse(grant.startsAt||'');
  return Number.isFinite(parsed)?parsed:0;
}
function activeAccount(profile){
  return !!profile&&profile.active===true&&profile.isTestAccount!==true&&profile.deleted!==true
    && !['deleted','disabled','frozen'].includes(profile.accountStatus);
}
function activeOrganizer(profile,now=Date.now()){
  const grant=profile&&profile.partnerOrganizer;
  if(!activeAccount(profile)||profile.role!=='player'||!grant||grant.status!=='active'||!grant.organizationId)return false;
  const start=startsAtMs(profile),expiry=expiryMs(profile);
  return (!start||start<=now)&&expiry>now;
}
function parentFingerprint(profile){
  const grant=profile&&profile.partnerOrganizer||{};
  const orderCode=String(grant.orderCode||profile?.partnerContractOrderCode||'').trim();
  return orderCode?`contract:${orderCode}`:`manual:${grant.organizationId||''}:${expiryMs(profile)}`;
}
function ownsEvent(profile,uid,tournament,now=Date.now()){
  const grant=profile&&profile.partnerOrganizer||{};
  if(!activeOrganizer(profile,now)||!tournament)return false;
  const eventOrder=String(tournament.partnerContractOrderCode||'').trim();
  const grantOrder=String(grant.orderCode||profile.partnerContractOrderCode||'').trim();
  const orderMatches=grantOrder?eventOrder===grantOrder:!eventOrder;
  return tournament.eventAuthority==='official'&&tournament.createdBy===uid
    && tournament.createdByRole==='partner_organizer'
    && tournament.partnerOrganizationCode===grant.organizationId&&orderMatches;
}
function makeInvitation({eventCode,targetUid,organizerUid,organizerProfile,tournament,duties,displayName,now=Date.now()}){
  if(!ownsEvent(organizerProfile,organizerUid,tournament,now))throw Error('organizer-access-denied');
  const code=normalizeEventCode(eventCode),target=normalizeUid(targetUid),organizer=normalizeUid(organizerUid);
  if(target===organizer)throw Error('cannot-invite-self');
  return {eventCode:code,targetUid:target,organizerUid:organizer,
    organizationId:organizerProfile.partnerOrganizer.organizationId,
    parentFingerprint:parentFingerprint(organizerProfile),
    parentOrderCode:String(organizerProfile.partnerOrganizer.orderCode||organizerProfile.partnerContractOrderCode||'').trim()||null,
    parentExpiresAtMs:expiryMs(organizerProfile),duties:normalizeDuties(duties),
    displayName:String(displayName||'').normalize('NFKC').trim().slice(0,120),
    status:'invited',invitedAt:now,updatedAt:now};
}
function transition(assignment,action,actorUid,now=Date.now()){
  if(!assignment||!STATUSES.includes(assignment.status))throw Error('invalid-assignment');
  const next={...assignment,updatedAt:now};
  if(action==='accept'||action==='reject'){
    if(actorUid!==assignment.targetUid||assignment.status!=='invited')throw Error('transition-forbidden');
    next.status=action==='accept'?'accepted':'rejected';next.respondedAt=now;
  }else if(action==='revoke'){
    if(actorUid!==assignment.organizerUid||!['invited','accepted'].includes(assignment.status))throw Error('transition-forbidden');
    next.status='revoked';next.revokedAt=now;
  }else throw Error('invalid-action');
  return next;
}
function effective(assignment,staffProfile,organizerProfile,tournament,now=Date.now()){
  if(!assignment||assignment.status!=='accepted'||!activeAccount(staffProfile)||!tournament)return false;
  if(assignment.targetUid!==staffProfile.uid||assignment.organizerUid!==tournament.createdBy
    ||assignment.organizationId!==tournament.partnerOrganizationCode
    ||assignment.parentFingerprint!==parentFingerprint(organizerProfile))return false;
  return ownsEvent(organizerProfile,assignment.organizerUid,tournament,now);
}

module.exports={DUTIES,STATUSES,normalizeEventCode,normalizeUid,normalizeDuties,activeAccount,
  activeOrganizer,parentFingerprint,ownsEvent,makeInvitation,transition,effective};
