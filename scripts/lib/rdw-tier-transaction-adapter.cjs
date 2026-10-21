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
  if(a.uid!==playerA.uid||b.uid!==playerB.uid)throw Error('player-identity-mismatch');
  // A verified server-issued current tier, not client supplied grade or historical replay.
  function tier(p){const g=p?.permanentLicenseCurrent;if(!g||g.source!=='server'||g.verified!==true||g.version!=='hunter-license-v2.1'||typeof g.tier!=='string')throw Error('verified-current-tier-required');return g.tier;}
  const existing=matchSnap?.exists?matchSnap.data()?.rdwTierSnapshots:null;
  const result=contract.seal(existing,{eventId,matchId,revision,playerA:playerA.uid,playerB:playerB.uid,tierA:tier(a),tierB:tier(b),capturedAt,matchStartedAt});
  if(result.created)tx.set(matchRef,{rdwTierSnapshots:result.pair},{merge:true});
  return result;
}
module.exports={sealMatchTierPair};
