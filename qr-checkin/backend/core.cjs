'use strict';
const crypto = require('node:crypto');
const eventStaff = require('./event-staff-core.cjs');
class CheckinError extends Error { constructor(code) { super(code); this.code=code; } }
const fail=code=>{throw new CheckinError(code);};
const digest=value=>crypto.createHash('sha256').update(value).digest('hex');
function active(user) {
  return user?.active===true && !user.deleted && !['deleted','disabled','frozen'].includes(user.accountStatus) && user.isTestAccount!==true && user.role!=='tester';
}
function manager(user,uid,room,state,{parentUser,now=Date.now()}={}) {
  if(!active(user))return false;
  if(['super_admin','admin'].includes(user.role))return true;
  const owners=[room.ownerUid,room.createdBy,state.ownerUid,state.createdBy,state.meta?.ownerUid,state.meta?.createdBy];
  if(user.role==='player'&&(room.eventAuthority||state.meta?.eventAuthority)==='community')return owners.includes(uid);
  if(user.role==='staff')return room.assignedStaffUids===undefined || Array.isArray(room.assignedStaffUids)&&(room.assignedStaffUids.length===0||room.assignedStaffUids.includes(uid));
  if(eventStaff.ownsEvent({...user,uid},uid,room,now))return true;
  return eventStaff.effective(room.eventStaffAssignments?.[uid],{...user,uid},parentUser,room,now);
}
function mutable(room,state,onsiteReady=false) {
  if(room.systemClosed===true||room.eventCancelled===true||room.deletionStatus||room.startedAt||state.startedAt||['completed','archived'].includes(room.archiveStatus)||['completed','archived'].includes(state.archiveStatus)||['live','settling','done','cancelled'].includes(room.tournamentPhase)||state.meta?.eventCancelled)fail('checkin-closed');
  if(state.meta?.checkinRequired!==true||state.meta?.checkinClosedEarly===true)fail('checkin-closed');
  if(room.onsiteWaitlistServerOwned===true&&!onsiteReady)fail('onsite-integration-required');
}
function ownedPlayer(players,uid) {
  const found=(players||[]).filter(p=>p && !p.familyPlayerId && !p.guardianUid && (p.registrationUid===uid||p.uid===uid||p.accountUid===uid));
  if(found.length!==1)fail(found.length?'ambiguous-player':'not-confirmed');
  return found[0];
}
// All relationship and registration inputs are read within the same transaction.
function eligiblePlayer(player,uid,registration,profiles=[]) {
  if(!player||['waitlist','cancelled','withdrawn','not_selected'].includes(player.status))return false;
  if(player.familyPlayerId||player.guardianUid) {
    if(!player.familyPlayerId||player.guardianUid!==uid||!player.registrationId)return false;
    const matches=profiles.filter(p=>p&&p.id===player.familyPlayerId);
    if(matches.length!==1)return false;
    const child=matches[0];
    if(child.guardianUid!==uid||child.archived||child.deleted||child.testMode||child.accountUid||child.transferStatus||child.pendingAccountUid)return false;
    return registration?.status==='confirmed'&&registration.uid===uid&&registration.guardianUid===uid&&registration.familyPlayerId===player.familyPlayerId;
  }
  if(![player.registrationUid,player.uid,player.accountUid].includes(uid))return false;
  return !player.registrationId||(registration?.status==='confirmed'&&registration.uid===uid&&!registration.familyPlayerId&&!registration.guardianUid);
}
function scanPlayer(players,uid,playerId) {
  if(playerId===undefined)return ownedPlayer(players,uid);
  if(typeof playerId!=='string'||!playerId||playerId.length>200)fail('not-confirmed');
  const matches=(players||[]).filter(p=>p?.id===playerId);
  if(matches.length!==1)fail('not-confirmed');
  const p=matches[0];
  if(p.familyPlayerId ? p.guardianUid!==uid : p.guardianUid||![p.registrationUid,p.uid,p.accountUid].includes(uid))fail('not-confirmed');
  return p;
}
function signToken(code,session,now,secret) {
  const body=Buffer.from(JSON.stringify({code,session,expiresAt:now+90000})).toString('base64url');
  return body+'.'+crypto.createHmac('sha256',secret).update(body).digest('base64url');
}
function verifyToken(token,code,session,now,secret) {
  if(typeof token!=='string'||token.length>2048)fail('invalid-qr');
  const [body,mac,...extra]=token.split('.');
  const expected=crypto.createHmac('sha256',secret).update(body||'').digest('base64url');
  if(extra.length||!mac||!/^[A-Za-z0-9_-]{43}$/.test(mac)||!crypto.timingSafeEqual(Buffer.from(mac),Buffer.from(expected)))fail('invalid-qr');
  let data;try{data=JSON.parse(Buffer.from(body,'base64url').toString());}catch{fail('invalid-qr');}
  if(data.code!==code||data.session!==session||!Number.isSafeInteger(data.expiresAt)||data.expiresAt<=now||data.expiresAt>now+90000)fail('qr-expired');
}
// Called only inside the adapter's Firestore transaction. All inputs except d
// come from server reads; uid comes from verified Firebase Authentication.
function transition({code,uid,user,parentUser,room,state,registration,registrations={},familyProfiles=[],receipt,operation,config,d,now,secret,newSession,onsiteReady=false}) {
  if(!uid)fail('auth-required');
  if(!active(user))fail('account-unavailable');
  if(config?.enabled!==true||config?.writerGuardsVerified!==true||!Array.isArray(config.roomCodes)||!config.roomCodes.includes(code))fail('feature-unavailable');
  const isManager=manager(user,uid,room,state,{parentUser,now});
  if(!['scan','candidates','status','history','configure','manual','revoke'].includes(d.action))fail('invalid-action');
  if(!['scan','candidates'].includes(d.action)&&!isManager)fail('permission-denied');
  const settings=room.qrCheckin||{enabled:false,session:''};
  const allowOnsite=onsiteReady===true&&config.onsiteIntegrationVerified===true;
  if(d.action==='history')return {result:{ok:true}};
  if(d.action==='status') {
    let enabled=settings.enabled===true;try{mutable(room,state,allowOnsite);}catch{enabled=false;}
    return {result:{ok:true,enabled,token:enabled?signToken(code,settings.session,now,secret):null,expiresAt:enabled?now+90000:null}};
  }
  mutable(room,state,allowOnsite);
  if(d.action==='configure') {
    if(typeof d.enabled!=='boolean')fail('invalid-enabled');
    return {settings:{enabled:d.enabled,session:newSession},audit:{action:d.enabled?'open':'close',actorUid:uid,method:'manual',at:now},result:{ok:true,enabled:d.enabled}};
  }
  if(d.action==='candidates') {
    if(settings.enabled!==true)fail('checkin-closed');
    verifyToken(d.token,code,settings.session,now,secret);
    const players=(state.players||[]).filter(p=>eligiblePlayer(p,uid,registrations[p.registrationId],familyProfiles));
    return {result:{ok:true,players:players.map(p=>({id:p.id,name:p.name,checkedIn:p.checkedIn===true,family:!!p.familyPlayerId}))}};
  }
  let player;
  if(d.action==='scan') {
    if(settings.enabled!==true)fail('checkin-closed');
    verifyToken(d.token,code,settings.session,now,secret);
    player=scanPlayer(state.players,uid,d.playerId);
    if(!eligiblePlayer(player,uid,registration,familyProfiles))fail('not-confirmed');
  } else {
    if(typeof d.operationId!=='string'||!/^[-a-zA-Z0-9]{16,80}$/.test(d.operationId))fail('invalid-operation');
    if(operation) {
      if(operation.actorUid!==uid||operation.action!==d.action||operation.playerId!==d.playerId)fail('operation-conflict');
      return {result:operation.result};
    }
    player=(state.players||[]).find(p=>p.id===d.playerId);
    if(!player)fail('not-confirmed');
  }
  const checked=d.action!=='revoke';
  if(player.checkedIn===checked) {
    const result={ok:true,already:true,checkedIn:checked,name:player.name,firstAt:receipt?.firstAt||null,currentAt:receipt?.currentAt||null,legacy:!receipt};
    return {result,operation:d.action==='scan'?null:{actorUid:uid,action:d.action,playerId:player.id,result}};
  }
  const method=d.action==='scan'?'qr':'manual';
  const nextReceipt={playerId:player.id,name:player.name,accountUid:player.registrationUid||player.uid||player.accountUid||null,code,firstAt:receipt?.firstAt||(checked?now:null),currentAt:checked?now:null,checkedIn:checked,method,actorUid:uid};
  const result={ok:true,checkedIn:checked,name:player.name,firstAt:nextReceipt.firstAt,currentAt:nextReceipt.currentAt};
  return {playerId:player.id,receipt:nextReceipt,audit:{action:d.action,playerId:player.id,name:player.name,accountUid:nextReceipt.accountUid,registrationId:player.registrationId||null,checkedIn:checked,firstAt:nextReceipt.firstAt,currentAt:nextReceipt.currentAt,actorUid:uid,method,at:now},operation:d.action==='scan'?null:{actorUid:uid,action:d.action,playerId:player.id,result},result};
}
// Integrate into EVERY trusted state writer, after its roster projection.
// The ledger stays authoritative even if a manager tab holds an old snapshot.
function preserveCheckins(nextState,receipts) {
  const byId=new Map(receipts.map(r=>[r.playerId,r]));
  for(const p of nextState.players||[]) {
    const r=byId.get(p.id);if(!r)continue;
    p.checkedIn=r.checkedIn;p.checkinFirstAt=r.firstAt;p.checkinAt=r.currentAt;p.checkinMethod=r.method;
  }
  return nextState;
}
module.exports={transition,preserveCheckins,ownedPlayer,scanPlayer,eligiblePlayer,signToken,verifyToken,manager,digest,CheckinError};
