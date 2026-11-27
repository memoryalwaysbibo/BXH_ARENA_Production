'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createGuardedLegacyWriter,registrationQueueOwnsRoom}=require('../registration-flow-v2/backend/legacy-writer.cjs');
test('V3 write guard does not redefine V2 ownership',async()=>{
 let version=3,writes=0;
 const db={doc:path=>path,runTransaction:fn=>fn({get:async()=>({data:()=>version===2?{registrationQueueVersion:2}:{registrationFlowVersion:version}})})};
 const writer=createGuardedLegacyWriter({db,isMutation:action=>action==='join',makeHandler:store=>request=>store.runTransaction(async()=>{writes++;return {ok:true};})});
 const request={data:{code:'BXH-ABC123',action:'join'}};
 await assert.rejects(writer(request),/registration-v3-required/);
 assert.equal(writes,0);
 assert.equal(registrationQueueOwnsRoom({registrationFlowVersion:3}),false);
 version=1;assert.equal((await writer(request)).ok,true);
 version=2;await assert.rejects(writer(request),/registration-queue-required/);
 assert.equal(writes,1);
});
