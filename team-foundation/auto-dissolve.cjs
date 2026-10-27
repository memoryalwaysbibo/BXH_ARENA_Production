'use strict';
const {randomUUID}=require('node:crypto');
const {canDissolve}=require('./team-policy.cjs');
const BATCH_LIMIT=20;
// Internal worker candidate. Must be invoked by a separately configured scheduler.
// Every candidate is rechecked transactionally; no client can request dissolution.
function createAutoDissolver({db,clock=Date.now,newId=randomUUID}){
 async function dissolveCandidate(teamId){
  const historyId=newId();
  return db.runTransaction(async tx=>{
   const teamRef=db.doc('teamsV1/'+teamId),snap=await tx.get(teamRef);
   if(!snap.exists)return false;
   const team=snap.data(),now=clock();
   if(team.status!=='active'||!Number.isSafeInteger(team.dissolveAt)||team.dissolveAt>now||!canDissolve(team,null,now,{automatic:true}))return false;
   const membershipRef=db.doc('teamMembershipsV1/'+team.captainUid),membership=await tx.get(membershipRef);
   if(!membership.exists||membership.data().teamId!==teamId)throw Error('membership-inconsistent');
   tx.update(teamRef,{status:'dissolved',dissolvedAt:now,dissolvedBy:'system',dissolveAt:null});
   tx.delete(membershipRef);
   tx.create(db.doc('teamsV1/'+teamId+'/history/'+historyId),{subjectUid:team.captainUid,subjectName:'隊長',actorUid:'system',actorName:'系統',actorRole:'system',method:'auto-dissolve',occurredAt:now});
   return true;
  });
 }
 async function runBatch(){
  const now=clock();
  const pending=await db.collection('teamsV1').where('status','==','active').where('dissolveAt','<=',now).orderBy('dissolveAt').limit(BATCH_LIMIT).get();
  let dissolved=0;for(const doc of pending.docs)if(await dissolveCandidate(doc.id))dissolved++;
  return {examined:pending.docs.length,dissolved,mayHaveMore:pending.docs.length===BATCH_LIMIT};
 }
 return {dissolveCandidate,runBatch};
}
module.exports={createAutoDissolver,BATCH_LIMIT};
