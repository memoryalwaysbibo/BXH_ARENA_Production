'use strict';
// P3-50: bind the trusted Firestore authority check and private/public start
// writer to the SAME server transaction. This module is NOT registered as a
// Cloud Function and does not replace legacy start-tournament yet.
// Snapshot creation and court dispatch integration remain release blockers.
const {createRankedAuthorityResolver}=require('./rdw-ranked-authority-resolver.cjs');
const {writeSynchronizedStart}=require('./rdw-synchronized-start-reference.cjs');
function createAuthorizedMirrorStart({db,clock,verifyBracketInTransaction,enabled=false}={}){
 if(!enabled)return async()=>({ok:false,code:'rdw-disabled'});
 if(typeof db?.runTransaction!=='function'||typeof db?.doc!=='function'||
    typeof clock!=='function'||typeof verifyBracketInTransaction!=='function')
  throw Error('rdw-trusted-start-dependencies-required');
 const resolveAuthority=createRankedAuthorityResolver({db,clock});
 return async function start({eventCode,actorUid,expectedRosterRevision,drawRevision}={}){
  if(!/^BXH-[A-Z0-9]{6}$/.test(eventCode||'')||typeof actorUid!=='string'||!actorUid||
     !Number.isSafeInteger(expectedRosterRevision)||expectedRosterRevision<0||
     !Number.isSafeInteger(drawRevision)||drawRevision<0)return {ok:false,code:'invalid-request'};
  // These are canonical backend paths. Caller never supplies references,
  // authorization booleans, tier values, snapshots or server clock.
  const eventRef=db.doc('tournaments/'+eventCode);
  const publicRef=db.doc('publicTournaments/'+eventCode);
  const snapshotRef=db.doc('rdwSnapshots/'+eventCode);
  const result=await db.runTransaction(async tx=>{
   const auth=await resolveAuthority({eventCode,actorUid,expectedRosterRevision,tx});
   if(!auth.ok)return {committed:false,reason:auth.reason};
   const bracket=await verifyBracketInTransaction({tx,eventCode,drawRevision,expectedRosterRevision});
   if(bracket!==true)return {committed:false,reason:'bracket-unverified'};
   const now=clock();
   if(!Number.isSafeInteger(now)||now<=0)throw Error('server-clock-invalid');
   return writeSynchronizedStart({
    tx,eventRef,publicRef,snapshotRef,eventCode,expectedRosterRevision,
    drawRevision,serverTime:now,authorized:true,bracketVerified:true
   });
  });
  return {ok:result.committed===true,code:result.reason||null,mode:result.mode||null};
 };
}
module.exports={createAuthorizedMirrorStart};
