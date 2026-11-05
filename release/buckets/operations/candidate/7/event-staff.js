'use strict';
const {onCall,HttpsError}=require('firebase-functions/v2/https');
const {getFirestore,FieldValue}=require("./_qr_checkin/admin-firestore.cjs");
const {createHash}=require('node:crypto');
const C=require('./event-staff-core');

const db=getFirestore();
const fail=(status,code)=>{throw new HttpsError(status,code);};
const assignmentId=(code,uid)=>createHash('sha256').update(`${code}|${uid}`).digest('hex');
const mailId=(code,uid)=>`event_staff_${createHash('sha256').update(`${code}|${uid}`).digest('hex').slice(0,40)}`;
const activeProfile=data=>C.activeAccount(data);
function publicAssignment(value){
  return {eventCode:value.eventCode,targetUid:value.targetUid,organizerUid:value.organizerUid,
    organizationId:value.organizationId,displayName:value.displayName||'',duties:value.duties||[],status:value.status,
    invitedAt:value.invitedAt||null,respondedAt:value.respondedAt||null,revokedAt:value.revokedAt||null,
    eventName:value.eventName||'',effective:value.effective===true};
}
function mapError(error){
  if(error instanceof HttpsError)throw error;
  const code=String(error&&error.message||error);
  const denied=['organizer-access-denied','transition-forbidden','account-inactive'];
  const precondition=['event-not-found','event-completed','assignment-not-found','recipient-inactive','cannot-invite-self','bucket-scoring-required','room-generation-changed','room-identity-missing'];
  if(denied.includes(code))fail('permission-denied',code);
  if(precondition.includes(code))fail('failed-precondition',code);
  if(code.startsWith('invalid-'))fail('invalid-argument',code);
  throw error;
}
const owns=(o,k)=>!!o&&Object.prototype.hasOwnProperty.call(o,k);
// Staff assignments change metadata only. Validate both score owners before any
// write and remember the physical room/epoch across Firestore transaction retries.
function staffRoomContext(parent,pub){
 const t=parent.data()||{},p=pub.data()||{};
 if([t,p].some(x=>owns(x,'bucketMigration')||owns(x,'deletionStatus')))throw Error('bucket-scoring-required');
 const privateMarked=owns(t,'scoreStorage'),publicMarked=owns(p,'scoreBucketProjection');
 if(!privateMarked&&!publicMarked){
  if(owns(t,'scoreBucketProjection')||owns(p,'scoreStorage'))throw Error('bucket-scoring-required');
  return 'legacy';
 }
 if(!privateMarked||!publicMarked||!pub.exists||owns(t,'scoreBucketProjection')||owns(p,'scoreStorage'))throw Error('bucket-scoring-required');
 let s;try{s=JSON.parse(t.data);}catch{throw Error('bucket-scoring-required');}
 const m=t.scoreStorage,v=p.scoreBucketProjection,count=Number(s?.meta?.stations);
 if(m?.schema!=='bxh-match-buckets-v1'||m.status!=='active'||typeof m.epoch!=='string'||!m.epoch||typeof m.roomId!=='string'||!m.roomId||m.code!==parent.id||s.id!==m.roomId||s.cloudCode!==m.code||!Number.isSafeInteger(count)||count<1||count>32||m.courtCount!==count||m.bucketCount!==Math.ceil(count/4)||v?.epoch!==m.epoch||!v.versions||Object.keys(v.versions).length!==m.bucketCount||Array.from({length:m.bucketCount},(_,i)=>v.versions['court-'+(i+1)]).some(x=>!Number.isSafeInteger(x)||x<0))throw Error('bucket-scoring-required');
 return JSON.stringify(['bucket',m.roomId,m.epoch,m.courtCount,m.bucketCount]);
}
function created(snapshot){
 const time=snapshot?.createTime;
 if(!snapshot?.exists||!Number.isSafeInteger(time?.seconds)||!Number.isSafeInteger(time?.nanoseconds))throw Error('room-identity-missing');
 return {seconds:time.seconds,nanoseconds:time.nanoseconds};
}
const identity=snapshot=>{const time=created(snapshot);return time.seconds+':'+time.nanoseconds;};
const precedes=(a,b)=>a.seconds<b.seconds||a.seconds===b.seconds&&a.nanoseconds<b.nanoseconds;
function assertChildRoom(parent,child){
 if(!child.exists)return;
 const data=child.data();
 if(owns(data,'sourceCreatedAt')){if(data.sourceCreatedAt!==identity(parent))throw Error('room-generation-changed');}
 else if(precedes(created(child),created(parent)))throw Error('room-generation-changed');
}
function assertRoom(parent,pub,observed){
 if(!parent.exists)throw Error('event-not-found');
 const context=staffRoomContext(parent,pub);
 const id=identity(parent);
 if(observed&&observed.id!==undefined&&(observed.id!==id||observed.context!==context))throw Error('room-generation-changed');
 if(observed){observed.id=id;observed.context=context;}
 return id;
}
async function loadOrganizerEvent(uid,eventCode,tx=null,observed=null){
  const code=C.normalizeEventCode(eventCode),actorRef=db.doc(`users/${uid}`),eventRef=db.doc(`tournaments/${code}`);
  const read=ref=>tx?tx.get(ref):ref.get();
  const [actor,event,pub]=await Promise.all([read(actorRef),read(eventRef),...(tx?[read(db.doc(`publicTournaments/${code}`))]:[])]);
  if(tx)assertRoom(event,pub,observed);
  if(!event.exists)throw Error('event-not-found');
  const eventData=event.data()||{};
  if(!C.ownsEvent({...actor.data(),uid},uid,eventData))throw Error('organizer-access-denied');
  if(eventData.archiveStatus==='completed'||eventData.tournamentPhase==='done')throw Error('event-completed');
  return {code,actorRef,eventRef,event,actor:actor.data()||{},eventData};
}

