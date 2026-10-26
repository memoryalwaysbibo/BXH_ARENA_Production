const test=require('node:test'),assert=require('node:assert/strict');
const {verifiedCurrentTier}=require('../scripts/lib/rdw-current-tier-source.cjs');
const valid={source:'server',verified:true,version:'hunter-license-v2.1',uid:'u1',status:'unchanged',computedAt:100,current:{tier:'c'},highestTier:'national'};
const ctx={uid:'u1',atMs:200};
test('uses current tier, never highest lifetime tier',()=>{assert.equal(verifiedCurrentTier(valid,ctx).tier,'c');});
test('rejects UI replay and unverified evidence',()=>{for(const patch of [{source:'client'},{verified:false},{version:'replay-v2.1'},{uid:'other'},{current:null},{status:'needs_review'},{computedAt:300}])assert.equal(verifiedCurrentTier({...valid,...patch},ctx).ok,false);});
test('ungraded is a valid current tier only with verified source',()=>{assert.equal(verifiedCurrentTier({...valid,current:{tier:'ungraded'}},ctx).tier,'ungraded');});
