'use strict';
// Source-only callable service; wiring/release of all raffle paths is separate.
const Certificate=require('../completion/certificate.cjs');
const {createRaffleInput}=require('./input.cjs');
const {parseParticipantKey}=require('./identity.cjs');
function createRafflePreview({db,core,HttpsError,now=Date.now,newIdentityVersion='participant-v1'}){
 if(!db?.runTransaction||typeof core?.canManage!=='function'||typeof HttpsError!=='function'||!['legacy','participant-v1'].includes(newIdentityVersion))throw Error('raffle-preview-dependencies');
 const readers={legacy:createRaffleInput(core),['participant-v1']:createRaffleInput(core,{identityVersion:'participant-v1'})};
 return async request=>{
  const uid=request?.auth?.uid;
  if(typeof uid!=='string'||!uid||uid.includes('/'))throw new HttpsError('unauthenticated','auth-required');
  const rawCode=request?.data?.code;
  if(typeof rawCode!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(rawCode))throw new HttpsError('invalid-argument','invalid-id');
  const code=rawCode.toUpperCase(),observed={},actorRef=db.doc('users/'+uid),rootRef=db.doc('tournaments/'+code),pubRef=db.doc('publicTournaments/'+code),ledgerRef=db.doc('tournaments/'+code+'/raffleControl/current');
  try{return await db.runTransaction(async tx=>{
   const [actor,root,pub,ledger]=await tx.getAll(actorRef,rootRef,pubRef,ledgerRef);
   if(!actor.exists||actor.data().active!==true)throw new HttpsError('permission-denied','inactive-account');
   if(!root.exists)throw new HttpsError('not-found','tournament-not-found');
   if(!core.canManage(actor.data(),uid,root.data(),now()))throw new HttpsError('permission-denied','tournament-access-denied');
   if(root.data().systemClosed)throw Error('system-closed');
   const sourceCreatedAt=Certificate.identity(root),ledgerIdentity=ledger.exists?Certificate.identity(ledger):null,data=ledger.data()||{};
   if(ledger.exists){
    if(Certificate.has(data,'sourceCreatedAt')){if(data.sourceCreatedAt!==sourceCreatedAt)throw Error('room-generation-changed');}
    else if(ledger.createTime.seconds<root.createTime.seconds||ledger.createTime.seconds===root.createTime.seconds&&ledger.createTime.nanoseconds<root.createTime.nanoseconds)throw Error('room-generation-changed');
   }
   if(Object.hasOwn(observed,'ledgerIdentity')&&observed.ledgerIdentity!==ledgerIdentity)throw Error('raffle-ledger-changed');
   observed.ledgerIdentity=ledgerIdentity;
   // Existing unversioned ledgers stay legacy. A new generation's draw MUST
   // persist this server-selected version before any receipt can be published.
   const version=ledger.exists?(Certificate.has(data,'identityVersion')?data.identityVersion:'legacy'):newIdentityVersion;
   if(!Object.hasOwn(readers,version))throw Error('raffle-identity-version');
   const prior=data.winnerKeys===undefined?[]:data.winnerKeys;
   if(!Array.isArray(prior)||prior.length>2000||prior.some(key=>typeof key!=='string'))throw Error('raffle-exclusion-context');
   if(version==='participant-v1')prior.forEach(parseParticipantKey);
   const result=await readers[version]({db,tx,root,pub,code,mode:request.data.mode,excluded:request.data.excludePrevious!==false?prior:[],observed});
   return {ok:true,count:result.pool.length,candidates:result.pool,candidateHash:result.candidateHash};
  });}catch(e){if(e instanceof HttpsError)throw e;throw new HttpsError('failed-precondition',String(e.message||'operation-failed'));}
 };
}
module.exports={createRafflePreview};
