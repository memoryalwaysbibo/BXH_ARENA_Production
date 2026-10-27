'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');const {admissionPolicy,requireEligible,LADDER_TIERS}=require('./admission.cjs');
test('actual ladder tiers are ordered and points thresholds match official V1',async()=>{
 assert.deepEqual(LADDER_TIERS,['未定級','青銅','白銀','黃金','白金','鑽石','大師','宗師']);
 const p={mode:'auto',minLadderTier:'白金',minTier:'b'},tx={};
 await assert.rejects(requireEligible({policy:p,tx,uid:'u',readEligibility:async()=>({uid:'u',points:599,tier:'b'})}),/ladder-tier-below/);
 await requireEligible({policy:p,tx,uid:'u',readEligibility:async()=>({uid:'u',points:600,tier:'b'})});
 await assert.rejects(requireEligible({policy:p,tx,uid:'u',readEligibility:async()=>({uid:'u',points:600,tier:null})}),/eligibility-unavailable/);
});
test('obsolete numeric criteria and invalid dropdown values are refused',()=>{
 assert.throws(()=>admissionPolicy({mode:'auto',minPoints:500}),/invalid-admission/);assert.throws(()=>admissionPolicy({mode:'auto',minLadderTier:'傳奇'}),/invalid-ladder-tier/);
 assert.deepEqual(admissionPolicy({mode:'auto'}),{mode:'auto',minLadderTier:null,minTier:null});
});
