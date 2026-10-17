'use strict';
const {advance}=require('./qr-checkin-fence.cjs');
const {transition,digest,CheckinError}=require('./core.cjs');
const O=require('./onsite/core.cjs');

// Runs after the original draw transition has authorized the operator and
// produced a pure commit, but before any transaction writes. No client fields
// are used as authorization or attendance history.
async function prepareCommit({tx,ref,aggregate,output,uid,code}){
 const room=aggregate.tournament,change=output.commit;
 if(!change||room?.qrCheckinManaged!==true)return null;
 const peer=aggregate.publicTournament;
 if(peer?.qrCheckinManaged!==true||peer.qrCheckinRevision!==room.qrCheckinRevision)throw new CheckinError('checkin-state-stale');
 const config=(await tx.get(ref.firestore.doc('systemConfig/qrCheckin'))).data();
 if(room.onsiteWaitlistServerOwned!==true&&change.tournamentPatch.onsiteWaitlistServerOwned===true&&config?.onsiteIntegrationVerified!==true)throw new CheckinError('onsite-integration-required');
 let attendance=null;
 if(change.operation.action==='checkIn'){
  const state=O.parseState(room.data),playerId=change.operation.result.playerId;
  const player=state.players.find(p=>p.id===playerId);
  if(!player)throw new CheckinError('not-confirmed');
  const receiptRef=ref.collection('checkinReceipts').doc(digest(playerId));
  const parentRef=room.eventStaffAssignments?.[uid]&&room.createdBy?ref.firestore.doc('users/'+room.createdBy):null;
  const [receipt,parent]=await Promise.all([tx.get(receiptRef),parentRef?tx.get(parentRef):null]);
  const registration=aggregate.registrations.find(r=>r.registrationId===player.registrationId);
  const result=transition({code,uid,user:aggregate.user,parentUser:parent?.data(),room,state,registration,receipt:receipt.data(),config,
   d:{action:change.operation.result.checkedIn?'manual':'revoke',playerId,operationId:digest('onsite:'+change.operation.id)},
   now:change.operation.createdAt,onsiteReady:true});
  attendance={receiptRef,receipt:result.receipt,audit:result.audit,auditId:'onsite-'+digest(change.operation.id)};
 }
 const next=O.parseState(change.tournamentPatch.data),fields=advance(room,next,room.qrCheckinRevision);
 if(attendance?.receipt){
  const r=attendance.receipt,p=next.players.find(p=>p.id===r.playerId);
  if(!p)throw new CheckinError('not-confirmed');
  Object.assign(p,{checkedIn:r.checkedIn,checkinFirstAt:r.firstAt,checkinAt:r.currentAt,checkinMethod:r.method});
 }
 const view=O.parseState(change.publicPatch.bracketView||peer.bracketView,'invalid-public-view');
 view.players=next.players.map(p=>({id:p.id,name:p.name||'',checkedIn:p.checkedIn===true}));
 Object.assign(change.tournamentPatch,fields,{qrCheckin:room.qrCheckin,data:JSON.stringify(next)});
 Object.assign(change.publicPatch,fields,{bracketView:JSON.stringify(view)});
 const after=O.applyCommit(aggregate,change),snapshot=O.publicState(after);
 output.result={...output.result,state:snapshot,canonicalState:next,candidateHash:snapshot.candidateHash};
 return attendance;
}
async function prepare(input){
 try{return await prepareCommit(input);}
 catch(e){if(e instanceof CheckinError)throw new O.DrawError(e.code,e.code==='permission-denied'?403:409);throw e;}
}
module.exports={prepare};
