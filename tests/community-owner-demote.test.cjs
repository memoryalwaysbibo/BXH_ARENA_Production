'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createRosterService}=require('../qr-checkin/backend/overlays/roster-service.js');

function room(){
 const code='BXH-OWN123';
 const state={id:code,ownerUid:'host',createdBy:'host',meta:{eventAuthority:'community',registrationCapacity:2,registrationStatus:'full',checkinRequired:true},players:[
  {id:'p1',name:'Host',source:'onsite',checkedIn:true},
  {id:'p2',name:'Guest',source:'online',registrationId:'guest',registrationUid:'guest',checkedIn:true}
 ],waitlistPlayers:[],registrationRosterRevision:1};
 const mirror={players:state.players.map(({id,name,checkedIn})=>({id,name,checkedIn})),meta:{registrationCapacity:2,registrationStatus:'full'}};
 const documents=new Map([
  ['users/host',{active:true,role:'player'}],['users/other',{active:true,role:'player'}],
  ['tournaments/'+code,{data:JSON.stringify(state),eventAuthority:'community',ownerUid:'host',createdBy:'host',tournamentPhase:'waiting',capacity:2,confirmedCount:1,waitlistCount:0,registrationStatus:'full',waitlistEnabled:true}],
  ['publicTournaments/'+code,{bracketView:JSON.stringify(mirror),eventAuthority:'community',tournamentPhase:'waiting',capacity:2,confirmedCount:1,waitlistCount:0,registrationStatus:'full'}],
  ['tournaments/'+code+'/registrations/guest',{status:'confirmed',uid:'guest',displayName:'Guest'}]
 ]);
 const ref=path=>({path,collection:name=>({path:path+'/'+name,doc:id=>ref(path+'/'+name+'/'+id)})});
 const db={doc:ref,runTransaction:async handler=>{
  const writes=[];
  const tx={get:async target=>target.path.endsWith('/registrations')?
   {docs:[...documents.entries()].filter(([key])=>key.startsWith(target.path+'/')).map(([key,value])=>({id:key.slice(target.path.length+1),ref:ref(key),data:()=>structuredClone(value)}))}:
   {exists:documents.has(target.path),data:()=>structuredClone(documents.get(target.path))},
   update:(target,patch)=>writes.push(()=>documents.set(target.path,{...documents.get(target.path),...patch})),
   create:(target,value)=>writes.push(()=>{assert(!documents.has(target.path));documents.set(target.path,value);})};
  const result=await handler(tx);writes.forEach(write=>write());return result;
 }};
 return {code,documents,run:createRosterService(db,{serverTimestamp:()=>1234},()=>1234)};
}

test('community player owner demotes an online entrant atomically and replay does not double count',async()=>{
 const {code,documents,run}=room();
 const request={auth:{uid:'host'},data:{code,action:'demote',intent:'admin',registrationId:'guest',operationId:'demote-owner-001'}};
 const result=await run(request);
 assert.equal(result.status,'waitlist');assert.equal(result.confirmedCount,0);assert.equal(result.waitlistCount,1);
 const t=documents.get('tournaments/'+code),p=documents.get('publicTournaments/'+code);
 assert.equal(t.confirmedCount,0);assert.equal(p.waitlistCount,1);assert.equal(t.registrationStatus,'open');
 assert.equal(documents.get('tournaments/'+code+'/registrations/guest').waitRank,1);
 assert.equal(JSON.parse(t.data).players.some(row=>row.registrationId==='guest'),false);
 assert.equal(JSON.parse(t.data).waitlistPlayers[0].checkedIn,true);
 assert.deepEqual(JSON.parse(p.bracketView).players.map(row=>row.id),['p1']);
 const replay=await run(request);assert.equal(replay.replayed,true);assert.equal(documents.get('tournaments/'+code).waitlistCount,1);
});

test('another player cannot demote a community entrant',async()=>{
 const {code,documents,run}=room();
 await assert.rejects(run({auth:{uid:'other'},data:{code,action:'demote',intent:'admin',registrationId:'guest',operationId:'demote-other-001'}}),/permission-denied/);
 assert.equal(documents.get('tournaments/'+code).confirmedCount,1);
});

test('quick registration with an onsite host retains its capacity and participant count',async()=>{
 const {code,documents,run}=room();
 const t=documents.get('tournaments/'+code),p=documents.get('publicTournaments/'+code);
 Object.assign(t,{communityQuickRegistration:true,registrationOpenAt:null,registrationCloseAt:null,cancellationDeadline:null,communityParticipantCount:2});
 Object.assign(p,{communityQuickRegistration:true,registrationOpenAt:null,registrationCloseAt:null,cancellationDeadline:null,communityParticipantCount:2});
 const outcome=await run({auth:{uid:'host'},data:{code,action:'demote',intent:'admin',registrationId:'guest',operationId:'demote-quick-001'}});
 assert.equal(outcome.capacity,2);
 assert.equal(documents.get('tournaments/'+code).communityParticipantCount,1);
 assert.equal(JSON.parse(documents.get('tournaments/'+code).data).communityParticipantCount,1);
 assert.equal(JSON.parse(documents.get('publicTournaments/'+code).bracketView).communityParticipantCount,1);
});
