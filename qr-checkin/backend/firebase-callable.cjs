'use strict';
const {onCall,HttpsError}=require('firebase-functions/v2/https');
const {defineSecret}=require('firebase-functions/params');
const {getFirestore,Timestamp}=require('firebase-admin/firestore');
const crypto=require('node:crypto');
const {transition,ownedPlayer,digest,CheckinError}=require('./core.cjs');
const signingKey=defineSecret('QR_CHECKIN_SIGNING_KEY');
exports.tournamentCheckin=onCall({region:'asia-east1',cors:true,enforceAppCheck:true,secrets:[signingKey]},async request=>{
  const uid=request.auth?.uid;
  if(!uid)throw new HttpsError('unauthenticated','auth-required');
  const d=request.data||{},code=String(d.code||'').trim().toUpperCase();
  if(!/^BXH-[A-Z0-9]{4,16}$/.test(code))throw new HttpsError('invalid-argument','invalid-code');
  const db=getFirestore(),ref=db.doc('tournaments/'+code),pub=db.doc('publicTournaments/'+code);
  // This timestamp originates on the server and stays stable during retries.
  const now=Timestamp.now().toMillis(),session=crypto.randomUUID(),auditId=crypto.randomUUID();
  try{return await db.runTransaction(async tx=>{
    const [roomSnap,userSnap,cfgSnap,pubSnap]=await Promise.all([tx.get(ref),tx.get(db.doc('users/'+uid)),tx.get(db.doc('systemConfig/qrCheckin')),tx.get(pub)]);
    if(!roomSnap.exists||!pubSnap.exists)throw new CheckinError('room-missing');
    const room=roomSnap.data(),state=JSON.parse(room.data||'{}');
    let player;
    if(d.action==='scan')player=ownedPlayer(state.players,uid);
    else player=(state.players||[]).find(p=>p.id===d.playerId);
    const receiptRef=player?ref.collection('checkinReceipts').doc(digest(player.id)):null;
    const operationRef=typeof d.operationId==='string'?ref.collection('checkinOperations').doc(digest(uid+':'+d.operationId)):null;
    const registrationRef=player?.registrationId?ref.collection('registrations').doc(player.registrationId):null;
    const [receiptSnap,operationSnap,registrationSnap]=await Promise.all([receiptRef?tx.get(receiptRef):null,operationRef?tx.get(operationRef):null,registrationRef?tx.get(registrationRef):null]);
    const output=transition({code,uid,user:userSnap.data(),room,state,registration:registrationSnap?.data(),receipt:receiptSnap?.data(),operation:operationSnap?.data(),config:cfgSnap.data(),d,now,secret:signingKey.value(),newSession:session});
    if(d.action==='history') {
      const history=await tx.get(ref.collection('checkinAudit').orderBy('at','desc').limit(100));
      return {ok:true,records:history.docs.map(s=>({...s.data(),at:s.data().at.toMillis()}))};
    }
    const revision=Number(room.qrCheckinRevision||0)+1;
    if(output.settings) {
      state.qrCheckinManaged=true;
      state.qrCheckinRevision=revision;
      tx.update(ref,{qrCheckin:output.settings,qrCheckinManaged:true,qrCheckinRevision:revision,data:JSON.stringify(state)});
      tx.update(pub,{qrCheckinManaged:true,qrCheckinRevision:revision});
    }
    if(output.receipt) {
      const p=state.players.find(p=>p.id===output.playerId),r=output.receipt;
      p.checkedIn=r.checkedIn;p.checkinFirstAt=r.firstAt;p.checkinAt=r.currentAt;p.checkinMethod=r.method;
      state.registrationRosterRevision=Number(state.registrationRosterRevision||0)+1;
      state.qrCheckinManaged=true;state.qrCheckinRevision=revision;
      // An active room must have the existing public mirror. Never create a
      // partial tournament or expose the private state through this endpoint.
      const mirror=JSON.parse(pubSnap.data().bracketView||'{}');
      mirror.players=(state.players||[]).map(p=>({id:p.id,name:p.name,checkedIn:p.checkedIn===true}));
      tx.update(ref,{qrCheckinManaged:true,qrCheckinRevision:revision,data:JSON.stringify(state),updatedAt:now});
      tx.update(pub,{qrCheckinManaged:true,qrCheckinRevision:revision,bracketView:JSON.stringify(mirror),updatedAt:now});
      tx.set(receiptRef,r);
    }
    if(output.audit)tx.create(ref.collection('checkinAudit').doc(auditId),{...output.audit,code,eventName:state.meta?.name||'',at:Timestamp.fromMillis(now)});
    if(output.operation)tx.create(operationRef,output.operation);
    return {...output.result,code,eventName:state.meta?.name||''};
  });}catch(e){
    if(e instanceof CheckinError)throw new HttpsError(e.code==='permission-denied'?'permission-denied':'failed-precondition',e.code);
    throw new HttpsError('internal','checkin-unavailable');
  }
});
