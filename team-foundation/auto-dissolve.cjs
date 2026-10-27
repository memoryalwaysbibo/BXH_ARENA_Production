'use strict';
const {randomUUID}=require('node:crypto');
const {canDissolve}=require('./team-policy.cjs');
const BATCH_LIMIT=20,MAX_BATCHES=5;
// Internal worker candidate. Must be invoked by a separately configured scheduler.
// Every candidate is rechecked transactionally; no client can request dissolution.
function createAutoDissolver({db,clock=Date.now,newId=randomUUID,documentId}){
 async function dissolveCandidate(teamId){
  const historyId=newId();
  return db.runTransaction(async tx=>{
   const teamRef=db.doc('teamsV1/'+teamId),snap=await tx.get(teamRef);
   if(!snap.exists)return false;
   const team=snap.data(),now=clock();
   if(team.status!=='active'||!Number.isSafeInteger(team.dissolveAt)||team.dissolveAt>now||!canDissolve(team,null,now,{automatic:true}))return false;
   const membershipRef=db.doc('teamMembershipsV1/'+team.captainUid),membership=await tx.get(membershipRef);
   const profile=await tx.get(db.doc('publicPlayers/'+team.captainUid));
   const publicName=profile.exists&&typeof profile.data().publicName==='string'?profile.data().publicName.trim():'';
   if(!membership.exists||membership.data().teamId!==teamId)throw Error('membership-inconsistent');
   tx.update(teamRef,{status:'dissolved',dissolvedAt:now,dissolvedBy:'system',dissolveAt:null});
   tx.delete(membershipRef);
   tx.create(db.doc('teamsV1/'+teamId+'/history/'+historyId),{subjectUid:team.captainUid,subjectName:publicName||'隊長',actorUid:'system',actorName:'系統',actorRole:'system',method:'auto-dissolve',occurredAt:now});
   return true;
  });
 }
 async function readBatch(cursor,stable=false){
  const now=clock();
  let query=db.collection('teamsV1').where('status','==','active').where('dissolveAt','<=',now).orderBy('dissolveAt');
  if(stable){if(!documentId)throw Error('document-id-required');query=query.orderBy(documentId);if(cursor)query=query.startAfter(cursor.dueAt,cursor.id);}else if(cursor)query=query.startAfter(cursor);
  const pending=await query.limit(BATCH_LIMIT).get();
  let dissolved=0,failed=0;for(const doc of pending.docs){try{if(await dissolveCandidate(doc.id))dissolved++;}catch(_){failed++;}}
  return {examined:pending.docs.length,dissolved,failed,mayHaveMore:pending.docs.length===BATCH_LIMIT,anchor:pending.docs.at(-1)||null};
 }
 async function runBatch(){
  const {anchor,...result}=await readBatch(null);return result;
 }
 // A bounded sweep advances even when all earlier candidates fail. The limit keeps
 // one invocation predictable; cross-invocation cursor persistence is still needed.
 async function runSweep(){
  let cursor=null,examined=0,dissolved=0,failed=0,batches=0,mayHaveMore=false;
  while(batches<MAX_BATCHES){
   const batch=await readBatch(cursor);batches++;examined+=batch.examined;dissolved+=batch.dissolved;failed+=batch.failed;mayHaveMore=batch.mayHaveMore;
   if(!mayHaveMore)break;cursor=batch.anchor;
  }
  return {examined,dissolved,failed,batches,mayHaveMore};
 }

 // Serializable cursor uses both indexed time and document ID, so equal times
 // remain stable even after the anchor team is dissolved or removed.
 async function runSweepFrom(cursor=null){
  if(cursor!==null&&(!Number.isSafeInteger(cursor.dueAt)||cursor.dueAt<0||typeof cursor.id!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(cursor.id)))throw Error('invalid-cursor');
  let examined=0,dissolved=0,failed=0,batches=0,mayHaveMore=false,next=cursor;
  while(batches<MAX_BATCHES){
   const batch=await readBatch(next,true);batches++;examined+=batch.examined;dissolved+=batch.dissolved;failed+=batch.failed;mayHaveMore=batch.mayHaveMore;
   if(!mayHaveMore){next=null;break;}
   const dueAt=batch.anchor.data().dissolveAt,id=batch.anchor.id;
   if(!Number.isSafeInteger(dueAt)||dueAt<0||!/^[A-Za-z0-9_-]{1,128}$/.test(id))throw Error('invalid-query-anchor');
   next={dueAt,id};
  }
  return {examined,dissolved,failed,batches,mayHaveMore,nextCursor:next};
 }

 return {dissolveCandidate,runBatch,runSweep,runSweepFrom};
}
module.exports={createAutoDissolver,BATCH_LIMIT,MAX_BATCHES};
