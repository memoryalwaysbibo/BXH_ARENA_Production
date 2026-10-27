'use strict';
// P3-50: bind the trusted Firestore authority check and private/public start
// writer to the SAME server transaction. This module is NOT registered as a
// Cloud Function and does not replace legacy start-tournament yet.
// Snapshot creation and court dispatch integration remain release blockers.
const {createRankedAuthorityResolver}=require('./rdw-ranked-authority-resolver.cjs');
const {writeSynchronizedStart}=require('./rdw-synchronized-start-reference.cjs');
const {buildRosterSnapshot}=require('./rdw-roster-tier-snapshot.cjs');
const {readPartnerStartReplay}=require('./partner-start-quota.cjs');
function createAuthorizedMirrorStart({db,clock,verifyBracketInTransaction,resolveVerifiedTiers,buildServerDispatch,enabled=false}={}){
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
  // Recover a committed partner start before checking current grant/tier state.
  // Every value here is server-derived; HTTP callers cannot supply this proof.
  try{
   const replay=await db.runTransaction(tx=>readPartnerStartReplay({tx,db,eventCode,actorUid,drawRevision,expectedRosterRevision}));
   if(replay)return {ok:true,code:null,mode:'rdw-verified',replayed:true,startedAt:replay.startedAt};
  }catch(error){return {ok:false,code:error.message};}
  let snapshotCandidate=null;
  if(typeof resolveVerifiedTiers==='function'){
   // Resolve audited Hunter tiers outside the writer transaction, then bind
   // the snapshot to the canonical roster again under transaction locks.
   const preflight=await db.runTransaction(async tx=>{
    const auth=await resolveAuthority({eventCode,actorUid,expectedRosterRevision,tx});
    if(!auth.ok)return {ok:false,reason:auth.reason};
    const snap=await tx.get(eventRef);
    if(!snap?.exists)return {ok:false,reason:'room-missing'};
    let state;
    try{const raw=snap.data()?.data;state=typeof raw==='string'?JSON.parse(raw):raw;}catch{}
    if(state?.meta?.ladderMode!=='ranked'||state?.meta?.eventAuthority!=='official'||
       state?.registrationRosterRevision!==expectedRosterRevision||!Array.isArray(state.players))
      return {ok:false,reason:'ranked-roster-unverified'};
    return {ok:true,rosterUids:state.players.map(p=>p?.uid)};
   });
   if(!preflight.ok)return {ok:false,code:preflight.reason};
   const resolutionStartedAt=clock();
   const verifiedTiers=await resolveVerifiedTiers({eventCode,drawRevision,rosterUids:preflight.rosterUids,capturedAt:resolutionStartedAt});
   // Tier readers stamp completion time. Capture only after all reads finish.
   const capturedAt=clock();
   try{snapshotCandidate=buildRosterSnapshot({eventCode,drawRevision,rosterUids:preflight.rosterUids,verifiedTiers,capturedAt});}
   catch{return {ok:false,code:'hunter-tiers-unverified'};}
  }
  const result=await db.runTransaction(async tx=>{
   try{
    const replay=await readPartnerStartReplay({tx,db,eventCode,actorUid,drawRevision,expectedRosterRevision});
    if(replay)return {committed:true,mode:'rdw-verified',replayed:true,startedAt:replay.startedAt};
   }catch(error){return {committed:false,reason:error.message};}
   const auth=await resolveAuthority({eventCode,actorUid,expectedRosterRevision,tx});
   if(!auth.ok)return {committed:false,reason:auth.reason};
   const bracket=await verifyBracketInTransaction({tx,eventCode,drawRevision,expectedRosterRevision});
   if(bracket!==true)return {committed:false,reason:'bracket-unverified'};
   const now=clock();
   if(!Number.isSafeInteger(now)||now<=0)throw Error('server-clock-invalid');
   // Court initialization must be derived from canonical server state.
   // No browser-supplied matches/courts are accepted.
   if(typeof buildServerDispatch!== 'function')return {committed:false,reason:'server-dispatch-unavailable'};
   const dispatchCandidate=await buildServerDispatch({tx,eventCode,drawRevision,expectedRosterRevision,serverTime:now});
   return writeSynchronizedStart({
    tx,eventRef,publicRef,snapshotRef,eventCode,expectedRosterRevision,
    drawRevision,serverTime:now,authorized:true,bracketVerified:true,snapshotCandidate,dispatchCandidate,quotaContext:{db,actorUid}
   });
  });
  return {ok:result.committed===true,code:result.reason||null,mode:result.mode||null,...(result.startedAt?{replayed:result.replayed===true,startedAt:result.startedAt}:{})};
 };
}
module.exports={createAuthorizedMirrorStart};
