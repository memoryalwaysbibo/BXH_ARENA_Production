'use strict';
const {onCall,HttpsError}=require('firebase-functions/v2/https');
const {defineSecret}=require('firebase-functions/params');
const {getFirestore,Timestamp}=require('firebase-admin/firestore');
const crypto=require('node:crypto');
const {transition,scanPlayer,digest,CheckinError}=require('./core.cjs');
const onsite=require('./onsite-context.cjs');
const signingKey=defineSecret('QR_CHECKIN_SIGNING_KEY');
function createCheckinHandler(db,secretValue){return async request=>{
  const uid=request.auth?.uid;
  if(!uid)throw new HttpsError('unauthenticated','auth-required');
  const d=request.data||{},code=String(d.code||'').trim().toUpperCase();
  if(!/^BXH-[A-Z0-9]{4,16}$/.test(code))throw new HttpsError('invalid-argument','invalid-code');
  const ref=db.doc('tournaments/'+code),pub=db.doc('publicTournaments/'+code);
  // This timestamp originates on the server and stays stable during retries.
  const now=Timestamp.now().toMillis(),session=crypto.randomUUID(),auditId=crypto.randomUUID();
  try{return await db.runTransaction(async tx=>{
    const [roomSnap,userSnap,cfgSnap,pubSnap]=await Promise.all([tx.get(ref),tx.get(db.doc('users/'+uid)),tx.get(db.doc('systemConfig/qrCheckin')),tx.get(pub)]);
    if(!roomSnap.exists||!pubSnap.exists)throw new CheckinError('room-missing');
    const room=roomSnap.data(),publicRoom=pubSnap.data();let state=JSON.parse(room.data||'{}');
    if(room.qrCheckinManaged===true){
      if(!Number.isSafeInteger(room.qrCheckinRevision)||room.qrCheckinRevision<1||publicRoom.qrCheckinManaged!==true||publicRoom.qrCheckinRevision!==room.qrCheckinRevision||state.qrCheckinRevision!==room.qrCheckinRevision)throw new CheckinError('checkin-state-stale');
    }else if(publicRoom.qrCheckinManaged===true||state.qrCheckinManaged===true)throw new CheckinError('checkin-state-stale');
    let player;
    if(d.action==='scan')player=scanPlayer(state.players,uid,d.playerId);
    else player=(state.players||[]).find(p=>p.id===d.playerId);
    const receiptRef=player?ref.collection('checkinReceipts').doc(digest(player.id)):null;
    const operationRef=typeof d.operationId==='string'?ref.collection('checkinOperations').doc(digest(uid+':'+d.operationId)):null;
    const registrationRef=player?.registrationId?ref.collection('registrations').doc(player.registrationId):null;
    const parentRef=room.eventStaffAssignments?.[uid]&&room.createdBy?db.doc('users/'+room.createdBy):null;
    const candidateRows=d.action==='candidates'?(state.players||[]).filter(p=>p&&(p.familyPlayerId?p.guardianUid===uid:!p.guardianUid&&[p.registrationUid,p.uid,p.accountUid].includes(uid))):[];
    const registrationIds=[...new Set(candidateRows.map(p=>p.registrationId).filter(Boolean))];
    if(registrationIds.some(id=>typeof id!=='string'||id.includes('/')))throw new CheckinError('not-confirmed');
    const [receiptSnap,operationSnap,registrationSnap,parentSnap,familySnap,...candidateSnaps]=await Promise.all([
      receiptRef?tx.get(receiptRef):null,operationRef?tx.get(operationRef):null,registrationRef?tx.get(registrationRef):null,parentRef?tx.get(parentRef):null,
      (d.action==='candidates'||d.action==='scan'&&player?.familyPlayerId)?tx.get(db.doc('familyPlayers/'+uid)):null,
      ...registrationIds.map(id=>tx.get(ref.collection('registrations').doc(id)))
    ]);
    const registrations=Object.fromEntries(registrationIds.map((id,i)=>[id,candidateSnaps[i]?.data()]));
    const familyProfiles=Array.isArray(familySnap?.data()?.profiles)?familySnap.data().profiles:[];
    const config=cfgSnap.data(),onsiteReady=room.onsiteWaitlistServerOwned===true&&config?.onsiteIntegrationVerified===true;
    const output=transition({code,uid,user:userSnap.data(),parentUser:parentSnap?.data(),room,state,registration:registrationSnap?.data(),registrations,familyProfiles,receipt:receiptSnap?.data(),operation:operationSnap?.data(),config,d,now,secret:secretValue(),newSession:session,onsiteReady});
    if(d.action==='history') {
      const history=await tx.get(ref.collection('checkinAudit').orderBy('at','desc').limit(100));
      return {ok:true,records:history.docs.map(s=>({...s.data(),at:s.data().at.toMillis()}))};
    }
    if(publicRoom.systemClosed===true||publicRoom.eventCancelled===true||publicRoom.deletionStatus||['completed','archived'].includes(publicRoom.archiveStatus)||['live','settling','done','cancelled'].includes(publicRoom.tournamentPhase)){
      if(d.action==='status')return {ok:true,enabled:false,token:null,expiresAt:null};
      throw new CheckinError('checkin-closed');
    }
    // Pure authorization above does not return a token or commit until the
    // existing draw aggregate and public mirror also pass their own checks.
    let aggregate=null;
    if(onsiteReady){
      aggregate=await onsite.read(tx,ref,room,publicRoom,userSnap.data());onsite.validate(aggregate);
    }
    const revision=Number(room.qrCheckinRevision||0)+1;
    if(!Number.isSafeInteger(revision))throw new CheckinError('revision-exhausted');
    if(output.settings) {
      let runtime={},mirror;
      if(aggregate){mirror=JSON.parse(publicRoom.bracketView);runtime=onsite.advanceRuntime(room,state,mirror);}
      state.qrCheckinManaged=true;
      state.qrCheckinRevision=revision;
      tx.update(ref,{...runtime,qrCheckin:output.settings,qrCheckinManaged:true,qrCheckinRevision:revision,data:JSON.stringify(state)});
      tx.update(pub,{...runtime,qrCheckinManaged:true,qrCheckinRevision:revision,...(mirror?{bracketView:JSON.stringify(mirror)}:{})});
    }
    if(output.receipt) {
      let privatePatch={},publicPatch={},drawCommit=null;
      if(aggregate&&room.onsiteWaitlistFinalized!==true){
        // This internal option is never copied from request.data. QR core has
        // already validated the caller and the exact confirmed target.
        const request={uid,data:{action:'checkIn',code,playerId:output.playerId,checkedIn:output.receipt.checkedIn,operationId:'qr-'+auditId,expectedRevision:room.onsiteWaitlistDraw.revision}};
        drawCommit=onsite.O.transition(aggregate,request,{now,authorizedCheckin:true}).commit;
        privatePatch=drawCommit.tournamentPatch;publicPatch=drawCommit.publicPatch;
        state=JSON.parse(privatePatch.data);
      }
      const p=state.players.find(p=>p.id===output.playerId),r=output.receipt;
      p.checkedIn=r.checkedIn;p.checkinFirstAt=r.firstAt;p.checkinAt=r.currentAt;p.checkinMethod=r.method;
      if(!drawCommit)state.registrationRosterRevision=Number(state.registrationRosterRevision||0)+1;
      state.qrCheckinManaged=true;state.qrCheckinRevision=revision;
      // An active room must have the existing public mirror. Never create a
      // partial tournament or expose the private state through this endpoint.
      const mirror=JSON.parse(publicPatch.bracketView||publicRoom.bracketView||'{}');
      mirror.players=(state.players||[]).map(p=>({id:p.id,name:p.name,checkedIn:p.checkedIn===true}));
      if(aggregate&&!drawCommit){const runtime=onsite.advanceRuntime(room,state,mirror);Object.assign(privatePatch,runtime);Object.assign(publicPatch,runtime);}
      tx.update(ref,{...privatePatch,qrCheckinManaged:true,qrCheckinRevision:revision,data:JSON.stringify(state),updatedAt:now});
      tx.update(pub,{...publicPatch,qrCheckinManaged:true,qrCheckinRevision:revision,bracketView:JSON.stringify(mirror),updatedAt:now});
      if(drawCommit)tx.create(ref.collection('onsiteWaitlistOperations').doc(drawCommit.operation.id),drawCommit.operation);
      tx.set(receiptRef,r);
    }
    if(output.audit)tx.create(ref.collection('checkinAudit').doc(auditId),{...output.audit,code,eventName:state.meta?.name||'',at:Timestamp.fromMillis(now)});
    if(output.operation)tx.create(operationRef,output.operation);
    return {...output.result,code,eventName:state.meta?.name||''};
  });}catch(e){
    if(e instanceof CheckinError||e instanceof onsite.O.DrawError)throw new HttpsError(e.code==='permission-denied'?'permission-denied':'failed-precondition',e.code);
    throw new HttpsError('internal','checkin-unavailable');
  }
};}
exports.createCheckinHandler=createCheckinHandler;
exports.tournamentCheckin=onCall({region:'asia-east1',cors:true,enforceAppCheck:true,secrets:[signingKey]},createCheckinHandler(getFirestore(),()=>signingKey.value()));