async function invite(uid,data){
  const code=C.normalizeEventCode(data.eventCode),targetUid=C.normalizeUid(data.targetUid),duties=C.normalizeDuties(data.duties);
  const id=assignmentId(code,targetUid),messageId=mailId(code,targetUid),now=Date.now(),observed={};
  return db.runTransaction(async tx=>{
    const base=await loadOrganizerEvent(uid,code,tx,observed);
    const targetRef=db.doc(`users/${targetUid}`),assignmentRef=db.doc(`eventStaffAssignments/${id}`);
    const statsRef=db.doc(`mailboxStats/${targetUid}`),messageRef=db.doc(`userMail/${targetUid}/messages/${messageId}`);
    const [target,prior,stats,message]=await Promise.all([tx.get(targetRef),tx.get(assignmentRef),tx.get(statsRef),tx.get(messageRef)]);
    const targetData=target.data()||{};
    if(!target.exists||!activeProfile(targetData))throw Error('recipient-inactive');
    const displayName=targetData.displayName||targetData.gameId||targetData.realName||targetUid;
    const invitation={...C.makeInvitation({eventCode:code,targetUid,organizerUid:uid,organizerProfile:{...base.actor,uid},
      tournament:base.eventData,duties,displayName,now}),sourceCreatedAt:identity(base.event),eventName:base.eventData.name||base.eventData.eventName||'BXH 活動'};
    const assignments={...(base.eventData.eventStaffAssignments||{}),[targetUid]:invitation};
    const memberships={...(targetData.eventStaffMemberships||{}),[code]:{
      eventCode:code,eventName:invitation.eventName,organizerUid:uid,organizationId:invitation.organizationId,
      parentFingerprint:invitation.parentFingerprint,duties,status:'invited',invitedAt:now,updatedAt:now}};
    tx.set(base.eventRef,{eventStaffAssignments:assignments,updatedAt:now},{merge:true});
    tx.set(assignmentRef,{...invitation,assignmentId:id,history:FieldValue.arrayUnion({action:prior.exists?'reinvited':'invited',by:uid,at:now})},{merge:true});
    tx.set(targetRef,{eventStaffMemberships:memberships},{merge:true});
    tx.set(messageRef,{subject:`工作人員（活動）邀請｜${invitation.eventName}`,body:`${base.actor.partnerOrganizer.organizationName||'活動主辦'} 邀請您擔任「${invitation.eventName}」的工作人員（活動）。請於本信件確認接受或拒絕。`,
      type:'activity',senderName:base.actor.partnerOrganizer.organizationName||'活動主辦',senderUid:uid,eventCode:code,
      invitationStatus:'invited',assignmentId:id,createdAt:message.exists?(message.data().createdAt||now):now,updatedAt:now,readAt:null},{merge:true});
    if(!message.exists)tx.set(statsRef,{unreadCount:Math.max(0,Number(stats.data()?.unreadCount)||0)+1,updatedAt:now},{merge:true});
    return {ok:true,assignment:publicAssignment(invitation),reinvited:prior.exists};
  });
}

