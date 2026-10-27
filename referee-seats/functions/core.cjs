'use strict';
const SLOTS=Object.freeze(['main','backup1','backup2']);
const LABELS=Object.freeze({main:'主裁判',backup1:'備用裁判 1',backup2:'備用裁判 2'});
const clone=value=>JSON.parse(JSON.stringify(value));
function fail(code){throw Object.assign(new Error(code),{seatCode:code});}
const EventStaff=require('./event-staff-core.cjs');
function admin(user){return EventStaff.activeAccount(user)&&['admin','super_admin'].includes(user.role);}
function partnerRoom(room){return room?.createdByRole==='partner_organizer';}
function ownsPartnerEvent(room,user,uid,now){
 const grant=user?.partnerOrganizer,expiry=grant?.expiresAtMs??grant?.expiresAt,start=grant&&Object.hasOwn(grant,'startsAtMs')?grant.startsAtMs:0;
 const order=grant?.orderCode||user?.partnerContractOrderCode||'';
 if(typeof grant?.organizationId!=='string'||!grant.organizationId.trim()
   ||typeof expiry!=='number'||!Number.isFinite(expiry)||expiry<=now
   ||typeof start!=='number'||!Number.isFinite(start)||start<0||start>now
   ||typeof order!=='string'||(!order&&grant?.scope==='contract'))return false;
 return EventStaff.ownsEvent(user,uid,room,now);
}
function partnerOwner(room,user,uid,{now=Date.now(),partnerEnabled=false}={}){
 return partnerEnabled&&partnerRoom(room)&&ownsPartnerEvent(room,user,uid,now);
}
function manager(room,user,uid,authority={}){
 return admin(user)||(EventStaff.activeAccount(user)&&room.createdBy===uid&&user.role==='staff')||partnerOwner(room,user,uid,authority);
}
// Activity grants are read from the authoritative room, never user memberships or request data.
function eligible(room,user,uid,authority={}){
 if(!uid||!EventStaff.activeAccount(user))return false;
 if(['staff','admin','super_admin'].includes(user.role))return true;
 if(partnerOwner(room,user,uid,authority))return true;
 if(!authority.partnerEnabled||!partnerRoom(room)||user.role!=='player')return false;
 const assignment=room.eventStaffAssignments?.[uid];
 const raw=authority.parentUser?.partnerOrganizer?.expiresAtMs||authority.parentUser?.partnerOrganizer?.expiresAt;
 const expiry=Number(raw)||Date.parse(raw||'');
 if(assignment?.parentExpiresAtMs!==expiry||(assignment?.parentOrderCode||null)!==(room.partnerContractOrderCode||null)
   ||!ownsPartnerEvent(room,authority.parentUser,room.createdBy,authority.now??Date.now()))return false;
 return Array.isArray(assignment?.duties)&&assignment.duties.some(d=>d==='referee'||d==='head_referee')
   &&EventStaff.effective(assignment,{...user,uid},authority.parentUser,room,authority.now??Date.now());
}
function display(user){return String(user.realName||user.gameId||user.displayName||'未設定姓名').trim().slice(0,80);}
function writable(room,state){
 if(room.eventAuthority!=='official'||state.meta?.eventAuthority!=='official'||room.eventCancelled===true||room.systemClosed===true||room.deletionStatus||['completed','archived'].includes(room.archiveStatus)||['completed','archived'].includes(state.archiveStatus))fail('room-read-only');
}
function invalidate(model,station,now){for(const req of Object.values(model.requests)){if(req.status==='pending'&&(req.station===station||req.expiresAt<=now)){req.status=req.expiresAt<=now?'expired':'stale';req.resolvedAt=now;}}}
function project(model,ownerUid=null,stations=0){
 const assignments={},names={},publicSeats={},uids=new Set();
 const courts={...model.courts};for(let n=1;n<=Math.min(32,Number(stations)||0);n++)courts[n]=courts[n]||{main:null,backup1:null,backup2:null};
 for(const [station,court] of Object.entries(courts)){
  assignments[station]=[];names[station]=[];publicSeats[station]={};
  if(ownerUid)assignments[station].push(ownerUid);
  for(const slot of SLOTS){const seat=court[slot];publicSeats[station][slot]=seat?{name:seat.name}:null;if(seat){if(!assignments[station].includes(seat.uid))assignments[station].push(seat.uid);names[station].push(seat.name);uids.add(seat.uid);}}
 }
 return {refereeStationAssignments:assignments,refereeStationNames:names,refereeStationUids:[...uids],refereeStationRestrictionEnabled:true,refereeSeatNames:publicSeats};
}
function transition({room,state,user,uid,d,now,id,targetUser,requesterUser,authority={}}){
 writable(room,state);
 if(!eligible(room,user,uid,authority))fail('not-event-staff');
 const isManager=manager(room,user,uid,authority),action=d.action;
 let model=room.refereeSeatsV1?clone(room.refereeSeatsV1):null;
 if(action==='enable'){
  if(state.meta?.battleMode==='team')fail('team-not-supported');
  if(state.meta?.playMode==='enchantment')fail('enchantment-not-supported');
  if(!isManager)fail('permission-denied');
  if(model?.version===1)fail('already-enabled');
  if(Object.values(room.refereeStationAssignments||{}).some(list=>Array.isArray(list)&&list.length))fail('legacy-assignments-exist');
  const count=Number(state.meta?.stations);
  if(!Number.isSafeInteger(count)||count<1||count>64)fail('invalid-stations');
  model={version:1,revision:0,courts:Object.fromEntries(Array.from({length:count},(_,i)=>[String(i+1),{revision:0,main:null,backup1:null,backup2:null}])),requests:{}};
 }else{
  if(model?.version!==1)fail('not-enabled');
  const station=Number(d.station),slot=d.slot;
  if(!Number.isSafeInteger(station)||station<1||station>Number(state.meta.stations)||state.forcedCourtExits?.[station]?.closed||!SLOTS.includes(slot))fail('invalid-seat');
  // Courts added after activation are initialized only for a valid physical court.
  const court=model.courts[String(station)]||(model.courts[String(station)]={revision:0,main:null,backup1:null,backup2:null});
  const seat=court[slot];
  if(action==='respond'){
   const req=model.requests[d.requestId];
   if(!req||req.station!==station||req.slot!==slot||req.toUid!==uid||req.status!=='pending')fail('request-unavailable');
   if(req.expiresAt<=now||req.courtRevision!==court.revision||seat?.uid!==uid||(req.sourceSlot?court[req.sourceSlot]?.uid!==req.fromUid:SLOTS.some(s=>court[s]?.uid===req.fromUid)))fail('request-stale');
   if(!['accept','reject'].includes(d.response))fail('invalid-response');
   if(d.response==='reject'){req.status='rejected';req.resolvedAt=now;}
   else{
    if(!eligible(room,requesterUser,req.fromUid,authority))fail('requester-ineligible');
    const next={uid:req.fromUid,name:display(requesterUser),joinedAt:now};
    if(req.sourceSlot)court[req.sourceSlot]={...seat,joinedAt:now};
    court[slot]=next;court.revision++;
    req.status='accepted';req.resolvedAt=now;invalidate(model,station,now);
   }
  }else{
   if(d.expectedCourtRevision!==court.revision)fail('seat-stale');
   if(action==='claim'){
    if(seat)fail('seat-occupied');
    if(SLOTS.some(s=>court[s]?.uid===uid))fail('already-seated');
    court[slot]={uid,name:display(user),joinedAt:now};court.revision++;invalidate(model,station,now);
   }else if(action==='leave'||action==='revoke'){
    if(!seat||seat.uid!==d.expectedUid)fail('seat-stale');
    if(action==='leave'?seat.uid!==uid:!(isManager||(slot!=='main'&&court.main?.uid===uid)))fail('permission-denied');
    court[slot]=null;court.revision++;invalidate(model,station,now);
   }else if(action==='request'){
    if(!seat||seat.uid!==d.expectedUid||seat.uid===uid)fail('seat-stale');
    if(!eligible(room,targetUser,seat.uid,authority))fail('target-ineligible');
    for(const req of Object.values(model.requests))if(req.status==='pending'&&req.expiresAt>now&&(req.toUid===seat.uid||req.fromUid===uid))fail('request-pending');
    const sourceSlot=SLOTS.find(s=>court[s]?.uid===uid)||null;
    model.requests[id]={id,station,slot,fromUid:uid,fromName:display(user),toUid:seat.uid,sourceSlot,courtRevision:court.revision,status:'pending',createdAt:now,expiresAt:now+120000};
   }else if(action==='cancel'){
    const req=model.requests[d.requestId];
    if(!req||req.fromUid!==uid||req.status!=='pending'||req.station!==station||req.slot!==slot)fail('request-unavailable');
    req.status='cancelled';req.resolvedAt=now;
   }else fail('invalid-action');
  }
 }
 model.revision++;
 // Keep pending requests plus a bounded recent result list for reconnect notifications.
 const recent=Object.values(model.requests).sort((a,b)=>b.createdAt-a.createdAt);
 model.requests=Object.fromEntries(recent.filter((r,i)=>r.status==='pending'&&r.expiresAt>now||i<50).map(r=>[r.id,r]));
 return {model,projection:project(model),result:{ok:true,revision:model.revision,...(action==='request'?{requestId:id}:{}),...(action==='respond'?{status:model.requests[d.requestId]?.status}:{})}};
}
module.exports={SLOTS,LABELS,admin,manager,eligible,partnerRoom,transition,project};
