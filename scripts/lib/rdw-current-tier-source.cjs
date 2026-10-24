'use strict';
// RDW P3-12: strict adapter for server-verified CURRENT Hunter License 2.1 tiers.
// Caller must obtain the record from a verified authoritative backend source.
// Does not infer from UI replay, highestTier, name, or a client supplied grade.
const TIERS=new Set(['ungraded','e','d','c','b','a','s','national']);
function verifiedCurrentTier(record,{uid,atMs}={}){
 if(!uid||!Number.isSafeInteger(atMs)||atMs<=0)return {ok:false,reason:'trusted-context-required'};
 if(!record||record.source!=='server'||record.verified!==true||record.version!=='hunter-license-v2.1')return {ok:false,reason:'unverified-license-source'};
 if(record.uid!==uid)return {ok:false,reason:'license-uid-mismatch'};
 if(record.status==='blocked_incomplete_history'||record.status==='needs_review')return {ok:false,reason:'license-review-required'};
 const tier=record.current?.tier;
 if(typeof tier!=='string'||!TIERS.has(tier))return {ok:false,reason:'current-tier-unavailable'};
 if(!Number.isSafeInteger(record.computedAt)||record.computedAt<=0||record.computedAt>atMs)return {ok:false,reason:'invalid-license-timestamp'};
 return {ok:true,uid,tier,computedAt:record.computedAt,version:record.version};
}
module.exports={verifiedCurrentTier};
