'use strict';
// ISOLATED REFERENCE: server-owned, pre-event Hunter tier baseline creation.
// Not wired to any Cloud Function, tournament start, V1 ladder, XP or grants.
const {verifiedCurrentTier}=require('./rdw-current-tier-source.cjs');
const SOURCE_SCOPE='public-official-canonical-self-history-v1';
const id=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(v);
const eventCode=v=>typeof v==='string'&&/^BXH-[A-Z0-9]{6}$/.test(v);
function checkedEvidence(evidence,uid,atMs){
 if(!evidence||evidence.uid!==uid||evidence.ok!==true||evidence.verified!==true||
    evidence.source!=='server'||evidence.complete!==true||evidence.unresolvedIdentities!==0||
    evidence.sourceScope!==SOURCE_SCOPE||!/^[a-f0-9]{64}$/.test(evidence.sourceDigest||'')||
    evidence.current?.tier!==evidence.tier)return null;
 const v=verifiedCurrentTier(evidence,{uid,atMs});
 return v.ok?{uid,tier:v.tier,sourceDigest:evidence.sourceDigest,version:v.version}:null;
}
function createSealer({db,authorize,verifyCanonicalMatch,resolveTiers,clock,enabled=false}={}){
 if(!enabled)return async()=>({ok:false,code:'rdw-snapshot-disabled'});
 if(!db||typeof db.runTransaction!=='function'||typeof db.doc!=='function'||
    [authorize,verifyCanonicalMatch,resolveTiers,clock].some(fn=>typeof fn!=='function'))
  throw Error('trusted-server-dependencies-required');
 return async({code,matchId,actorUid,expectedRosterRevision}={}){
  if(!eventCode(code)||!id(matchId)||!id(actorUid)||
     !Number.isSafeInteger(expectedRosterRevision)||expectedRosterRevision<0)
   return {ok:false,code:'invalid-input'};
  // Both document paths are derived from validated identifiers, never client refs.
  const tournamentRef=db.doc('tournaments/'+code);
  const baselineRef=db.doc('rdwHunterShadowBaselines/'+code+'_'+matchId);
  return db.runTransaction(async tx=>{
   // Read before write; retries run the same checks against authoritative state.
   const [eventDoc,priorDoc]=await Promise.all([tx.get(tournamentRef),tx.get(baselineRef)]);
   if(!eventDoc.exists)return {ok:false,code:'tournament-missing'};
   const room=eventDoc.data();
   if(!room||room.startedAt||room.rosterLocked)return {ok:false,code:'tournament-already-started'};
   if(await authorize({tx,actorUid,code,room})!==true)
    return {ok:false,code:'not-authorized'};
   const match=await verifyCanonicalMatch({tx,code,matchId,room,expectedRosterRevision});
   if(!match||match.valid!==true||match.rosterRevision!==expectedRosterRevision||
      !id(match.playerA)||!id(match.playerB)||match.playerA===match.playerB)
    return {ok:false,code:'canonical-match-invalid'};
   if(priorDoc.exists){
    const prior=priorDoc.data();
    if(prior?.code===code&&prior.matchId===matchId&&
       prior.playerA===match.playerA&&prior.playerB===match.playerB&&
       prior.rosterRevision===expectedRosterRevision)
     return {ok:true,created:false,mode:'existing-immutable-baseline'};
    return {ok:false,code:'immutable-baseline-conflict'};
   }
   const atMs=clock();
   if(!Number.isSafeInteger(atMs)||atMs<=0)throw Error('invalid-server-clock');
   // Both current tiers must be resolved by an injected audited backend reader,
   // within the SAME transaction and from the same canonical roster identity.
   const tierPair=await resolveTiers({tx,code,matchId,playerA:match.playerA,playerB:match.playerB,atMs});
   const a=checkedEvidence(tierPair?.a,match.playerA,atMs);
   const b=checkedEvidence(tierPair?.b,match.playerB,atMs);
   if(!a||!b)return {ok:false,code:'hunter-history-unverified'};
   const sealed={schemaVersion:'rdw-hunter-prematch-v1',code,matchId,
    rosterRevision:expectedRosterRevision,playerA:match.playerA,playerB:match.playerB,
    capturedAtMs:atMs,source:'server',verified:true,
    tiers:{a:a.tier,b:b.tier},digests:{a:a.sourceDigest,b:b.sourceDigest},
    rdwOnly:true,affectsLadder:false,affectsXp:false,affectsAwards:false};
   tx.create(baselineRef,sealed);
   return {ok:true,created:true,mode:'rdw-shadow-baseline-sealed'};
  });
 };
}
module.exports={createSealer,checkedEvidence};
