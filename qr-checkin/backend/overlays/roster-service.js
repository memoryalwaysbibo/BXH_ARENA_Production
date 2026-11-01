'use strict';
const {createHash}=require('node:crypto');
const {quickPolicy,quickParticipants}=require('./community-registration-policy');
const {projectQuickRoster,assertPendingBracketOnly}=require('./community-registration-roster');
const {onsiteWaitlistOwned,readManagedRows,projectManagedCancellation,projectManagedLocalCancellation}=require('./onsite-waitlist-writer-guards');
const epoch=x=>x?.toMillis?x.toMillis():Number(x)||0;
const active=p=>p?.active===true&&!p.deleted&&!['deleted','disabled','frozen'].includes(p.accountStatus);
const parse=x=>{try{return typeof x==='string'?JSON.parse(x):x||{};}catch{throw Error('corrupt-state');}};
function manager(user,uid,t,s){
 if(!active(user)||user.isTestAccount===true)return false;
 if(['super_admin','admin'].includes(user.role))return true;
 if(user.role==='player'&&(t.eventAuthority||s.meta?.eventAuthority)==='community'&&(t.ownerUid===uid||s.ownerUid===uid||t.createdBy===uid))return true;
 const assignments=[...(t.assignedStaffUids||[]),...(s.meta?.assignedStaffUids||[])];
 return ['staff','partner_organizer'].includes(user.role)&&(assignments.includes(uid)||[t.ownerUid,t.createdBy,s.meta?.ownerUid,s.meta?.createdBy].includes(uid));
}
// The direct staff roster Rules permit unassigned staff when the tournament's
// assignment list is absent/empty. Community ownership is not a staff role, and
// partner/event-staff grants only apply to official events, never this route.
function promotionManager(user,uid,t){
 if(!active(user)||user.isTestAccount===true)return false;
 if(['super_admin','admin'].includes(user.role))return true;
 return user.role==='staff'&&(!Object.prototype.hasOwnProperty.call(t,'assignedStaffUids')||
  Array.isArray(t.assignedStaffUids)&&(t.assignedStaffUids.length===0||t.assignedStaffUids.includes(uid)));
}
function mutable(t,p,s,prestartCancellation=false){
 if(t.systemClosed||p.systemClosed||t.eventCancelled||p.eventCancelled||s.meta?.eventCancelled||s.startedAt||t.startedAt||p.startedAt||(!prestartCancellation&&s.bracketSize)||s.archiveStatus==='completed'||t.archiveStatus==='completed'||p.archiveStatus==='completed'||['live','settling','done','cancelled'].includes(t.tournamentPhase)||['live','settling','done','cancelled'].includes(p.tournamentPhase))throw Error('bracket-locked');
 if(t.registrationSelection||p.registrationSelection||s.entrySelection?.mode==='registration')throw Error('selection-managed');
 if((t.battleMode||s.meta?.battleMode)==='team')throw Error('team-roster-managed');
}
function publicMirror(pub,s,metaPatch={},quick=false){
 const mirror=parse(pub.bracketView);
 mirror.registrationRosterRevision=s.registrationRosterRevision;
 mirror.updatedAt=s.updatedAt;
 if(quick)mirror.communityParticipantCount=s.communityParticipantCount;
 mirror.meta={...(mirror.meta||{}),registrationAutoFillEnabled:s.meta.registrationAutoFillEnabled===true,...metaPatch};
 mirror.players=(s.players||[]).map(p=>({id:p.id,name:p.name,checkedIn:p.checkedIn===true}));
 return JSON.stringify(mirror);
}
function reconcile(s,rows,quick=false,code=''){
 if(quick){Object.assign(s,projectQuickRoster(s,rows,{roomCode:code}));return;}
 const previous=[...(s.players||[]),...(s.waitlistPlayers||[])];
 const matches=(p,r)=>String(p.registrationId||'')===r.registrationId||
  (String(p.registrationUid||p.guardianUid||'')===String(r.guardianUid||r.uid||'') &&
   (r.familyPlayerId?String(p.familyPlayerId||'')===String(r.familyPlayerId):!p.familyPlayerId));
 const player=r=>{
  const old=previous.find(p=>matches(p,r))||{},p={...old,
   id:old.id||(r.familyPlayerId?'family_'+r.familyPlayerId:'reg_'+r.registrationId),
   name:r.displayName||r.publicName||r.participantName||r.realName||old.name||'未命名選手',
   source:'online',registrationId:r.registrationId,registrationUid:r.guardianUid||r.uid||r.registrationId,
   checkedIn:old.id?old.checkedIn===true:!s.meta.checkinRequired};
  if(r.familyPlayerId)Object.assign(p,{familyPlayerId:r.familyPlayerId,participantId:r.familyPlayerId,guardianUid:r.guardianUid});
  if(r.status==='waitlist'){p.waitRank=Number(r.waitRank)||0;p.waitlistedAt=epoch(r.createdAt);}
  else{delete p.waitRank;delete p.waitlistedAt;}
  return p;
 };
 const onsite=p=>p.source!=='online'&&!p.registrationId;
 s.players=(s.players||[]).filter(onsite).concat(rows.filter(r=>r.status==='confirmed').map(player));
 s.waitlistPlayers=(s.waitlistPlayers||[]).filter(onsite).concat(rows.filter(r=>r.status==='waitlist').map(player));
}
function createRosterService(db,FieldValue,clock=Date.now){return async req=>{
 const uid=req.auth?.uid,d=req.data||{};
 if(!uid)throw Error('auth-required');
 const code=String(d.code||'').trim().toUpperCase();
 if(!/^BXH-[A-Z0-9]{4,16}$/.test(code)||!['configure','cancel','promote'].includes(d.action)||!/^[A-Za-z0-9_-]{8,100}$/.test(d.operationId||''))throw Error('invalid-operation');
 if(d.action==='configure'&&typeof d.enabled!=='boolean')throw Error('invalid-operation');
 const intent=d.intent==='player'?'player':'admin';
 const registrationId=String(d.registrationId||''),localId=String(d.localId||'');
 if(d.action==='cancel'&&((!registrationId&&!localId)||(registrationId&&localId)||!(/^[A-Za-z0-9_-]{1,128}$/.test(registrationId||localId))))throw Error('invalid-operation');
 if(d.action==='promote'&&(!/^[A-Za-z0-9_-]{1,128}$/.test(registrationId)||localId||d.expandBy!==undefined&&d.expandBy!==0))throw Error('invalid-operation');
 const tr=db.doc('tournaments/'+code),pr=db.doc('publicTournaments/'+code);
 const op=tr.collection('rosterActions').doc(createHash('sha256').update(uid+'|'+d.operationId).digest('hex'));
 const hash=createHash('sha256').update(JSON.stringify({action:d.action,intent,registrationId,localId,enabled:d.enabled})).digest('hex');
 const response=await db.runTransaction(async tx=>{
  const [us,ts,ps,os]=await Promise.all([tx.get(db.doc('users/'+uid)),tx.get(tr),tx.get(pr),tx.get(op)]);
  const user=us.data();if(!active(user))throw Error('auth-required');
  if(!ts.exists||!ps.exists)throw Error('not-found');
  const t=ts.data(),pub=ps.data(),s=parse(t.data),quick=quickPolicy(t,pub);
  if(quick&&(!s||typeof s!=='object'||Array.isArray(s)||!Array.isArray(s.players)))throw Error('corrupt-state');
  s.meta=s.meta||{};
  if(quick&&Number.isSafeInteger(t.communityParticipantCount)&&t.communityParticipantCount>=0)s.communityParticipantCount=t.communityParticipantCount;
  const managed=onsiteWaitlistOwned(t,pub,s);
  const isManager=d.action!=='promote'&&manager(user,uid,t,s);
  if(d.action==='promote'){
   if(intent!=='admin'||!promotionManager(user,uid,t))throw Error('permission-denied');
   if(managed)throw Error('onsite-waitlist-managed');
   if(!quick||quick.capacity!==null)throw Error('unlimited-quick-registration-required');
  }else if((d.action==='configure'||intent==='admin'||localId)&&!isManager)throw Error('permission-denied');
  // Ownership outlives close/disable and is read in the writing transaction.
  // Never replay an old configure/promote as if it could bypass that ownership.
  const finalized=t.onsiteWaitlistFinalized===true&&pub.onsiteWaitlistFinalized===true&&s.onsiteWaitlistFinalized===true;
  if(managed&&(d.action==='configure'||localId&&!finalized))throw Error('onsite-waitlist-managed');
  if(os.exists){if(os.data().requestHash!==hash)throw Error('operation-conflict');return {...os.data().result,state:s,replayed:true};}
  const prestartCancellation=d.action==='cancel'&&intent==='admin'&&isManager&&!managed;
  mutable(t,pub,s,prestartCancellation);
  if(quick||prestartCancellation)assertPendingBracketOnly(s,parse(pub.bracketView));
  const pendingBracket=!!s.bracketSize||(s.matches||[]).length>0;
  const now=clock();
  if(d.action==='configure'){
   s.meta.registrationAutoFillEnabled=d.enabled;
   s.registrationRosterRevision=Number(s.registrationRosterRevision||0)+1;s.updatedAt=now;
   tx.update(tr,{data:JSON.stringify(s),updatedAt:now});
   tx.update(pr,{bracketView:publicMirror(pub,s,{},quick),updatedAt:now});
   const result={ok:true,enabled:d.enabled};
   tx.create(op,{actorUid:uid,requestHash:hash,result,createdAt:now});
   return {...result,state:s};
  }
  // Read every registration before any write. Transaction retries select from the
  // current queue, so concurrent cancellations cannot promote the same person.
  const rows=managed ? (await readManagedRows(tx,tr)).map(row=>({...row,ref:tr.collection('registrations').doc(row.registrationId)})) :
   (await tx.get(tr.collection('registrations'))).docs.map(ds=>({...ds.data(),registrationId:ds.id,ref:ds.ref}));
  const row=registrationId?rows.find(r=>r.registrationId===registrationId):null;
  const local=localId?(s.players||[]).find(p=>String(p.id)===localId):null;
  if(registrationId&&!row||localId&&!local)throw Error('not-found');
  if(local&&(local.registrationId||local.source==='online'))throw Error('online-registration-required');
  if(d.action==='promote'){
   if(t.tournamentPhase!=='waiting'||pub.systemClosed||pub.archiveStatus==='completed')throw Error('bracket-locked');
   if(row.status!=='waitlist')throw Error('not-waitlist');
   for(const [field,status]of [['confirmedCount','confirmed'],['waitlistCount','waitlist']]){
    if(!Number.isSafeInteger(t[field])||t[field]<0||pub[field]!==t[field]||rows.filter(r=>r.status===status).length!==t[field])throw Error('registration-state-conflict');
   }
   if(typeof t.registrationStatus!=='string'||!['scheduled','open','full','closed'].includes(t.registrationStatus)||pub.registrationStatus!==t.registrationStatus)throw Error('registration-state-conflict');
   row.status='confirmed';
   reconcile(s,rows,quick,code);
   const confirmed=t.confirmedCount+1,waitlist=t.waitlistCount-1;
   const status=t.registrationStatus==='full'?'open':t.registrationStatus;
   s.meta.registrationCapacity=null;s.meta.registrationStatus=status;
   s.registrationRosterRevision=Number(s.registrationRosterRevision||0)+1;s.updatedAt=now;
   const patch={capacity:null,confirmedCount:confirmed,waitlistCount:waitlist,communityParticipantCount:quickParticipants(s,rows).count,registrationStatus:status,updatedAt:now,lastRegistrationMutationType:'promote',lastRegistrationMutationUid:registrationId,lastRegistrationMutationBy:uid};
   s.communityParticipantCount=patch.communityParticipantCount;
   tx.update(row.ref,{status:'confirmed',promotedAt:FieldValue.serverTimestamp(),promotedBy:uid,updatedAt:FieldValue.serverTimestamp()});
   tx.update(tr,{...patch,data:JSON.stringify(s)});
   tx.update(pr,{...patch,bracketView:publicMirror(pub,s,{registrationCapacity:null,registrationStatus:status},quick)});
   const result={ok:true,registrationId,status:'confirmed',capacity:null,confirmedCount:confirmed,waitlistCount:waitlist,registrationChanges:[{registrationId,status:'confirmed'}]};
   tx.create(op,{actorUid:uid,requestHash:hash,result,createdAt:now});
   return {...result,state:s};
  }
  if(intent==='player'){
   if(!row||!(row.registrationId===uid||row.uid===uid||row.guardianUid===uid))throw Error('permission-denied');
   if(quick ? (quick.cancellationDeadline!==null&&now>=quick.cancellationDeadline) : (!epoch(t.cancellationDeadline)||now>=epoch(t.cancellationDeadline)))throw Error('cancel-deadline-passed');
  }
  const oldStatus=row?row.status:'confirmed';
  if(!['confirmed','waitlist','cancelled'].includes(oldStatus))throw Error('nothing-to-cancel');
  if(oldStatus==='cancelled')return {ok:true,status:'cancelled',registrationId,autoPromoted:false,state:s,alreadyCancelled:true};
  if(managed){
   // Preserve the existing actor/deadline checks above. Canonical projection
   // changes only this registration and invalidates any locked selected pool.
   // It cannot auto-promote, reopen signup, or surrender permanent ownership.
   const options={uid,now,mutationType:local?'onsite_waitlist_staff_cancel_local':intent==='player'?'onsite_waitlist_self_cancel':'onsite_waitlist_staff_cancel'};
   const projected=local ? projectManagedLocalCancellation(t,pub,rows.map(({ref,...r})=>r),localId,options) :
    projectManagedCancellation(t,pub,rows.map(({ref,...r})=>r),registrationId,options);
   if(row)tx.update(row.ref,{status:'cancelled',cancelledAt:FieldValue.serverTimestamp(),cancelledBy:uid,updatedAt:FieldValue.serverTimestamp()});
   tx.update(tr,projected.private);
   tx.update(pr,projected.public);
   const result={ok:true,status:'cancelled',registrationId,localId,autoPromoted:false,promotedRegistrationId:'',promotedLocalId:'',promotedName:'',confirmedCount:projected.private.confirmedCount,waitlistCount:projected.private.waitlistCount,capacity:t.capacity,registrationChanges:row?[{registrationId,status:'cancelled'}]:[]};
   tx.create(op,{actorUid:uid,requestHash:hash,result,createdAt:now});
   return {...result,state:parse(projected.private.data)};
  }
  if(local)s.players=s.players.filter(p=>p!==local);
  if(row)row.status='cancelled';
  reconcile(s,rows,quick,code);
  let promoted=null;
  const capacity=quick?quick.capacity:Number(t.capacity??s.meta.registrationCapacity??0);
  const participantCount=()=>quick?quickParticipants(s,rows).count:s.players.length;
  if(!pendingBracket&&oldStatus==='confirmed'&&s.meta.registrationAutoFillEnabled===true&&(capacity===null||!capacity||participantCount()<capacity)){
   const queue=rows.filter(r=>r.status==='waitlist').sort((a,b)=>epoch(a.createdAt)-epoch(b.createdAt)||a.registrationId.localeCompare(b.registrationId));
   if(queue.length){promoted=queue[0];promoted.status='confirmed';reconcile(s,rows,quick,code);}
   else{
    const waiting=(s.waitlistPlayers||[]).filter(p=>p.source!=='online'&&!p.registrationId).sort((a,b)=>(Number(a.waitRank)||0)-(Number(b.waitRank)||0)||epoch(a.waitlistedAt)-epoch(b.waitlistedAt)||String(a.id).localeCompare(String(b.id)));
    if(waiting.length){const candidate=waiting[0];s.waitlistPlayers=s.waitlistPlayers.filter(p=>p.id!==candidate.id);const p={...candidate};delete p.waitRank;delete p.waitlistedAt;s.players.push(p);promoted={localId:p.id,name:p.name};}
   }
  }
  const confirmed=rows.filter(r=>r.status==='confirmed').length,waitlist=rows.filter(r=>r.status==='waitlist').length;
  s.registrationRosterRevision=Number(s.registrationRosterRevision||0)+1;s.updatedAt=now;
  let status=String(t.registrationStatus||pub.registrationStatus||s.meta.registrationStatus||'open');
  if(!pendingBracket&&status==='full'&&(capacity===null||!capacity||participantCount()<capacity))status='open';
  if(!pendingBracket&&['open','full'].includes(status)&&capacity>0&&participantCount()>=capacity)status='full';
  s.meta.registrationStatus=status;
  const participantPatch=quick?{communityParticipantCount:participantCount()}:{};
  if(quick)s.communityParticipantCount=participantPatch.communityParticipantCount;
  const patch={...participantPatch,confirmedCount:confirmed,waitlistCount:waitlist,registrationStatus:status,updatedAt:now,lastRegistrationMutationType:promoted?'cancel_auto_fill':'cancel',lastRegistrationMutationUid:registrationId||localId,lastRegistrationMutationBy:uid};
  if(row)tx.update(row.ref,{status:'cancelled',cancelledAt:FieldValue.serverTimestamp(),cancelledBy:uid,updatedAt:FieldValue.serverTimestamp()});
  if(promoted?.ref)tx.update(promoted.ref,{status:'confirmed',promotedAt:FieldValue.serverTimestamp(),promotedBy:'system:auto-fill',updatedAt:FieldValue.serverTimestamp()});
  tx.update(tr,{...patch,data:JSON.stringify(s)});
  tx.update(pr,{...patch,bracketView:publicMirror(pub,s,{},quick)});
  const result={ok:true,status:'cancelled',registrationId,localId,autoPromoted:!!promoted,promotedRegistrationId:promoted?.registrationId||'',promotedLocalId:promoted?.localId||'',promotedName:promoted?.displayName||promoted?.publicName||promoted?.realName||promoted?.name||'',confirmedCount:confirmed,waitlistCount:waitlist,capacity,registrationChanges:rows.filter(r=>r.registrationId===registrationId||r.registrationId===promoted?.registrationId).map(r=>({registrationId:r.registrationId,status:r.status}))};
  tx.create(op,{actorUid:uid,requestHash:hash,result,createdAt:now});
  return {...result,state:s};
 });
 // Player cancellations return only the cancellation outcome; private runtime
 // and other participants' registration identifiers remain manager-only.
 if(intent==='player')return {ok:response.ok,status:response.status,registrationId:response.registrationId,autoPromoted:response.autoPromoted,promotedName:response.promotedName||'',alreadyCancelled:response.alreadyCancelled===true,replayed:response.replayed===true};
 return response;
};}
module.exports={createRosterService,manager,promotionManager,mutable,reconcile};
