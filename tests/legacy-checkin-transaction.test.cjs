'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const src=fs.readFileSync('modules/cloud/cloud-runtime.js','utf8'),core=fs.readFileSync('modules/main-app/core.js','utf8');
const start=src.indexOf('    async setLegacyCheckin('),end=src.indexOf('    async readStaffRegistrationRoster(',start);
assert(start>0&&end>start);
function fixture(){
 let actor='admin';const base={id:'room1',cloudCode:'BXH-TEST12',meta:{checkinRequired:true},players:[{id:'p1',checkedIn:false},{id:'p2',checkedIn:true}],matches:[{id:'m1',scoreA:0}],courtAssignments:{court1:{status:'idle'}}};
 const publicBase=structuredClone(base);delete publicBase.id;
 const docs={private:{data:JSON.stringify(base)},public:{bracketView:JSON.stringify(publicBase)},reg:{status:'confirmed'}},writes=[];
 const env={cloudEnabled:true,currentUserUidForWrites:()=>actor,dbHandle:{},fx:{doc:(_,...parts)=>parts.join('/'),runTransaction:async(_,fn)=>{
  const queued=[];const result=await fn({get:async path=>{const key=path.includes('/registrations/')?'reg':path.startsWith('publicTournaments/')?'public':'private';return {exists:()=>!!docs[key],data:()=>docs[key]};},update:(path,patch)=>queued.push({path,patch})});
  for(const write of queued){writes.push(write);Object.assign(docs[write.path.startsWith('publicTournaments/')?'public':'private'],write.patch);}return result;
 }}};
 const api=vm.runInNewContext('({'+src.slice(start,end)+'})',env);
 return {docs,writes,env,base,api,setActor:x=>actor=x,run:(checked=true)=>api.setLegacyCheckin('BXH-TEST12','room1','p1',checked),
  edit(fn){const privateState=JSON.parse(docs.private.data),publicState=JSON.parse(docs.public.bracketView);fn(privateState,publicState);docs.private.data=JSON.stringify(privateState);docs.public.bracketView=JSON.stringify(publicState);}};
}
test('legacy attendance changes just the exact player in both fresh server documents',async()=>{
 const h=fixture();h.edit((a,b)=>{a.players[1].name='最新姓名';b.players[1].name='最新姓名';});await h.run();
 assert.equal(h.writes.length,2);for(const s of [JSON.parse(h.docs.private.data),JSON.parse(h.docs.public.bracketView)]){
  assert.equal(s.players[0].checkedIn,true);assert.equal(s.players[1].name,'最新姓名');assert.equal(s.players[1].checkedIn,true);assert.deepEqual(s.matches,h.base.matches);assert.deepEqual(s.courtAssignments,h.base.courtAssignments);
 }
 await h.run();assert.equal(h.writes.length,2,'explicit retry of the same target state needs no write');
 await h.run(false);assert.equal(JSON.parse(h.docs.private.data).players[0].checkedIn,false);assert.equal(JSON.parse(h.docs.public.bracketView).players[0].checkedIn,false);
});
test('QR, onsite and bucket rooms cannot use a legacy write even during a migration race',async()=>{
 for(const marker of [{qrCheckinManaged:true},{onsiteWaitlistServerOwned:true},{scoreStorage:{version:1}}]){
  for(const side of ['private','public','runtime','mirror']){const h=fixture();if(side==='runtime'||side==='mirror')h.edit((a,b)=>Object.assign(side==='runtime'?a:b,marker));else Object.assign(h.docs[side],marker);
   await assert.rejects(h.run(),/managed-checkin-required/);assert.equal(h.writes.length,0);}
 }
});
test('start, closure, archival, cancellation and disabled check-in reject without writes',async()=>{
 for(const patch of [{startedAt:1},{systemClosed:true},{eventCancelled:true},{deletionStatus:'deleting'},{archiveStatus:'completed'},{tournamentPhase:'live'},{meta:{checkinRequired:false}},{meta:{checkinRequired:true,checkinClosedEarly:true}}]){
  const h=fixture();h.edit(a=>Object.assign(a,patch));await assert.rejects(h.run(),/checkin-closed/);assert.equal(h.writes.length,0);
 }
});
test('cancelled online registrations and missing registration IDs cannot be checked in',async()=>{
 for(const status of ['cancelled','waitlist']){const h=fixture();h.edit(a=>Object.assign(a.players[0],{source:'online',registrationId:'reg1'}));h.docs.reg.status=status;await assert.rejects(h.run(),/not-confirmed/);assert.equal(h.writes.length,0);}
 const h=fixture();h.edit(a=>a.players[0].source='online');await assert.rejects(h.run(),/not-confirmed/);assert.equal(h.writes.length,0);
});
test('wrong room, missing/duplicate player or divergent mirrors never changes attendance',async()=>{
 for(const mutate of [h=>h.edit(a=>a.id='other'),h=>h.edit(a=>a.players=[]),h=>h.edit(a=>a.players.push({...a.players[0]})),h=>h.edit((a,b)=>b.players[0].checkedIn=true)]){
  const h=fixture();mutate(h);await assert.rejects(h.run());assert.equal(h.writes.length,0);
 }
});
test('a Rules denial or account change is not converted into a successful local update',async()=>{
 const h=fixture();h.env.fx.runTransaction=async()=>{throw Object.assign(Error('permission-denied'),{code:'permission-denied'});};await assert.rejects(h.run(),/permission-denied/);assert.equal(h.writes.length,0);
 const j=fixture(),transaction=j.env.fx.runTransaction;j.env.fx.runTransaction=async(db,fn)=>transaction(db,tx=>{const get=tx.get;tx.get=async path=>{const value=await get(path);j.setActor('other');return value;};return fn(tx);});await assert.rejects(j.run(),/stale-session/);assert.equal(j.writes.length,0);
});
test('the actual cloud-room button waits for confirmation instead of mutating local attendance',()=>{
 const a=core.indexOf('  if(action==="toggle-checkin-btn"){'),b=core.indexOf('  if(action==="people-toggle-auto-fill")',a),calls=[],modals=[];
 const context={key:'room'};const env={state:{cloudCode:'BXH-TEST12',players:[{id:'p1',name:'測試選手',checkedIn:false}],meta:{}},
  window:{BXHQrCheckin:{managed:()=>false,manual:(...args)=>calls.push(args)}},peopleOnsiteWaitlistManaged:()=>false,captureRegistrationRosterContext:()=>context,registrationRosterContextIsCurrent:c=>c===context,showToast(){throw Error('must not report optimistic success');},openModal:m=>modals.push(m)};
 vm.runInNewContext('function run(action,target){'+core.slice(a,b)+'};run("toggle-checkin-btn",{getAttribute:()=>"p1"});',env);
 assert.equal(env.state.players[0].checkedIn,false);assert.equal(calls.length,1);assert.equal(calls[0][2].legacy,true);
 env.state.players[0].checkedIn=true;vm.runInNewContext('function run(action,target){'+core.slice(a,b)+'};run("toggle-checkin-btn",{getAttribute:()=>"p1"});',env);assert.equal(modals.length,1);assert.equal(calls.length,1);modals[0].onConfirm();assert.equal(calls[1][1],false);
});
