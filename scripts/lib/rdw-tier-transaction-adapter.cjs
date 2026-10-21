'use strict';
// RDW P2-2 reference transaction adapter. Must be called from trusted backend only.
// No Firebase initialization or production callable registration in this module.
const contract=require('./rdw-prematch-tier-snapshot.cjs');
async function sealMatchTierPair({tx,matchRef,eventId,matchId,revision=0,playerA,playerB,capturedAt,matchStartedAt}){
  if(!tx||typeof tx.get!=='function'||typeof tx.set!=='function'||!matchRef)throw Error('transaction-required');
  if(!playerA||!playerB||!playerA.uid||!playerB.uid||!playerA.ref||!playerB.ref)throw Error('trusted-player-refs-required');
  // Firestore requires all transaction reads before writes.
  const [matchSnap,aSnap,bSnap]=await Promise.all([tx.get(matchRef),tx.get(playerA.ref),tx.get(playerB.ref)]);
  if(!aSnap?.exists||!bSnap?.exists)throw Error('player-grade-missing');
  const a=aSnap.data(),b=bSnap.data();
  if(!a||!b||typeof a!=='object'||typeof b!=='object')throw Error('player-grade-missing');
  if(a.uid!==playerA.uid||b.uid!==playerB.uid)throw Error('player-identity-mismatch');
  // Explicit trusted resolver: no unverified Firestore field assumptions or highest-tier fallback.
  // Caller must resolve the CURRENT tier using a verified server-owned source.
  if(typeof arguments[0].resolveCurrentTier!=='function')throw Error('trusted-tier-resolver-required');
  const tier=async(p,uid)=>{
    const result=await arguments[0].resolveCurrentTier({player:p,uid});
    if(!result||result.source!=='server'||result.verified!==true||result.version!=='hunter-license-v2.1'||!contract.TIERS.includes(result.tier))throw Error('verified-current-tier-required');
    return result.tier;
  };
  const existing=matchSnap?.exists?matchSnap.data()?.rdwTierSnapshots:null;
  const result=contract.seal(existing,{eventId,matchId,revision,playerA:playerA.uid,playerB:playerB.uid,tierA:await tier(a,playerA.uid),tierB:await tier(b,playerB.uid),capturedAt,matchStartedAt});
  if(result.created)tx.set(matchRef,{rdwTierSnapshots:result.pair},{merge:true});
  return result;
}
module.exports={sealMatchTierPair};
