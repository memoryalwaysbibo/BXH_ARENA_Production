'use strict';
// P3-55: compose the audited Hunter 2.1 read-only resolver with the
// server-side ranked start coordinator. This is intentionally NOT an HTTP
// entrypoint or deployed handler. A private bundle is provisioned server-side;
// clients never pass tiers, UIDs, bundle paths, or authorization flags.
const {createVerifiedTierResolver}=require('./rdw-verified-tier-resolver.cjs');
const {createAuthorizedMirrorStart}=require('./rdw-authorized-mirror-start.cjs');
function createHunterVerifiedRankedStart({db,clock,bundleRoot,verifyBracketInTransaction,enabled=false}={}){
 if(!enabled)return async()=>({ok:false,code:'rdw-disabled'});
 if(typeof verifyBracketInTransaction!=='function')throw Error('trusted-bracket-verifier-required');
 const resolveCurrentTier=createVerifiedTierResolver({db,clock,bundleRoot});
 const resolveVerifiedTiers=async({rosterUids,capturedAt})=>{
  if(!Array.isArray(rosterUids)||rosterUids.length<2||rosterUids.length>320||new Set(rosterUids).size!==rosterUids.length)
   throw Error('trusted-roster-required');
  // Account-grade evidence is read-only and gathered before the write
  // transaction; the transaction rechecks the canonical roster afterward.
  const results=await Promise.all(rosterUids.map(uid=>resolveCurrentTier(uid)));
  return results.map((result,i)=>{
   if(result?.ok!==true||result.uid!==rosterUids[i]||
      result.source!=='server'||result.verified!==true||
      result.complete!==true||result.unresolvedIdentities!==0||
      result.sourceScope!=='public-official-canonical-self-history-v1'||
      !Number.isSafeInteger(result.computedAt)||result.computedAt>capturedAt)
    throw Error('trusted-hunter-tier-unavailable');
   return {ok:true,uid:result.uid,tier:result.tier,computedAt:result.computedAt,
    sourceScope:result.sourceScope,sourceDigest:result.sourceDigest};
  });
 };
 return createAuthorizedMirrorStart({
  db,clock,verifyBracketInTransaction,resolveVerifiedTiers,enabled:true
 });
}
module.exports={createHunterVerifiedRankedStart};