async function respond(uid,data){
  const code=C.normalizeEventCode(data.eventCode),action=data.response==='accept'?'accept':data.response==='reject'?'reject':null;
  if(!action)fail('invalid-argument','invalid-response');
  const id=assignmentId(code,uid),now=Date.now(),observed={};
  return db.runTransaction(async tx=>{
    const userRef=db.doc(`users/${uid}`),eventRef=db.doc(`tournaments/${code}`),assignmentRef=db.doc(`eventStaffAssignments/${id}`);
    const [user,event,assignment,pub]=await Promise.all([tx.get(userRef),tx.get(eventRef),tx.get(assignmentRef),tx.get(db.doc(`publicTournaments/${code}`))]);
    if(!user.exists||!activeProfile(user.data()))throw Error('account-inactive');
    assertRoom(event,pub,observed);
    if(assignment.exists)assertChildRoom(event,assignment);
    if(!assignment.exists)throw Error('assignment-not-found');
    if(!event.exists)throw Error('event-not-found');
    const current=assignment.data(),organizerRef=db.doc(`users/${current.organizerUid}`),organizer=await tx.get(organizerRef);
    if(action==='accept'&&!C.ownsEvent({...organizer.data(),uid:current.organizerUid},current.organizerUid,event.data(),now))throw Error('organizer-access-denied');
    const next=C.transition(current,action,uid,now),eventAssignments={...(event.data().eventStaffAssignments||{}),[uid]:next};
    const memberships={...(user.data()?.eventStaffMemberships||{}),[code]:{
      ...((user.data()?.eventStaffMemberships||{})[code]||{}),status:next.status,respondedAt:now,updatedAt:now}};
    tx.set(eventRef,{eventStaffAssignments:eventAssignments,updatedAt:now},{merge:true});
    tx.set(assignmentRef,{...next,history:FieldValue.arrayUnion({action:next.status,by:uid,at:now})},{merge:true});
    tx.set(userRef,{eventStaffMemberships:memberships},{merge:true});
    tx.set(db.doc(`userMail/${uid}/messages/${mailId(code,uid)}`),{invitationStatus:next.status,updatedAt:now},{merge:true});
    return {ok:true,assignment:publicAssignment(next)};
  });
}

