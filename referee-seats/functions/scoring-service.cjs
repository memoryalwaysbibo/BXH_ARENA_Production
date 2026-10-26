'use strict';
const {createHash}=require('node:crypto'),C=require('./core.cjs'),S=require('./scoring-core.cjs');
function createScoringHandler(db,{clock=Date.now}={}){return async request=>{
 const uid=request.auth?.uid,d=request.data||{},code=String(d.code||'').trim().toUpperCase();
 if(!uid)throw Error('unauthenticated');
 if(!/^BXH-[A-Z0-9]{4,16}$/.test(code)||!/^[-a-zA-Z0-9]{16,80}$/.test(d.operationId||'')||JSON.stringify(d).length>10000)throw Error('invalid-request');
 const ref=db.doc('tournaments/'+code),pub=db.doc('publicTournaments/'+code),now=clock();
 const hash=createHash('sha256').update(JSON.stringify(d)).digest('hex'),opKey=createHash('sha256').update(uid+':'+d.operationId).digest('hex'),receiptRef=ref.collection('refereeScoreOperations').doc(opKey);
 return db.runTransaction(async tx=>{
  const [roomSnap,pubSnap,userSnap,releaseSnap,receipt]=await Promise.all([tx.get(ref),tx.get(pub),tx.get(db.doc('users/'+uid)),tx.get(db.doc('systemConfig/refereeSeatsV1')),tx.get(receiptRef)]);
  if(!roomSnap.exists||!pubSnap.exists)throw Error('not-found');
  if(releaseSnap.data()?.enabled!==true||releaseSnap.data()?.perCourtScoringVerified!==true)throw Error('release-not-ready');
  const room=roomSnap.data(),user=userSnap.data();let state,previous;
  try{state=JSON.parse(room.data);previous=JSON.parse(pubSnap.data().bracketView);}catch{throw Error('corrupt-data');}
  if(!C.eligible(room,user,uid)||!S.allowed(room,user,uid,Number(d.station)))throw Error('station-not-assigned');
  // Deduplicate before score-version validation; retries return current authoritative state.
  if(receipt.exists){if(receipt.data().hash!==hash)throw Error('operation-conflict');return {...receipt.data().result,state};}
  const result=S.transition({room,state,user,uid,d,now});
  state.updatedAt=Math.max(now,Number(room.updatedAt||0)+1,Number(state.updatedAt||0)+1);
  state.meta={...state.meta,refereeSeatsV1:room.refereeSeatsV1,...C.project(room.refereeSeatsV1),assignedStaffUids:room.assignedStaffUids||[]};
  const response={ok:true,matchId:result.matchId,scoreRevision:result.scoreRevision};
  tx.update(ref,{data:JSON.stringify(state),updatedAt:state.updatedAt});
  tx.update(pub,{bracketView:JSON.stringify(S.publicProjection(state,previous)),updatedAt:state.updatedAt});
  tx.create(receiptRef,{uid,hash,at:now,result:response});
  tx.create(ref.collection('refereeScoreAudit').doc(opKey),{uid,at:now,action:d.action,station:result.station,matchId:result.matchId,scoreRevision:result.scoreRevision,scoreA:state.matches.find(m=>m.id===result.matchId).scoreA??null,scoreB:state.matches.find(m=>m.id===result.matchId).scoreB??null});
  if(['confirm','quick'].includes(d.action))tx.set(db.doc('staffActivityLogs/'+uid+'/matches/'+code+'_'+result.matchId),{uid,tournamentCode:code,tournamentName:state.meta.name||'',matchId:result.matchId,station:result.station,confirmedAt:now,resultMethod:d.action==='quick'?'quick_decision':'score',eventAuthority:'official'},{merge:true});
  return {...response,state};
 });
};}
module.exports={createScoringHandler};
