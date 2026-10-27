'use strict';
const TIERS=Object.freeze(['ungraded','e','d','c','b','a','s','national']);
function admissionPolicy(input={mode:'review',minPoints:null,minTier:null}){
 if(!input||!['auto','review'].includes(input.mode))throw Error('invalid-admission-mode');
 const {mode}=input,minPoints=input.minPoints??null,minTier=input.minTier??null;
 if(minPoints!==null&&(!Number.isFinite(minPoints)||minPoints<0))throw Error('invalid-min-points');
 if(minTier!==null&&!TIERS.includes(minTier))throw Error('invalid-min-tier');
 return {mode,minPoints,minTier};
}
async function requireEligible({policy,readEligibility,tx,uid}){
 const p=admissionPolicy(policy);if(p.minPoints===null&&p.minTier===null)return;
 if(typeof readEligibility!=='function')throw Error('trusted-eligibility-reader-required');
 // Adapter must read authoritative settled records in this transaction, not request data.
 const data=await readEligibility({tx,uid});
 if(!data||data.uid!==uid)throw Error('eligibility-unavailable');
 if(p.minPoints!==null){if(!Number.isFinite(data.points))throw Error('eligibility-unavailable');if(data.points<p.minPoints)throw Error('points-below-minimum');}
 if(p.minTier!==null){if(!TIERS.includes(data.tier))throw Error('eligibility-unavailable');if(TIERS.indexOf(data.tier)<TIERS.indexOf(p.minTier))throw Error('tier-below-minimum');}
}
module.exports={TIERS,admissionPolicy,requireEligible};