async function revoke(uid,data){
  const code=C.normalizeEventCode(data.eventCode),targetUid=C.normalizeUid(data.targetUid),id=assignmentId(code,targetUid),now=Date.now(),observed={};
  return db.runTransaction(async tx=>{
    const base=await loadOrganizerEvent(uid,code,tx,observed),assignmentRef=db.doc(`eventStaffAssignments/${id}`),targetRef=db.doc(`users/${targetUid}`);
    const [assignment,target]=await Promise.all([tx.get(assignmentRef),tx.get(targetRef)]);
    if(!assignment.exists)throw Error('assignment-not-found');
    assertChildRoom(base.event,assignment);
    const next=C.transition(assignment.data(),'revoke',uid,now),eventAssignments={...(base.eventData.eventStaffAssignments||{}),[targetUid]:next};
    const memberships={...(target.data()?.eventStaffMemberships||{}),[code]:{
      ...((target.data()?.eventStaffMemberships||{})[code]||{}),status:'revoked',revokedAt:now,updatedAt:now}};
    tx.set(base.eventRef,{eventStaffAssignments:eventAssignments,updatedAt:now},{merge:true});
    tx.set(assignmentRef,{...next,history:FieldValue.arrayUnion({action:'revoked',by:uid,at:now})},{merge:true});
    tx.set(targetRef,{eventStaffMemberships:memberships},{merge:true});
    tx.set(db.doc(`userMail/${targetUid}/messages/${mailId(code,targetUid)}`),{invitationStatus:'revoked',updatedAt:now},{merge:true});
    return {ok:true,assignment:publicAssignment(next)};
  });
}

async function listForEvent(uid,data){
  const base=await loadOrganizerEvent(uid,data.eventCode);
  return {ok:true,eventCode:base.code,assignments:Object.values(base.eventData.eventStaffAssignments||{}).map(publicAssignment)};
}
async function listMine(uid){
  const user=await db.doc(`users/${uid}`).get(),profile={...user.data(),uid};
  if(!activeProfile(profile))throw Error('account-inactive');
  const memberships=profile.eventStaffMemberships||{},codes=Object.keys(memberships).slice(0,50);
  const events=await Promise.all(codes.map(code=>db.doc(`tournaments/${code}`).get()));
  const organizerIds=[...new Set(events.filter(s=>s.exists).map(s=>s.data().createdBy).filter(Boolean))];
  const organizers=organizerIds.length?await db.getAll(...organizerIds.map(id=>db.doc(`users/${id}`))):[];
  const byId=Object.fromEntries(organizers.map(s=>[s.id,{...s.data(),uid:s.id}]));
  const assignments=[];
  events.forEach((snap,index)=>{
    if(!snap.exists)return;
    const code=codes[index],value=(snap.data().eventStaffAssignments||{})[uid];
    if(!value)return;
    assignments.push(publicAssignment({...value,eventName:value.eventName||snap.data().name||'',effective:C.effective(value,profile,byId[value.organizerUid],snap.data())}));
  });
  return {ok:true,assignments};
}
async function searchPlayers(uid,data){
  await loadOrganizerEvent(uid,data.eventCode);
  const query=String(data.query||'').normalize('NFKC').trim().toLowerCase();
  if(query.length<2||query.length>60)fail('invalid-argument','invalid-query');
  const rows=await db.collection('users').where('active','==',true).limit(500).get();
  return {ok:true,players:rows.docs.filter(doc=>{
    const value=doc.data()||{};if(!activeProfile(value)||doc.id===uid)return false;
    return [value.displayName,value.gameId,value.realName].some(v=>String(v||'').toLowerCase().includes(query));
  }).slice(0,20).map(doc=>({uid:doc.id,displayName:doc.data().displayName||doc.data().gameId||doc.data().realName||'玩家',gameId:doc.data().gameId||''}))};
}

exports.eventStaffService=onCall({region:'asia-east1',cors:true,maxInstances:10},async request=>{
  if(process.env.GCLOUD_PROJECT!=='bxh-arena')fail('failed-precondition','production-only');
  const uid=request.auth?.uid;if(!uid)fail('unauthenticated','auth-required');
  const data=request.data||{},action=String(data.action||'listMine');
  try{
    if(action==='invite')return await invite(uid,data);
    if(action==='respond')return await respond(uid,data);
    if(action==='revoke')return await revoke(uid,data);
    if(action==='listForEvent')return await listForEvent(uid,data);
    if(action==='listMine')return await listMine(uid);
    if(action==='searchPlayers')return await searchPlayers(uid,data);
    fail('invalid-argument','invalid-action');
  }catch(error){mapError(error);}
});

exports._private={assignmentId,mailId,invite,respond,revoke,listForEvent,listMine,searchPlayers};
