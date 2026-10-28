'use strict';
const ladder=require('./official-ladder-v1.js');
const TIERS=Object.freeze(['ungraded','e','d','c','b','a','s','national']);
const LADDER_TIERS=Object.freeze(ladder.tiers.map(x=>x.name));
function admissionPolicy(input={mode:'review',minLadderTier:null,minTier:null}){
 if(!input||!['auto','review'].includes(input.mode)||Object.keys(input).some(k=>!['mode','minLadderTier','minTier'].includes(k)))throw Error('invalid-admission-mode');
 const {mode}=input,minLadderTier=input.minLadderTier??null,minTier=input.minTier??null;
 if(minLadderTier!==null&&!LADDER_TIERS.includes(minLadderTier))throw Error('invalid-ladder-tier');
 if(minTier!==null&&!TIERS.includes(minTier))throw Error('invalid-min-tier');
 return {mode,minLadderTier,minTier};
}
async function requireEligible({policy,readEligibility,tx,uid}){
 const p=admissionPolicy(policy);if(p.minLadderTier===null&&p.minTier===null)return;
 if(typeof readEligibility!=='function')throw Error('trusted-eligibility-reader-required');
 const data=await readEligibility({tx,uid});if(!data||data.uid!==uid)throw Error('eligibility-unavailable');
 if(p.minLadderTier!==null){if(!Number.isFinite(data.points)||data.points<0)throw Error('eligibility-unavailable');if(LADDER_TIERS.indexOf(ladder.tier(data.points))<LADDER_TIERS.indexOf(p.minLadderTier))throw Error('ladder-tier-below-minimum');}
 if(p.minTier!==null){if(!TIERS.includes(data.tier))throw Error('eligibility-unavailable');if(TIERS.indexOf(data.tier)<TIERS.indexOf(p.minTier))throw Error('tier-below-minimum');}
}
module.exports={TIERS,LADDER_TIERS,admissionPolicy,requireEligible};
