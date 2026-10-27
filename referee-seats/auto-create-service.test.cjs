'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {createHandler}=require('./auto-create-service.cjs');
const clone=v=>v==null?v:JSON.parse(JSON.stringify(v));
function harness(){
 const docs=new Map([['users/admin',{active:true,role:'admin',realName:'Admin'}],['users/staff',{active:true,role:'staff',realName:'Staff'}],['systemConfig/refereeSeatsV1',{enabled:true,perCourtScoringVerified:true}]]);
 let tail=Promise.resolve();
 const db={doc:path=>({path}),runTransaction:fn=>{const task=tail.then(async()=>{const writes=[],out=await fn({
  get:async ref=>({exists:docs.has(ref.path),data:()=>clone(docs.get(ref.path))}),
  create:(ref,data)=>writes.push(()=>{assert(!docs.has(ref.path));docs.set(ref.path,clone(data));})
 });writes.forEach(x=>x());return out;});tail=task.catch(()=>{});return task;}};
 const state={id:'new',meta:{eventAuthority:'official',battleMode:'individual',playMode:'standard',stations:3,assignedStaffUids:[]},players:[],matches:[],bracketSize:0};
 const payload={code:'BXH-ABCD12',operationId:'unique-create-operation-001',
  privatePayload:{data:JSON.stringify(state),createdBy:'admin',eventAuthority:'official',battleMode:'individual',playMode:'standard',confirmedCount:0,waitlistCount:0},
  publicPayload:{bracketView:JSON.stringify({meta:{eventAuthority:'official',battleMode:'individual',stations:3}}),eventAuthority:'official',battleMode:'individual'}};
 const handle=createHandler(db,{clock:()=>1000});
 const run=(uid='admin',override={})=>handle({auth:{uid},data:{...clone(payload),...override}});
 return {docs,payload,run};
}
test('atomically creates private and public seats, no UID leaked to mirror',async()=>{
 const h=harness();assert.deepEqual(await h.run(),{ok:true,code:'BXH-ABCD12',idempotent:false});
 const privateDoc=h.docs.get('tournaments/BXH-ABCD12'),pub=h.docs.get('publicTournaments/BXH-ABCD12');
 assert.equal(privateDoc.refereeSeatsV1.version,1);
 assert.equal(Object.keys(privateDoc.refereeSeatsV1.courts).length,3);
 assert.equal(JSON.parse(privateDoc.data).meta.refereeSeatsV1.version,1);
 assert.deepEqual(privateDoc.assignedStaffUids,['admin']);
 assert.equal(JSON.parse(pub.bracketView).meta.refereeSeatNames['1'].main,null);
 assert(!pub.bracketView.includes('"uid"'));assert(!pub.bracketView.includes('refereeSeatsV1'));
});
test('same operation retries idempotently and cannot mutate existing room',async()=>{
 const h=harness();await h.run();const original=clone(h.docs.get('tournaments/BXH-ABCD12'));
 assert.deepEqual(await h.run(),{ok:true,code:'BXH-ABCD12',idempotent:true});
 assert.deepEqual(h.docs.get('tournaments/BXH-ABCD12'),original);
 await assert.rejects(h.run('admin',{operationId:'unique-create-operation-002'}),/room-code-conflict/);
 await assert.rejects(h.run('admin',{privatePayload:{...h.payload.privatePayload,fee:999}}),/operation-conflict/);
});
test('players, disabled and test identities cannot create',async()=>{
 const h=harness();await assert.rejects(h.run('anonymous'),/permission-denied/);
 h.docs.set('users/player',{active:true,role:'player'});
 await assert.rejects(h.run('player'),/permission-denied/);
 h.docs.get('users/admin').active=false;await assert.rejects(h.run(),/permission-denied/);
 assert(!h.docs.has('tournaments/BXH-ABCD12'));
});
test('unsupported room and inconsistent mirror fail without writing either document',async()=>{
 const h=harness(),p=h.payload;
 await assert.rejects(h.run('admin',{privatePayload:{...p.privatePayload,createdBy:'other'}}),/owner-mismatch/);
 await assert.rejects(h.run('admin',{publicPayload:{...p.publicPayload,battleMode:'team'}}),/unsupported-mode/);
 await assert.rejects(h.run('admin',{publicPayload:{...p.publicPayload,bracketView:JSON.stringify({meta:{eventAuthority:'official',battleMode:'individual',stations:2}})}}),/mirror-mismatch/);
 assert(!h.docs.has('tournaments/BXH-ABCD12'));assert(!h.docs.has('publicTournaments/BXH-ABCD12'));
});
test('release gate and concurrent same-code create fail closed',async()=>{
 const h=harness();h.docs.get('systemConfig/refereeSeatsV1').enabled=false;
 await assert.rejects(h.run(),/release-not-ready/);assert(!h.docs.has('tournaments/BXH-ABCD12'));
 h.docs.get('systemConfig/refereeSeatsV1').enabled=true;
 const r=await Promise.allSettled([h.run('admin',{operationId:'unique-create-operation-001'}),h.run('admin',{operationId:'unique-create-operation-002'})]);
 assert.equal(r.filter(x=>x.status==='fulfilled').length,1);
 assert.equal(r.filter(x=>x.status==='rejected').length,1);
});

