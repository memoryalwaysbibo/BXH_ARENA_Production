const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../modules/cloud/cloud-runtime.js'),'utf8');
test('legacy foreground cleanup cannot read or delete any room, including stale expiry with registrations',async()=>{
  const start=source.indexOf('async cleanupMyExpiredCommunityRooms(){');
  const end=source.indexOf('async createRoom(data){',start);
  assert.ok(start>0&&end>start);
  const method=source.slice(start,end).trim().replace(/,$/,'');
  let calls=0;
  const api=vm.runInNewContext('({'+method+'})');
  api.queryMyCommunityEvents=async()=>{calls++;return [{code:'BXH-STALE',expiresAt:{toMillis:()=>0},communityParticipantCount:3}];};
  api.deleteCommunityRoom=async()=>{calls++;};
  const result=await api.cleanupMyExpiredCommunityRooms();
  assert.equal(calls,0);
  assert.equal(result.processed,0);
  assert.equal(result.disabled,true);
});
