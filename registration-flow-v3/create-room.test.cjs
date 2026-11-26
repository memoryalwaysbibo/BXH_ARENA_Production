'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createRoomHandler}=require('./create-room.cjs');
function fixture(role='super_admin'){
 const data=new Map([['users/actor',{active:true,role}]]);
 const ref=path=>({path,collection:n=>ref(path+'/'+n),doc:n=>ref(path+'/'+n)});
 const db={doc:ref,async runTransaction(fn){
  const draft=structuredClone(data);
  const result=await fn({getAll:async(...refs)=>refs.map(r=>({exists:draft.has(r.path),data:()=>draft.get(r.path)})),
   create:(r,v)=>{assert(!draft.has(r.path));draft.set(r.path,v);}});
  for(const [k,v] of draft)data.set(k,v);return result;
 }};
 const create=createRoomHandler({db,newCode:()=> 'BXH-ABC123',newId:()=> 'new-room'});
 const input={operationId:'create-001',name:'V3',location:'Arena',stations:4,capacity:192,registrationOpenAt:10,registrationCloseAt:100,cancellationDeadline:90};
 return {data,call:(patch={},app={})=>create({auth:{uid:'actor'},app,data:{...input,...patch}})};
}
test('super admin atomically creates new V3 draft and zero ledger; replay is safe',async()=>{
 const f=fixture(),r=await f.call();
 assert.equal(r.code,'BXH-ABC123');
 const room=f.data.get('tournaments/'+r.code),pub=f.data.get('publicTournaments/'+r.code),ledger=f.data.get('tournaments/'+r.code+'/registrationV3State/ledger');
 assert.equal(room.ownerUid,'actor');assert.equal(room.registrationFlowVersion,3);
 assert.equal(pub.registrationFlowVersion,3);assert.equal(pub.visibility,'private');
 assert.equal(ledger.capacity,192);assert.equal(ledger.occupiedCount,0);
 assert.equal((await f.call()).replayed,true);
 await assert.rejects(f.call({name:'Changed'}),/operation-conflict/);
});
test('ordinary admins cannot create V3 and App Check is required',async()=>{
 const f=fixture('admin');await assert.rejects(f.call(),/super-admin-required/);assert.equal(f.data.size,1);
 await assert.rejects(fixture().call({},null),/app-check-required/);
});
test('existing legacy room code never overwritten',async()=>{
 const f=fixture();f.data.set('tournaments/BXH-ABC123',{registrationFlowVersion:2});
 await assert.rejects(f.call(),/room-code-conflict/);
 assert.equal(f.data.get('tournaments/BXH-ABC123').registrationFlowVersion,2);
});
