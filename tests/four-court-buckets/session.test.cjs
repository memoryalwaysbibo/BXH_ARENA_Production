'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),{create,callable}=require('../../modules/scoring/four-court-session.cjs');
test('session cannot start without an explicit client rollout switch',()=>{assert.throws(()=>create({}),/bucket-client-disabled/);});
test('native Callable errors preserve domain reasons and ambiguous network replies',async()=>{
 const make=error=>callable({httpsCallable:()=>async()=>{throw error;}},{},'test');
 assert.equal((await make({code:'functions/failed-precondition',details:{reason:'score-stale'}})({})).reason,'score-stale');
 assert.equal((await make({code:'functions/deadline-exceeded'})({})).reason,'cloud-unavailable');
 assert.equal((await make({code:'functions/unauthenticated'})({})).reason,'authentication-required');
});
test('stopping an old session cannot overwrite a newer cloud binding',()=>{
 const auth={currentUser:{uid:'ref'}},config={enabled:true,auth,db:{app:{options:{projectId:'demo-bxh-four-court-buckets'}}},fs:{doc:()=>({}),onSnapshot:()=>()=>{}},authApi:{onAuthStateChanged:()=>()=>{}},functions:{},functionsApi:{httpsCallable:()=>async()=>({data:{ok:true}})},code:'BXH-SESSION1'};
 const legacy={old:true},host={cloudSync:legacy},session=create(config);session.start(host);const newer={new:true};host.cloudSync=newer;session.stop();assert.equal(host.cloudSync,newer);
 const next=create(config);next.start(host);next.stop();assert.equal(host.cloudSync,newer);
});
