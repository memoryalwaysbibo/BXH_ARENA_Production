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
function prematchRoom(room,expectedRosterRevision,expectedCode){
 if(!room||typeof room!=='object')return {ok:false,reason:'room-data-invalid'};
 let state=room;
 if(Object.hasOwn(room,'data')){
  if(typeof room.data==='string'){
   try{state=JSON.parse(room.data);}catch{return {ok:false,reason:'room-data-invalid'};}
  }else state=room.data;
  if(!state||typeof state!=='object'||Array.isArray(state))return {ok:false,reason:'room-data-invalid'};
 }
 // Never seal a snapshot for a document that advertises a different room.
 // Missing optional aliases are tolerated; conflicting aliases are not.
 if(expectedCode&&[room.code,room.cloudCode,state.code,state.cloudCode]
    .some(value=>value!==undefined&&value!==null&&value!==''&&value!==expectedCode))
  return {ok:false,reason:'room-code-mismatch'};
 if(room.meta?.battleMode==='team'||state.meta?.battleMode==='team')
  return {ok:false,reason:'team-mode-not-audited'};
 // A legacy root field cannot override a newer nested canonical room state.
 if(room.startedAt||room.rosterLocked||state.startedAt||state.rosterLocked)
  return {ok:false,reason:'tournament-already-started'};
 const rootRevision=room.registrationRosterRevision,innerRevision=state.registrationRosterRevision;
 // Require explicit, agreeing revision evidence. Missing revision is not zero.
 if(!Number.isSafeInteger(innerRevision)||innerRevision!==expectedRosterRevision||
    (rootRevision!==undefined&&rootRevision!==innerRevision))
  return {ok:false,reason:'roster-revision-stale'};
 return {ok:true,state};
}
function createSealer({db,authorize,verifyCanonicalMatch,resolveTiers,clock,enabled=false}={}){
 if(!enabled)return async()=>({ok:false,code:'rdw-snapshot-disabled'});
 if(!db||typeof db.runTransaction!=='function'||typeof db.doc!=='function'||
    [authorize,verifyCanonicalMatch,resolveTiers,clock].some(fn=>typeof fn!=='function'))
  throw Error('trusted-server-dependencies-required');
 return async function sealHunterPrematch({code,matchId,actorUid,expectedRosterRevision}={}){
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
   const checked=prematchRoom(room,expectedRosterRevision,code);
   if(!checked.ok)return {ok:false,code:checked.reason};
   if(await authorize({tx,actorUid,code,room})!==true)
    return {ok:false,code:'not-authorized'};
   const match=await verifyCanonicalMatch({tx,code,matchId,room:checked.state,expectedRosterRevision});
   if(!match||match.valid!==true||match.rosterRevision!==expectedRosterRevision||
      !id(match.playerA)||!id(match.playerB)||match.playerA===match.playerB)
    return {ok:false,code:'canonical-match-invalid'};
   if(priorDoc.exists){
    const prior=priorDoc.data();
    if(prior?.schemaVersion==='rdw-hunter-prematch-v1'&&prior.source==='server'&&
       prior.verified===true&&prior.rdwOnly===true&&
       prior.affectsLadder===false&&prior.affectsXp===false&&prior.affectsAwards===false&&
       prior?.code===code&&prior.matchId===matchId&&
       prior.playerA===match.playerA&&prior.playerB===match.playerB&&
       prior.rosterRevision===expectedRosterRevision&&
       Number.isSafeInteger(prior.capturedAtMs)&&prior.capturedAtMs>0&&
       prior.tiers&&['ungraded','e','d','c','b','a','s','national'].includes(prior.tiers.a)&&
       ['ungraded','e','d','c','b','a','s','national'].includes(prior.tiers.b)&&
       /^[a-f0-9]{64}$/.test(prior.digests?.a||'')&&
       /^[a-f0-9]{64}$/.test(prior.digests?.b||''))
     return {ok:true,created:false,mode:'existing-immutable-baseline'};
    return {ok:false,code:'immutable-baseline-conflict'};
   }
   const atMs=clock();
   if(!Number.isSafeInteger(atMs)||atMs<=0)throw Error('invalid-server-clock');
   // Both current tiers must be resolved by an injected audited backend reader,
   // within the SAME transaction and from the same canonical roster identity.
   // Do not hand a writable Firestore transaction to the Hunter tier evaluator.
   // Audited resolver construction and server IAM remain separate release gates.
   const readTx=Object.freeze({get:ref=>tx.get(ref)});
   const tierPair=await resolveTiers({tx:readTx,code,matchId,playerA:match.playerA,playerB:match.playerB,atMs});
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
module.exports={createSealer,checkedEvidence,prematchRoom};
