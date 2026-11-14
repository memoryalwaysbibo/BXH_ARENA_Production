'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {assertEmptyDemoScope,run}=require('./rdw-hunter-real-pair-emulator.cjs');
function scopedDb(nonEmpty){
 const visited=[];
 return {visited,collection:name=>{
  visited.push(name);
  return {limit:n=>{
   assert.equal(n,1);
   return {get:async()=>({empty:nonEmpty===name?false:true,size:nonEmpty===name?1:0})};
  }};
 }};
}
test('manual real Reader pair runner demands a fresh empty demo database',async()=>{
 const names=['publicTournaments','hunterLicenseAwards','rdwHunterShadowBaselines'];
 const empty=scopedDb(null);
 await assertEmptyDemoScope(empty);
 assert.deepEqual(empty.visited,names);
 for(const name of names){
  const db=scopedDb(name);
  await assert.rejects(assertEmptyDemoScope(db),new RegExp('emulator-collection-not-empty:'+name));
 }
});
test('manual real Reader pair runner refuses live and unconfigured Firestore',async()=>{
 await assert.rejects(run({db:{projectId:'bxh-arena'}}),
  /auth-and-firestore-emulators-required|isolated-emulator-project-required/);
});
