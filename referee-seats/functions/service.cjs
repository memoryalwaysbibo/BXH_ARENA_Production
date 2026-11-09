'use strict';
const {createHash,randomUUID,randomBytes}=require('node:crypto');
const C=require('./core.cjs');
const {activeAccount}=require('./event-staff-core.cjs');
const {assertLegacyScoringWritable}=require('./bucket-legacy-fence.cjs');
async function renameCourt(db, code, uid, request, now) {
 const {station, name, expectedName} = request;
 if(!Number.isSafeInteger(station)||station<1||typeof name!=='string'||typeof expectedName!=='string'||
    name.length>32||expectedName.length>32||/[\u0000-\u001f\u007f]/.test(name))throw Error('invalid-court-name');
 const privateRef=db.doc('tournaments/'+code),publicRef=db.doc('publicTournaments/'+code);
 return db.runTransaction(async tx=>{
  const [privateSnap,publicSnap,profile]=await Promise.all([tx.get(privateRef),tx.get(publicRef),tx.get(db.doc('users/'+uid))]);
  if(!privateSnap.exists||!publicSnap.exists)throw Error('not-found');
  const room=privateSnap.data(),user=profile.data();
  if(!C.manager(room,user,uid,{now,communitySeatsEnabled:true,partnerEnabled:true}))throw Error('permission-denied');
  let state;
  try{state=JSON.parse(room.data);}catch{throw Error('corrupt-data');}
  const meta=state?.meta||{};
  const eventAuthority=room.eventAuthority||meta.eventAuthority||'official';
  const ladderMode=room.ladderMode||meta.ladderMode||'general';
  if(!['official','community'].includes(eventAuthority)||!['general','ranked'].includes(ladderMode)||
     (eventAuthority==='community'&&ladderMode!=='general')||room.tournamentPhase==='done'||
     state?.completedAt||meta.eventCancelled)throw Error('room-read-only');
  C.writable({...room,eventAuthority},{...state,meta:{...meta,eventAuthority:meta.eventAuthority||eventAuthority}},
    eventAuthority==='community');
  const count=Number(meta.stations);
  if(!Number.isSafeInteger(count)||station>count)throw Error('invalid-station');
  const saved=room.courtDisplayNames||{revision:0,names:{}};
  const nextName=name.trim(),oldName=saved.names?.[station]||'';
  if(oldName===nextName)return {ok:true,courtDisplayNames:saved};
  if(expectedName!==oldName)throw Error('court-name-stale');
  const names={...saved.names};
  if(nextName)names[station]=nextName;
  else delete names[station];
  const courtDisplayNames={revision:Number(saved.revision||0)+1,names};
  tx.update(privateRef,{courtDisplayNames});
  tx.update(publicRef,{courtDisplayNames});
  return {ok:true,courtDisplayNames};
 });
}

