'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {documents}=require('./create-room.cjs');
const {createPublishHandler}=require('./publish-room.cjs');
function fixture(version=3){
 const code='BXH-ABC123',room='tournaments/'+code,pub='publicTournaments/'+code,now=Date.parse('2027-01-01T09:00+08:00');
 const input={name:'V3',location:'Arena',capacity:192,stations:4,eventDate:'2027-01-01',startAt:'13:00',registrationOpenAt:now-1000,registrationCloseAt:now+3600000,cancellationDeadline:now+3600000};
 const x=documents({input,code,owner:'admin',roomId:'id',now});
 const data=new Map([[room,{...x.privateRoom,registrationFlowVersion:version}],[pub,{...x.publicRoom,registrationFlowVersion:version}],[room+'/registrationV3State/ledger',x.ledger],['users/admin',{active:true,role:'super_admin'}],['users/player',{active:true,role:'player'}]]);
 const ref=path=>({path,collection:n=>ref(path+'/'+n),doc:n=>ref(path+'/'+n)});
 const db={doc:ref,runTransaction:async fn=>{
  const draft=structuredClone(data),result=await fn({getAll:async(...refs)=>refs.map(r=>({exists:draft.has(r.path),data:()=>draft.get(r.path)})),update:(r,v)=>draft.set(r.path,{...draft.get(r.path),...v})});
  for(const [k,v] of draft)data.set(k,v);return result;
 }};
 const publish=createPublishHandler({db,clock:()=>now});
 return {data,room,pub,call:(uid='admin')=>publish({auth:{uid},app:{},data:{code}})};
}
test('authorized draft publication atomically enables both room copies',async()=>{
 const f=fixture();assert.equal((await f.call()).registrationStatus,'open');
 for(const path of [f.room,f.pub]){const doc=f.data.get(path);assert.equal(doc.registrationEnabled,true);assert.equal(doc.visibility,'public');}
 assert.equal(JSON.parse(f.data.get(f.room).data).meta.registrationEnabled,true);
 assert.equal((await f.call()).replayed,true);
});
test('legacy rooms and unrelated players cannot publish through V3',async()=>{
 for(const v of [1,2]){const f=fixture(v),before=structuredClone(f.data);await assert.rejects(f.call(),/registration-v3-required/);assert.deepEqual(f.data,before);}
 const f=fixture(),before=structuredClone(f.data);await assert.rejects(f.call('player'),/permission-denied/);assert.deepEqual(f.data,before);
});
