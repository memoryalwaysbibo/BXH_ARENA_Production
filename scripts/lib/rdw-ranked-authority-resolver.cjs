'use strict';
// P3-44: server-owned ranking grant verification. This is a reference
// read-only resolver, not a deployed start endpoint or an entitlement grant.
const {verifyRankedAuthority}=require('./rdw-ranked-authority-gate.cjs');
function parseRoom(value){
 if(typeof value==='string'){try{return JSON.parse(value);}catch{return null;}}
 return value&&typeof value==='object'&&!Array.isArray(value)?value:null;
}
function asMs(raw){
 if(raw&&typeof raw.toMillis==='function')return raw.toMillis();
 if(typeof raw==='number')return Number.isFinite(raw)?raw:NaN;
 if(typeof raw==='string'&&raw.trim())return Number(raw)||Date.parse(raw);
 return NaN;
}
function createRankedAuthorityResolver({db,clock}={}){
 if(typeof db?.doc!=='function'||typeof db?.runTransaction!=='function'||typeof clock!=='function')throw Error('trusted-server-dependencies-required');
 return async function resolve({eventCode,actorUid,expectedRosterRevision,tx}={}){
  if(!/^BXH-[A-Z0-9]{6}$/.test(eventCode||'')||!/^[-\w]{1,128}$/.test(actorUid||'')||!Number.isSafeInteger(expectedRosterRevision)||expectedRosterRevision<0)
   return {ok:false,reason:'invalid-authority-request'};
  const read=async transaction=>{
   const roomRef=db.doc('tournaments/'+eventCode),actorRef=db.doc('users/'+actorUid);
   const [roomSnap,userSnap]=await Promise.all([transaction.get(roomRef),transaction.get(actorRef)]);
   if(!roomSnap?.exists||!userSnap?.exists)return {ok:false,reason:'authority-source-missing'};
   const room=roomSnap.data()||{},profile=userSnap.data()||{},state=parseRoom(room.data);
   if(!state||state.cloudCode&&state.cloudCode!==eventCode)return {ok:false,reason:'canonical-room-invalid'};
   const creator=room.createdBy||state.createdBy;
   // Conflicting creator identities may indicate a stale or overwritten room.
   if(room.createdBy&&state.createdBy&&room.createdBy!==state.createdBy)return {ok:false,reason:'creator-conflict'};
   if(!creator||state.registrationRosterRevision!==expectedRosterRevision)return {ok:false,reason:'creator-or-roster-unverified'};
   if(state.meta?.ladderMode!=='ranked'||state.meta?.eventAuthority!=='official'||
      room.eventAuthority&&room.eventAuthority!=='official'||state.testMode===true)return {ok:false,reason:'not-official-ranked'};
   if(profile.active!==true||profile.isTestAccount===true||profile.deleted===true||
      ['disabled','deleted','frozen'].includes(profile.accountStatus))return {ok:false,reason:'inactive-actor'};
   const isAdmin=profile.role==='admin'||profile.role==='super_admin';
   const isOfficialCreator=profile.role==='staff'&&creator===actorUid;
   const grant=profile.partnerOrganizer||{};
   const now=clock();
   if(!Number.isSafeInteger(now)||now<=0)throw Error('trusted-time-required');
   const starts=asMs(grant.startsAtMs??grant.startsAt);
   const expires=asMs(grant.expiresAtMs??grant.expiresAt);
   const order=String(grant.orderCode||profile.partnerContractOrderCode||'');
   const isPartnerCreator=profile.role==='player'&&creator===actorUid&&
      room.createdByRole==='partner_organizer'&&grant.status==='active'&&
      (!Number.isFinite(starts)||starts<=now)&&Number.isFinite(expires)&&expires>now&&
      typeof grant.organizationId==='string'&&grant.organizationId.length>0&&
      room.partnerOrganizationCode===grant.organizationId&&
      (order?room.partnerContractOrderCode===order:!room.partnerContractOrderCode);
   if(!isAdmin&&!isOfficialCreator&&!isPartnerCreator)return {ok:false,reason:'official-ranked-grant-denied'};
   const evidence={source:'trusted-server',verified:true,kind:'official-or-partner-ranked',
    eventCode,creatorUid:creator,actorUid,rosterRevision:expectedRosterRevision,authorized:true};
   const verified=verifyRankedAuthority({room,eventCode,actorUid,evidence});
   if(!verified.ok)return {ok:false,reason:verified.reason};
   return {ok:true,evidence};
  };
  return tx?read(tx):db.runTransaction(read);
 };
}
module.exports={createRankedAuthorityResolver};