function createHandler(db,{clock=Date.now,uuid=randomUUID}={}){return async request=>{
 const uid=request.auth?.uid,d={...request.data},code=String(d.code||'').trim().toUpperCase();
 if(!uid)throw new Error('unauthenticated');
 if(d.action==='rename-court'){
  if(!/^BXH-[A-Z0-9]{4,16}$/.test(code))throw Error('invalid-request');
  return renameCourt(db,code,uid,d,clock());
 }
 if(['invite-mail-list','invite-mail-read'].includes(d.action)){
  const actor=await db.doc('users/'+uid).get();
  if(!activeAccount(actor.data()))throw Error('permission-denied');
  const inbox=db.doc('users/'+uid).collection('communityRefereeInbox');
  if(d.action==='invite-mail-list'){
   const rows=await inbox.orderBy('createdAt','desc').limit(50).get();
   return {ok:true,messages:rows.docs.map(row=>({...row.data(),id:row.id}))};
  }
  if(typeof d.messageId!=='string'||!/^ref-invite-[a-zA-Z0-9-]{1,80}$/.test(d.messageId))throw Error('invalid-request');
  await inbox.doc(d.messageId).update({readAt:d.unread===true?null:clock()});
  return {ok:true};
 }
 if(!/^BXH-[A-Z0-9]{4,16}$/.test(code)||!/^[-a-zA-Z0-9]{16,80}$/.test(d.operationId||''))throw new Error('invalid-request');
 const id=uuid(),qrToken=randomBytes(32).toString('base64url'),ref=db.doc('tournaments/'+code),pub=db.doc('publicTournaments/'+code);
 const operationRef=ref.collection('refereeSeatOperations').doc(createHash('sha256').update(uid+':'+d.operationId).digest('hex'));
 return db.runTransaction(async tx=>{
  const d={...request.data};
  const now=clock();
  const [roomSnap,publicSnap,userSnap,receiptSnap,releaseSnap]=await Promise.all([tx.get(ref),tx.get(pub),tx.get(db.doc('users/'+uid)),tx.get(operationRef),tx.get(db.doc('systemConfig/refereeSeatsV1'))]);
  if(releaseSnap.data()?.enabled!==true||releaseSnap.data()?.perCourtScoringVerified!==true)throw new Error('release-not-ready');
  if(!roomSnap.exists||!publicSnap.exists)throw new Error('not-found');
  const room=roomSnap.data(),user=userSnap.data();
  assertLegacyScoringWritable(room);
  const authority={now,communitySeatsEnabled:releaseSnap.data()?.communitySeatsEnabled===true,partnerEnabled:releaseSnap.data()?.partnerSeatsEnabled===true};
  if(C.partnerRoom(room)){
   if(!authority.partnerEnabled)throw Error('partner-release-not-ready');
   const parent=await tx.get(db.doc('users/'+room.createdBy));
   authority.parentUser=parent.data();
  }

  let state;try{state=JSON.parse(room.data);}catch{throw new Error('corrupt-data');}
  const qrAction=['inspect-qr','accept-qr'].includes(d.action);
  if(['accept-invite','create-qr','find-invite-player', 'inspect-qr','accept-qr'].includes(d.action)&&room.eventAuthority==='community'
   &&(room.tournamentPhase==='done'||state.completedAt||[room.archiveStatus,state.archiveStatus].some(status=>['completed','archived'].includes(status))))
   throw Error('community-result-available');
  if(d.action==='find-invite-player'){
   if(!C.canEnableCommunity(room,state,user,uid,{action:'enable'},authority))throw Error('permission-denied');
   // Reuse all room/mode/seat fences before querying the private player directory.
   C.transition({room,state,user,uid,d:{action:'create-qr',station:d.station,slot:d.slot,expectedCourtRevision:d.expectedCourtRevision,tokenHash:'search-only'},now,id,authority});
   const query=typeof d.query==='string'?d.query.trim():'';
   if(query.length<1||query.length>80)throw Error('invalid-request');
   const rows=new Map();
   for(const field of ['realName','displayName','gameId']){
    const found=await tx.get(db.collection('users').where(field,'==',query).limit(6));
    for(const row of found.docs){const player=row.data();if(row.id!==uid&&activeAccount(player)&&player.role==='player')rows.set(row.id,{uid:row.id,name:String(player.realName||player.displayName||player.gameId||'玩家').slice(0,80),gameId:String(player.gameId||'').slice(0,80)});}
   }
   return {ok:true,players:[...rows.values()].slice(0,10)};
  }
  let qrOwner;
  if(qrAction){
   if(typeof d.qrToken!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(d.qrToken)||typeof d.requestId!=='string')throw Error('invalid-qr');
   d.tokenHash=createHash('sha256').update(d.qrToken).digest('hex');
   const invitation=room.refereeSeatsV1?.requests?.[d.requestId];
   if(!C.communityRoom(room,authority)||!activeAccount(user)||user.role!=='player')throw Error('permission-denied');
   if(!invitation||invitation.kind!=='qr'||invitation.tokenHash!==d.tokenHash)throw Error('invalid-qr');
   qrOwner=(await tx.get(db.doc('users/'+invitation.fromUid))).data();
   if(!C.communityOwner(room,qrOwner,invitation.fromUid,authority))throw Error('permission-denied');
   d.station=invitation.station;d.slot=invitation.slot;
   // A receipt can be replayed only while this player still holds this QR's seat.
   if(receiptSnap.exists&&d.action==='accept-qr'){
    if(invitation.toUid!==uid||room.refereeSeatsV1.courts[d.station]?.[d.slot]?.uid!==uid)throw Error('qr-expired');
   }else{
    C.transition({room,state,user,uid,d:{...d,action:'accept-qr'},now,id,requesterUser:qrOwner,authority});
    if(d.action==='inspect-qr')return {ok:true,station:d.station,slot:d.slot,expiresAt:invitation.expiresAt,ownerName:String(qrOwner.gameId||qrOwner.displayName||'房主').slice(0,80)};
   }
  }
  const communityReceipt=(['invite','create-qr','revoke'].includes(d.action)&&C.communityOwner(room,user,uid,authority))
   ||qrAction
   ||(d.action==='accept-invite'&&C.communityRoom(room,authority)&&activeAccount(user)
    &&user.role==='player'&&room.refereeSeatsV1?.requests?.[d.requestId]?.toUid===uid);
  if(receiptSnap.exists&&!communityReceipt&&!C.eligible(room,user,uid,authority)&&!C.canEnableCommunity(room,state,user,uid,d,authority))throw new Error('not-event-staff');
  // Hash the original client intent, independent of resolved UID/seat or generated token.
  const hash=createHash('sha256').update(JSON.stringify(request.data)).digest('hex');
  if(receiptSnap.exists){const receipt=receiptSnap.data();if(receipt.hash!==hash)throw new Error('operation-conflict');return receipt.result;}
  let targetUser,requesterUser=qrOwner;
  const targetUid=room.refereeSeatsV1?.courts?.[d.station]?.[d.slot]?.uid;
  const requesterUid=room.refereeSeatsV1?.requests?.[d.requestId]?.fromUid;
  if(d.action==='invite'&&typeof d.targetUid==='string'&&/^[a-zA-Z0-9_-]{1,128}$/.test(d.targetUid))targetUser=(await tx.get(db.doc('users/'+d.targetUid))).data();
  if(d.action==='request'&&targetUid)targetUser=(await tx.get(db.doc('users/'+targetUid))).data();
  if(['respond','accept-invite'].includes(d.action)&&requesterUid)requesterUser=(await tx.get(db.doc('users/'+requesterUid))).data();
  if(d.action==='invite'&&typeof d.targetGameId==='string'&&!d.targetUid){
   if(!C.canEnableCommunity(room,state,user,uid,{action:'enable'},authority))throw Error('permission-denied');
   const gameId=d.targetGameId.trim();
   if(!gameId||gameId.length>80)throw Error('target-ineligible');
   const targets=await tx.get(db.collection('users').where('gameId','==',gameId).limit(2));
   if(targets.size!==1)throw Error('target-ineligible');
   targetUser=targets.docs[0].data();
   d.targetUid=targets.docs[0].id;
  }
  if(d.action==='create-qr')d.tokenHash=createHash('sha256').update(qrToken).digest('hex');
  const out=C.transition({room,state,user,uid,d,now,id,targetUser,requesterUser,authority});
  if(d.action==='create-qr')Object.assign(out.result,{qrToken,expiresAt:now+300000});
  const projection=C.project(out.model,room.createdBy,state.meta.stations),staff=room.eventAuthority==='community'?(room.assignedStaffUids||[]):[...new Set([...(room.assignedStaffUids||[]),room.createdBy,...projection.refereeStationUids].filter(Boolean))];
  state.meta={...state.meta,...projection,assignedStaffUids:staff,refereeSeatsV1:out.model};
  const updatedAt=Math.max(now,Number(room.updatedAt||0)+1,Number(state.updatedAt||0)+1);state.updatedAt=updatedAt;
  let mirror;try{mirror=JSON.parse(publicSnap.data().bracketView);}catch{throw new Error('public-mirror-missing');}
  // Public data contains display names only, never seat UID or private requests.
  mirror.meta={...mirror.meta,refereeStationNames:projection.refereeStationNames,refereeStationRestrictionEnabled:true,refereeSeatNames:projection.refereeSeatNames};
  delete mirror.meta.refereeSeatsV1;delete mirror.meta.refereeStationUids;delete mirror.meta.refereeStationAssignments;delete mirror.meta.assignedStaffUids;
  mirror.updatedAt=updatedAt;
  tx.update(ref,{refereeSeatsV1:out.model,...projection,assignedStaffUids:staff,data:JSON.stringify(state),updatedAt});
  tx.update(pub,{bracketView:JSON.stringify(mirror),updatedAt});
  if(d.action==='invite'){
   const invite=out.model.requests[id];
   tx.create(db.doc('users/'+invite.toUid).collection('communityRefereeInbox').doc('ref-invite-'+id),{
    type:'community_referee_invitation',eventCode:code,requestId:id,station:invite.station,slot:invite.slot,
    subject:'裁判邀請',body:code+'｜'+invite.station+' 號台 '+C.LABELS[invite.slot],
    senderName:String(user.gameId||user.displayName||'房主').slice(0,80),
    createdAt:now,readAt:null,refereeInviteStatus:'pending'
   });
  }
  if(d.action==='accept-invite'){
   tx.set(db.doc('users/'+uid).collection('communityRefereeInbox').doc('ref-invite-'+d.requestId),
    {refereeInviteStatus:'accepted',readAt:now},{merge:true});
  }
  tx.create(operationRef,{uid,hash,at:now,result:out.result});
  tx.create(ref.collection('refereeSeatAudit').doc(id),{uid,at:now,action:d.action,station:d.station||null,slot:d.slot||null,requestId:d.requestId||out.result.requestId||null,response:d.response||null,previousUid:targetUid||null,revision:out.model.revision});
  return out.result;
 });
};}
module.exports={createHandler};
