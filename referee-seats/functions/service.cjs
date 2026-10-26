'use strict';
const {createHash,randomUUID}=require('node:crypto');
const C=require('./core.cjs');
function createHandler(db,{clock=Date.now,uuid=randomUUID}={}){return async request=>{
 const uid=request.auth?.uid,d=request.data||{},code=String(d.code||'').trim().toUpperCase();
 if(!uid)throw new Error('unauthenticated');
 if(!/^BXH-[A-Z0-9]{4,16}$/.test(code)||!/^[-a-zA-Z0-9]{16,80}$/.test(d.operationId||''))throw new Error('invalid-request');
 const now=clock(),id=uuid(),ref=db.doc('tournaments/'+code),pub=db.doc('publicTournaments/'+code);
 const operationRef=ref.collection('refereeSeatOperations').doc(createHash('sha256').update(uid+':'+d.operationId).digest('hex'));
 return db.runTransaction(async tx=>{
  const [roomSnap,publicSnap,userSnap,receiptSnap,releaseSnap]=await Promise.all([tx.get(ref),tx.get(pub),tx.get(db.doc('users/'+uid)),tx.get(operationRef),tx.get(db.doc('systemConfig/refereeSeatsV1'))]);
  if(releaseSnap.data()?.enabled!==true||releaseSnap.data()?.perCourtScoringVerified!==true)throw new Error('release-not-ready');
  if(!roomSnap.exists||!publicSnap.exists)throw new Error('not-found');
  const room=roomSnap.data(),user=userSnap.data();
  let state;try{state=JSON.parse(room.data);}catch{throw new Error('corrupt-data');}
  C.eligible(room,user,uid)||(()=>{throw new Error('not-event-staff');})();
  const hash=createHash('sha256').update(JSON.stringify(d)).digest('hex');
  if(receiptSnap.exists){const receipt=receiptSnap.data();if(receipt.hash!==hash)throw new Error('operation-conflict');return receipt.result;}
  let targetUser,requesterUser;
  const targetUid=room.refereeSeatsV1?.courts?.[d.station]?.[d.slot]?.uid;
  const requesterUid=room.refereeSeatsV1?.requests?.[d.requestId]?.fromUid;
  if(d.action==='request'&&targetUid)targetUser=(await tx.get(db.doc('users/'+targetUid))).data();
  if(d.action==='respond'&&requesterUid)requesterUser=(await tx.get(db.doc('users/'+requesterUid))).data();
  const out=C.transition({room,state,user,uid,d,now,id,targetUser,requesterUser});
  const projection=C.project(out.model,room.createdBy,state.meta.stations),staff=[...new Set([...(room.assignedStaffUids||[]),room.createdBy,...projection.refereeStationUids].filter(Boolean))];
  state.meta={...state.meta,...projection,assignedStaffUids:staff,refereeSeatsV1:out.model};
  const updatedAt=Math.max(now,Number(room.updatedAt||0)+1,Number(state.updatedAt||0)+1);state.updatedAt=updatedAt;
  let mirror;try{mirror=JSON.parse(publicSnap.data().bracketView);}catch{throw new Error('public-mirror-missing');}
  // Public data contains display names only, never seat UID or private requests.
  mirror.meta={...mirror.meta,refereeStationNames:projection.refereeStationNames,refereeStationRestrictionEnabled:true,refereeSeatNames:projection.refereeSeatNames};
  delete mirror.meta.refereeSeatsV1;delete mirror.meta.refereeStationUids;delete mirror.meta.refereeStationAssignments;delete mirror.meta.assignedStaffUids;
  mirror.updatedAt=updatedAt;
  tx.update(ref,{refereeSeatsV1:out.model,...projection,assignedStaffUids:staff,data:JSON.stringify(state),updatedAt});
  tx.update(pub,{bracketView:JSON.stringify(mirror),updatedAt});
  tx.create(operationRef,{uid,hash,at:now,result:out.result});
  tx.create(ref.collection('refereeSeatAudit').doc(id),{uid,at:now,action:d.action,station:d.station||null,slot:d.slot||null,requestId:d.requestId||out.result.requestId||null,response:d.response||null,previousUid:targetUid||null,revision:out.model.revision});
  return out.result;
 });
};}
module.exports={createHandler};
