'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),{create}=require('../../modules/scoring/four-court-firestore-transport.cjs');
function setup(){
 const auth={currentUser:{uid:'ref'}},callbacks=new Set(),watches=[],events=[],errors=[];let stops=0;
 const transport=create({db:{app:{options:{projectId:'demo-bxh-four-court-buckets'}}},auth,authApi:{onAuthStateChanged(_auth,next){callbacks.add(next);return ()=>callbacks.delete(next);}},fs:{doc:(_db,...parts)=>parts.join('/'),onSnapshot(ref,options,next,error){watches.push({ref,options,next,error});return ()=>stops++;}},commitScore:async()=>({ok:true}),manageSeats:async()=>({ok:true})});
 const snapshot=(data,metadata={fromCache:false,hasPendingWrites:false})=>({exists:()=>true,data:()=>data,metadata});
 return {transport,auth,callbacks,watches,events,errors,snapshot,stops:()=>stops};
}
test('Web SDK transport uses public numeric room version and preserves cache metadata',()=>{
 const h=setup(),stop=h.transport.watchRoom('BXH-TEST01',event=>h.events.push(event),error=>h.errors.push(error));
 h.watches[0].next(h.snapshot({updatedAt:100,data:'{}'},{fromCache:true,hasPendingWrites:false}));
 assert.equal(h.events[0].version,'100');assert.equal(h.events[0].fromCache,true);assert.equal(h.watches[0].options.includeMetadataChanges,true);stop();assert.equal(h.stops(),1);
});
test('account switch stops existing subscriptions and never sends as the new user',async()=>{
 const h=setup();h.transport.watchBucket('BXH-TEST01','court-1',event=>h.events.push(event),error=>h.errors.push(error));
 h.auth.currentUser={uid:'other'};for(const callback of [...h.callbacks])callback(h.auth.currentUser);
 assert.equal(h.stops(),1);assert.equal(h.errors[0].message,'auth-changed');
 h.watches[0].next(h.snapshot({matches:'[]'}));assert.equal(h.events.length,0);
 assert.equal((await h.transport.commitScore({})).reason,'auth-changed');assert.equal((await h.transport.manageSeats({})).reason,'auth-changed');
});
test('malformed room versions and unsafe bucket paths fail closed',()=>{
 const h=setup();h.transport.watchRoom('BXH-TEST01',event=>h.events.push(event),error=>h.errors.push(error));
 h.watches[0].next(h.snapshot({updatedAt:1.5,data:'{}'}));assert.equal(h.events.length,0);assert.equal(h.errors[0].message,'room-version-missing');assert.equal(h.stops(),1);
 assert.throws(()=>h.transport.watchBucket('BXH-TEST01','court-1/other',()=>{},()=>{}),/invalid-bucket/);
 assert.throws(()=>create({auth:{currentUser:null}}),/auth-required/);
});
