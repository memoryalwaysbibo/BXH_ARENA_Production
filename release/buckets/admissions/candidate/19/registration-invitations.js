'use strict';
const {FieldValue}=require("./_qr_checkin/admin-firestore.cjs");
const Onsite=require('./onsite-waitlist-writer-guards');
const {ordinaryInvitationAdmission}=require('./invitation-admission-policy');
const active=p=>p?.active===true&&!p.deleted&&!['deleted','disabled','frozen'].includes(p.accountStatus);
const ms=x=>x?.toMillis?x.toMillis():Number(x)||0;
const clean=s=>String(s||'').trim();
const codeOf=s=>clean(s).toUpperCase();
const has=(o,k)=>!!o&&Object.prototype.hasOwnProperty.call(o,k);
function roomData(snapshot,publicSnapshot){
 if(!snapshot.exists)throw Error('not-found');
 const t=snapshot.data(),p=publicSnapshot.data();
 if([t,p].some(x=>x&&['scoreStorage','scoreBucketProjection','bucketMigration','deletionStatus'].some(k=>has(x,k))))throw Error('bucket-scoring-required');
 return t;
}
function creation(snapshot){
 const time=snapshot.createTime;
 if(!snapshot.exists||!Number.isSafeInteger(time?.seconds)||!Number.isSafeInteger(time?.nanoseconds))throw Error('invitation-room-identity-missing');
 return {seconds:time.seconds,nanoseconds:time.nanoseconds};
}
const identity=snapshot=>{const t=creation(snapshot);return t.seconds+':'+t.nanoseconds;};
function assertInvitationRoom(room,invitation){
 const inv=invitation.data();
 if(has(inv,'sourceCreatedAt')){if(inv.sourceCreatedAt!==identity(room))throw Error('invitation-room-changed');return;}
 // Legacy invitations have no generation field. Their trusted SDK creation
 // timestamp must not predate the current parent; no client timestamp is trusted.
 const r=creation(room),i=creation(invitation);
 if(i.seconds<r.seconds||i.seconds===r.seconds&&i.nanoseconds<r.nanoseconds)throw Error('invitation-room-changed');
}
function createRegistrationInvitationService(db,clock=Date.now){return async req=>{
 const uid=req.auth?.uid,d=req.data||{},now=clock();if(!uid)throw Error('auth-required');
 const actorSnap=await db.doc('users/'+uid).get(),actor=actorSnap.data();if(!active(actor))throw Error('auth-required');
 if(d.action==='search'){
  const code=codeOf(d.code),term=clean(d.term);if(!/^BXH-[A-Z0-9]{4,16}$/.test(code))throw Error('invalid-code');if(term.length<2||term.length>60)throw Error('invalid-search');
  const ts=await db.doc('tournaments/'+code).get();if(!ts.exists)throw Error('not-found');const t=ts.data(),manager=['staff','admin','super_admin','tester'].includes(actor.role)||t.ownerUid===uid||t.createdBy===uid;if(!manager)throw Error('permission-denied');if(t.systemClosed||t.eventCancelled||t.tournamentPhase!=='waiting')throw Error('tournament-started');
  let q=await db.collection('users').where('playerId','==',term).limit(3).get();
  if(q.empty)q=await db.collection('users').where('gameId','==',term).limit(3).get();
  if(q.empty)q=await db.collection('users').where('realName','==',term).limit(3).get();
  return {ok:true,rows:q.docs.filter(x=>active(x.data())).slice(0,3).map(x=>({uid:x.id,playerId:x.data().playerId||'',displayName:x.data().gameId||x.data().nickname||x.data().realName||'玩家'}))};
 }
 if(d.action==='mine'){
  const q=await db.collectionGroup('registrationInvitations').where('targetUid','==',uid).where('status','==','pending').limit(20).get(),rows=[];
  for(const x of q.docs){const v=x.data();if(ms(v.expiresAt)<=now)continue;rows.push({...v,id:x.id,expiresAt:ms(v.expiresAt),createdAt:ms(v.createdAt)});}
  return {ok:true,rows:rows.sort((a,b)=>b.createdAt-a.createdAt)};
 }
 if(d.action==='sent'){
  const code=codeOf(d.code);if(!/^BXH-[A-Z0-9]{4,16}$/.test(code))throw Error('invalid-code');const ts=await db.doc('tournaments/'+code).get();if(!ts.exists)throw Error('not-found');const t=ts.data(),manager=['staff','admin','super_admin','tester'].includes(actor.role)||t.ownerUid===uid||t.createdBy===uid;if(!manager)throw Error('permission-denied');const q=await db.collection('tournaments/'+code+'/registrationInvitations').limit(50).get();return {ok:true,rows:q.docs.map(x=>({...x.data(),id:x.id,expiresAt:ms(x.data().expiresAt),createdAt:ms(x.data().createdAt)})).sort((a,b)=>b.createdAt-a.createdAt)};
 }
 const code=codeOf(d.code);if(!/^BXH-[A-Z0-9]{4,16}$/.test(code))throw Error('invalid-code');
 const tr=db.doc('tournaments/'+code),ir=tr.collection('registrationInvitations').doc(d.targetUid||uid),recipientMail=db.doc('userMail/'+uid+'/messages/tournament_invite_'+code);
 if(d.action==='invite'){
  const targetUid=clean(d.targetUid);if(!targetUid||targetUid===uid)throw Error('invalid-target');
  const observed=await tr.get();if(!observed.exists)throw Error('not-found');const sourceCreatedAt=identity(observed);
  const expiresAt=now+30*60*1000,mail=db.doc('userMail/'+targetUid+'/messages/tournament_invite_'+code),stats=db.doc('mailboxStats/'+targetUid);
  await db.runTransaction(async tx=>{
   const [fresh,pub,actorNow,targetNow,prior,reg,ss]=await tx.getAll(tr,db.doc('publicTournaments/'+code),db.doc('users/'+uid),db.doc('users/'+targetUid),ir,tr.collection('registrations').doc(targetUid),stats);
   const t=roomData(fresh,pub),currentActor=actorNow.data(),target=targetNow.data();
   if(identity(fresh)!==sourceCreatedAt)throw Error('invitation-room-changed');
   if(!active(currentActor))throw Error('auth-required');if(!active(target))throw Error('player-not-found');
   const manager=['staff','admin','super_admin','tester'].includes(currentActor.role)||t.ownerUid===uid||t.createdBy===uid;if(!manager)throw Error('permission-denied');
   if(t.systemClosed||t.eventCancelled||t.tournamentPhase!=='waiting')throw Error('tournament-started');
   if(prior.exists)assertInvitationRoom(fresh,prior);
   if(reg.exists&&['confirmed','waitlist'].includes(reg.data().status))throw Error('already-registered');
   if(prior.exists&&prior.data().status==='pending'&&ms(prior.data().expiresAt)>now)throw Error('invite-pending');
   const title=t.name||code,record={code,eventName:title,targetUid,targetName:target.gameId||target.nickname||target.realName||'玩家',targetPlayerId:target.playerId||'',invitedByUid:uid,invitedByName:currentActor.gameId||currentActor.nickname||currentActor.realName||'主辦',status:'pending',createdAt:now,updatedAt:now,expiresAt,sourceCreatedAt};
   tx.set(ir,record);tx.set(mail,{subject:'賽事參加邀請',body:(currentActor.gameId||currentActor.nickname||currentActor.realName||'主辦')+' 邀請你參加「'+title+'」。請進入 BXH ARENA 接受或拒絕。',type:'tournament_invitation',senderName:'BXH ARENA',senderUid:uid,createdAt:now,updatedAt:now,readAt:null,eventCode:code,invitationStatus:'pending'},{merge:true});
   tx.set(stats,{unreadCount:Math.max(0,Number(ss.data()?.unreadCount)||0)+1,updatedAt:now},{merge:true});
  });
  return {ok:true,status:'pending',expiresAt};
 }
 if(d.action==='respond'){
  const decision=d.decision==='accept'?'accepted':d.decision==='decline'?'declined':null;if(!decision)throw Error('invalid-decision');
  return db.runTransaction(async tx=>{const [is,ts,ps,us]=await Promise.all([tx.get(ir),tx.get(tr),tx.get(db.doc('publicTournaments/'+code)),tx.get(db.doc('users/'+uid))]);if(!active(us.data()))throw Error('auth-required');roomData(ts,ps);if(!is.exists||is.data().targetUid!==uid)throw Error('invite-not-found');assertInvitationRoom(ts,is);const inv=is.data();if(inv.status!=='pending'){return {ok:true,status:inv.status,replayed:true};}if(ms(inv.expiresAt)<=now){tx.update(ir,{status:'expired',updatedAt:now});tx.set(recipientMail,{invitationStatus:'expired',updatedAt:now,respondedAt:now},{merge:true});return {ok:true,status:'expired'};}if(decision==='declined'){tx.update(ir,{status:'declined',updatedAt:now,respondedAt:now});tx.set(recipientMail,{invitationStatus:'declined',updatedAt:now,respondedAt:now},{merge:true});return {ok:true,status:'declined'};}if(!ts.exists||!ps.exists)throw Error('not-found');const t=ts.data(),pub=ps.data();const onsiteOwned=Onsite.assertManagedInvitationOpen(t,pub);if(t.systemClosed||t.eventCancelled||t.tournamentPhase!=='waiting')throw Error('tournament-started');const rr=tr.collection('registrations').doc(uid),rs=await tx.get(rr);if(rs.exists&&['confirmed','waitlist'].includes(rs.data().status)){tx.update(ir,{status:'accepted',registrationStatus:rs.data().status,updatedAt:now,respondedAt:now});tx.set(recipientMail,{invitationStatus:rs.data().status,updatedAt:now,respondedAt:now},{merge:true});return {ok:true,status:rs.data().status,replayed:true};}
  // Resolve names from the current account and event inside the acceptance
  // transaction, never from the invitation snapshot or client payload.
  const currentActor=(await tx.get(db.doc('users/'+uid))).data();
  if(!active(currentActor))throw Error('auth-required');
  if(!clean(currentActor.realName)||typeof currentActor.phone!=='string'||!(currentActor.profileCompleted||['staff','admin','super_admin','tester'].includes(currentActor.role)))throw Error('profile-incomplete');
  const realName=currentActor.realName,gameId=currentActor.gameId||currentActor.nickname||'';
  const nameMode=t.participantNameMode==='gameId'?'gameId':'realName';
  const participantName=nameMode==='gameId'?(gameId||realName):realName;
  const managedRows=onsiteOwned?await Onsite.readManagedRows(tx,tr):null;
  const managedAdmission=onsiteOwned?Onsite.managedInvitationCapacity(t,pub,managedRows):null;
  let status='confirmed',field='confirmedCount';
  if(onsiteOwned){
   if(!managedAdmission.finalized || managedAdmission.acceptedCount>=managedAdmission.capacity || managedAdmission.waitlistCount>0){
    if(!t.waitlistEnabled||managedAdmission.waitlistCount>=Number(t.waitlistCapacity||0))throw Error('full');
    status='waitlist';field='waitlistCount';
   }
  }else{
   ({status,field}=ordinaryInvitationAdmission(t,pub));
  }
  const reg={uid,tournamentCode:code,realName,gameId,displayName:participantName,publicName:participantName,nameMode,phone:currentActor.phone||'',email:currentActor.email||null,status,source:'host_invitation',createdAt:FieldValue.serverTimestamp(),updatedAt:FieldValue.serverTimestamp(),cancelledAt:null,cancelledBy:null};if(onsiteOwned&&rs.data()?.onsiteWaitlistFreeze)reg.onsiteWaitlistFreeze=rs.data().onsiteWaitlistFreeze;const projection=onsiteOwned?Onsite.projectManagedInvitation(t,pub,managedRows,{...reg,registrationId:uid,createdAt:now,updatedAt:now},{uid,now,code}):null;tx.set(rr,reg);tx.update(tr,projection?.private||{[field]:FieldValue.increment(1),updatedAt:now});tx.update(db.doc('publicTournaments/'+code),projection?.public||{[field]:FieldValue.increment(1),updatedAt:now});tx.update(ir,{status:'accepted',registrationStatus:status,updatedAt:now,respondedAt:now});tx.set(recipientMail,{invitationStatus:status,updatedAt:now,respondedAt:now},{merge:true});return {ok:true,status};});
 }
 throw Error('invalid-operation');
};}
module.exports={createRegistrationInvitationService};