test('public payload rejects unexpected fields and nested private identities',async()=>{
 const h=harness(),p=h.payload;
 await assert.rejects(h.run('admin',{publicPayload:{...p.publicPayload,secretToken:'no'}}),/private-mirror-data/);
 await assert.rejects(h.run('admin',{publicPayload:{...p.publicPayload,bracketView:JSON.stringify({meta:{eventAuthority:'official',battleMode:'individual',stations:3},private:{uid:'secret'}})}}),/private-mirror-data/);
 assert(!h.docs.has('tournaments/BXH-ABCD12'));assert(!h.docs.has('publicTournaments/BXH-ABCD12'));
});

test('new room rejects forged ownership and stale seat permissions',async()=>{
 const h=harness(),p=h.payload;
 await assert.rejects(h.run('admin',{privatePayload:{...p.privatePayload,ownerUid:'other'}}),/owner-mismatch/);
 await assert.rejects(h.run('admin',{privatePayload:{...p.privatePayload,refereeSeatsV1:{version:1}}}),/protected-create-field/);
 const state=JSON.parse(p.privatePayload.data);
 state.meta.refereeStationRestrictionEnabled=true;
 await assert.rejects(h.run('admin',{privatePayload:{...p.privatePayload,data:JSON.stringify(state)}}),/protected-create-field/);
 assert(!h.docs.has('tournaments/BXH-ABCD12'));
});
test('new room rejects prestarted, populated and forged public mirror payloads',async()=>{
 const h=harness(),p=h.payload;
 const state=JSON.parse(p.privatePayload.data);
 state.startedAt=123;
 await assert.rejects(h.run('admin',{privatePayload:{...p.privatePayload,data:JSON.stringify(state)}}),/not-empty-room/);
 const mirror=JSON.parse(p.publicPayload.bracketView);
 mirror.players=[{id:'forged'}];
 await assert.rejects(h.run('admin',{publicPayload:{...p.publicPayload,bracketView:JSON.stringify(mirror)}}),/mirror-mismatch/);
 delete mirror.players;
 mirror.internalNotes='secret';
 await assert.rejects(h.run('admin',{publicPayload:{...p.publicPayload,bracketView:JSON.stringify(mirror)}}),/private-mirror-data/);
 assert(!h.docs.has('publicTournaments/BXH-ABCD12'));
});

test('official Staff creator may initialize own room, not another account room',async()=>{
 const h=harness(),p=h.payload;
 const state=JSON.parse(p.privatePayload.data);state.createdBy='staff';
 const own={...p.privatePayload,createdBy:'staff',data:JSON.stringify(state)};
 assert.deepEqual(await h.run('staff',{privatePayload:own}),{ok:true,code:'BXH-ABCD12',idempotent:false});
 assert.equal(h.docs.get('tournaments/BXH-ABCD12').createdBy,'staff');
 assert.deepEqual(h.docs.get('tournaments/BXH-ABCD12').assignedStaffUids,['staff']);
});
test('privileged create fields cannot bypass client Firestore rules',async()=>{
 const h=harness(),p=h.payload;
 for(const patch of [{qrCheckinManaged:true},{registrationSelection:{status:'drawing'}},{systemClosed:true},{refereeSeatNames:{}}])
  await assert.rejects(h.run('admin',{privatePayload:{...p.privatePayload,...patch}}),/protected-create-field/);
 assert(!h.docs.has('tournaments/BXH-ABCD12'));
});
