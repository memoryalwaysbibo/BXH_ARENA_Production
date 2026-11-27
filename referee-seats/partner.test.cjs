'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {createHandler}=require('./functions/service.cjs'),{createScoringHandler}=require('./functions/scoring-service.cjs');
const E=require('./functions/event-staff-core.cjs');
const clone=x=>x===undefined?undefined:JSON.parse(JSON.stringify(x));
function fixture(){
 let now=1000,seq=0,tail=Promise.resolve();
 const owner={active:true,role:'player',partnerOrganizer:{status:'active',organizationId:'org-a',orderCode:'contract-a',startsAtMs:100,expiresAtMs:10000}};
 const room={createdBy:'host',createdByRole:'partner_organizer',eventAuthority:'official',partnerOrganizationCode:'org-a',partnerContractOrderCode:'contract-a',assignedStaffUids:['host'],refereeStationAssignments:{},eventStaffAssignments:{},updatedAt:1};
 const state={id:'partner',cloudCode:'BXH-PARTNER',meta:{name:'Partner',eventAuthority:'official',battleMode:'individual',playMode:'standard',formatType:'roundrobin',stations:2},startedAt:1,players:[{id:'a',name:'A'},{id:'b',name:'B'}],matches:[{id:'m',station:1,bracket:'RR',round:0,seq:1,a:{playerId:'a'},b:{playerId:'b'},scoreA:0,scoreB:0,log:[],completed:false,status:'in_progress'}],courtAssignments:{court1:{currentMatchId:'m',nextMatchId:null},court2:{currentMatchId:null,nextMatchId:null}}};
 room.data=JSON.stringify(state);
 const docs=new Map([['tournaments/BXH-PARTNER',room],['publicTournaments/BXH-PARTNER',{bracketView:JSON.stringify(state)}],['users/host',owner],['systemConfig/refereeSeatsV1',{enabled:true,perCourtScoringVerified:true,partnerSeatsEnabled:true}]]);
 for(const [uid,duties] of [['main',['referee']],['backup',['head_referee']],['other',['referee']],['checkin',['checkin']],['assistant',['event_assistant']]]){
  docs.set('users/'+uid,{active:true,role:'player',realName:uid});
  room.eventStaffAssignments[uid]={...E.makeInvitation({eventCode:'BXH-PARTNER',targetUid:uid,organizerUid:'host',organizerProfile:owner,tournament:room,duties,now}),status:'accepted'};
 }
 const ref=path=>({path,collection:name=>({doc:id=>ref(path+'/'+name+'/'+id)})});
 const db={doc:ref,runTransaction:fn=>{const task=tail.then(async()=>{const writes=[];let writing=false;const tx={get:async r=>{assert(!writing,'all authorization reads precede writes');return {exists:docs.has(r.path),data:()=>clone(docs.get(r.path))};},update:(r,p)=>{writing=true;writes.push(()=>docs.set(r.path,{...docs.get(r.path),...clone(p)}));},create:(r,p)=>{writing=true;writes.push(()=>{assert(!docs.has(r.path));docs.set(r.path,clone(p));});},set:(r,p)=>{writing=true;writes.push(()=>docs.set(r.path,clone(p)));}};const out=await fn(tx);writes.forEach(w=>w());return out;});tail=task.catch(()=>{});return task;}};
 const handle=createHandler(db,{clock:()=>now,uuid:()=> 'request-'+(++seq)}),scoreHandle=createScoringHandler(db,{clock:()=>now});
 const doc=()=>docs.get('tournaments/BXH-PARTNER'),profile=uid=>docs.get('users/'+uid),assignment=uid=>doc().eventStaffAssignments[uid];
 const command=(uid,action,args={})=>({auth:{uid},data:{code:'BXH-PARTNER',operationId:'partner-operation-'+(++seq),action,...args}});
 const run=(uid,action,args={})=>handle(command(uid,action,args));
 const seat=(uid,action,slot,args={})=>{const court=doc().refereeSeatsV1.courts[1];return run(uid,action,{station:1,slot,expectedCourtRevision:court.revision,expectedUid:court[slot]?.uid,...args});};
 const scoreRequest=(uid='main')=>command(uid,'score',{station:1,matchId:'m',expectedCourtRevision:doc().refereeSeatsV1.courts[1].revision,expectedScoreRevision:JSON.parse(doc().data).matches[0].refereeSeatScoreRevision||0,expectedDispatchRevision:0,playerAId:'a',playerBId:'b',side:'A',finish:'spin'});
 const snapshot=()=>JSON.stringify([...docs]);
 return {docs,doc,profile,assignment,handle,scoreHandle,command,run,seat,scoreRequest,snapshot,time:t=>now=t};
}
async function ready(){const f=fixture();await f.run('host','enable');return f;}
async function deniesWithoutWrites(f,promise,reason){const before=f.snapshot();await assert.rejects(promise,reason);assert.equal(f.snapshot(),before);}
test('partner host enables two courts, three accepted referees join, and only their own court can score',async()=>{
 const f=await ready();await f.seat('main','claim','main');await f.seat('backup','claim','backup1');await f.seat('other','claim','backup2');
 assert.equal(f.doc().refereeStationUids.length,3);assert.equal(f.doc().refereeSeatsV1.courts[2].main,null);
 await f.scoreHandle(f.scoreRequest());assert.equal(JSON.parse(f.doc().data).matches[0].scoreA,1);
 const r=f.scoreRequest('backup');r.data.station=2;await deniesWithoutWrites(f,f.scoreHandle(r),/station-mismatch|station-not-assigned/);
 const mirror=JSON.parse(f.docs.get('publicTournaments/BXH-PARTNER').bracketView);assert(!mirror.meta.refereeSeatsV1);assert(!mirror.meta.assignedStaffUids);assert(!mirror.meta.eventStaffAssignments);
});
test('partner host retains management and scoring without occupying a fourth seat',async()=>{const f=await ready();await f.seat('main','claim','main');await f.scoreHandle(f.scoreRequest('host'));await f.seat('host','revoke','main');assert.equal(f.doc().refereeSeatsV1.courts[1].main,null);});
test('accepted referees exchange main and backup, main revokes backup, and holder can leave',async()=>{const f=await ready();await f.seat('main','claim','main');await f.seat('backup','claim','backup1');const r=await f.seat('backup','request','main');await f.seat('main','respond','main',{requestId:r.requestId,response:'accept'});assert.equal(f.doc().refereeSeatsV1.courts[1].main.uid,'backup');await f.seat('backup','revoke','backup1');await f.seat('backup','leave','main');});
for(const uid of ['checkin','assistant'])test(uid+' duty alone cannot join or score',async()=>{const f=await ready();await deniesWithoutWrites(f,f.seat(uid,'claim','main'),/not-event-staff/);await deniesWithoutWrites(f,f.scoreHandle(f.scoreRequest(uid)),/station-not-assigned/);});
for(const status of ['invited','rejected','revoked'])test(status+' invitation cannot join despite forged user memberships',async()=>{const f=await ready();f.assignment('main').status=status;f.profile('main').eventStaffMemberships={'BXH-PARTNER':{...f.assignment('main'),status:'accepted'}};await deniesWithoutWrites(f,f.seat('main','claim','main'),/not-event-staff/);});
for(const mutate of [f=>{delete f.doc().eventStaffAssignments.main;},f=>{f.assignment('main').organizerUid='other-host';},f=>{f.assignment('main').organizationId='other-org';},f=>{f.assignment('main').parentFingerprint='contract:other';},f=>{f.assignment('main').parentExpiresAtMs=20000;},f=>{f.profile('host').partnerOrganizer.expiresAtMs=20000;},f=>{f.doc().partnerContractOrderCode='other';}])test('room-bound grant mismatch fails closed: '+mutate.toString(),async()=>{const f=await ready();mutate(f);await deniesWithoutWrites(f,f.seat('main','claim','main'),/not-event-staff/);});
for(const change of [f=>f.time(10000),f=>{f.profile('host').partnerOrganizer.status='revoked';},f=>{f.profile('host').active=false;},f=>{f.profile('host').partnerOrganizer.startsAtMs=2000;},f=>{f.profile('main').accountStatus='frozen';},f=>{f.profile('main').isTestAccount=true;},f=>{f.assignment('main').status='revoked';},f=>{f.assignment('main').duties=['checkin'];}])test('seated referee loses scoring and receipt replay after authorization loss: '+change.toString(),async()=>{
 const f=await ready();await f.seat('main','claim','main');const r=f.scoreRequest();await f.scoreHandle(r);change(f);await deniesWithoutWrites(f,f.scoreHandle(r),/station-not-assigned/);await deniesWithoutWrites(f,f.seat('main','claim','backup1'),/not-event-staff/);
});
test('revoked requester cannot receive an accepted handoff',async()=>{const f=await ready();await f.seat('main','claim','main');const r=await f.seat('backup','request','main');f.assignment('backup').status='revoked';await deniesWithoutWrites(f,f.seat('main','respond','main',{requestId:r.requestId,response:'accept'}),/requester-ineligible/);});
test('revoked holder cannot accept handoff and expired host cannot enable or manage',async()=>{const f=await ready();await f.seat('main','claim','main');const r=await f.seat('backup','request','main');f.assignment('main').status='revoked';await deniesWithoutWrites(f,f.seat('main','respond','main',{requestId:r.requestId,response:'accept'}),/not-event-staff/);f.time(10000);await deniesWithoutWrites(f,f.seat('host','revoke','main'),/not-event-staff/);});
test('only host or BXH administrator can enable; head referee cannot resize courts',async()=>{const f=fixture();await deniesWithoutWrites(f,f.run('backup','enable'),/permission-denied/);await f.run('host','enable');const r=f.command('backup','resize',{count:3});await deniesWithoutWrites(f,f.scoreHandle(r),/station-not-assigned/);});
test('rollout gate rejects absent or false partner flag while regular official rooms retain operation',async()=>{for(const flag of [undefined,false]){const f=fixture();f.docs.get('systemConfig/refereeSeatsV1').partnerSeatsEnabled=flag;await deniesWithoutWrites(f,f.run('host','enable'),/partner-release-not-ready/);f.doc().createdByRole='staff';f.profile('host').role='staff';await f.run('host','enable');}});
test('same-seat concurrency and idempotency retain one authoritative outcome',async()=>{const f=await ready();const r=f.command('main','claim',{station:1,slot:'main',expectedCourtRevision:0});const results=await Promise.allSettled([f.handle(r),f.handle(r),f.seat('backup','claim','main')]);assert.equal(results.filter(x=>x.status==='fulfilled').length,2);assert.equal(f.doc().refereeSeatsV1.courts[1].main.uid,'main');});
test('partner seat and score operations never update contract quota or start snapshots',async()=>{const f=await ready();f.docs.set('partnerContracts/contract-a',{usedEvents:2});await f.seat('main','claim','main');await f.scoreHandle(f.scoreRequest());assert.deepEqual(f.docs.get('partnerContracts/contract-a'),{usedEvents:2});assert.equal(JSON.parse(f.doc().data).startedAt,1);});

for(const patch of [{scope:'contract',orderCode:''},{organizationId:42},{expiresAtMs:'10000'},{startsAtMs:'invalid'},{startsAtMs:Infinity}])test('malformed partner grant cannot enable or authorize invited referee: '+JSON.stringify(patch),async()=>{const f=await ready();Object.assign(f.profile('host').partnerOrganizer,patch);await deniesWithoutWrites(f,f.seat('main','claim','main'),/not-event-staff/);await deniesWithoutWrites(f,f.seat('host','claim','main'),/not-event-staff/);});
test('manual partner authorization retains event-scoped three seats without a contract',async()=>{const f=fixture();const grant=f.profile('host').partnerOrganizer;delete grant.orderCode;grant.scope='manual';f.doc().partnerContractOrderCode=null;for(const a of Object.values(f.doc().eventStaffAssignments)){a.parentOrderCode=null;a.parentFingerprint=E.parentFingerprint(f.profile('host'));}await f.run('host','enable');await f.seat('main','claim','main');await f.scoreHandle(f.scoreRequest());});
test('forged request authority cannot turn an uninvited player into a referee',async()=>{const f=await ready();delete f.doc().eventStaffAssignments.main;const r=f.command('main','claim',{station:1,slot:'main',expectedCourtRevision:0,authority:{partnerEnabled:true,parentUser:f.profile('host')},user:{role:'admin'},eventStaffAssignment:{status:'accepted',duties:['referee']}});await deniesWithoutWrites(f,f.handle(r),/not-event-staff/);});

for(const eventAuthority of ['official','community'])test(`${eventAuthority} pre-draw resize retires occupied empty courts without altering retained seats or resurrecting old invites`,async()=>{
 const f=fixture(),room=f.doc(),state=JSON.parse(room.data),host=f.profile('host');
 room.createdByRole=eventAuthority==='official'?'staff':'player';room.ownerUid='host';room.eventAuthority=eventAuthority;room.ladderMode=eventAuthority==='community'?'general':'ranked';
 host.role=eventAuthority==='official'?'admin':'player';
 f.docs.get('systemConfig/refereeSeatsV1').communitySeatsEnabled=true;
 state.meta.eventAuthority=eventAuthority;state.meta.ladderMode=room.ladderMode;state.startedAt=null;state.matches=[];state.courtAssignments={};state.bracketSize=0;
 room.refereeSeatsV1={version:1,revision:2,courts:{1:{revision:1,main:{uid:'keep',name:'保留'},backup1:null,backup2:null},2:{revision:2,main:{uid:'removed',name:'移除'},backup1:null,backup2:null}},requests:{inv:{id:'inv',kind:'invite',station:2,status:'pending',expiresAt:10000}}};
 room.data=JSON.stringify(state);f.docs.set('publicTournaments/BXH-PARTNER',{bracketView:JSON.stringify(state)});
 await f.scoreHandle(f.command('host','resize',{count:1,expectedTarget:2,expectedPlanRevision:0}));
 const reduced=f.doc(),after=JSON.parse(reduced.data),mirror=JSON.parse(f.docs.get('publicTournaments/BXH-PARTNER').bracketView);
 assert.equal(after.meta.stations,1);assert.equal(reduced.refereeSeatsV1.courts[2].main,null);assert.equal(reduced.refereeSeatsV1.requests.inv.status,'stale');assert.equal(reduced.refereeSeatsV1.courts[1].main.uid,'keep');
 assert.deepEqual(reduced.refereeStationUids,['keep']);assert.deepEqual(Object.keys(mirror.meta.refereeSeatNames),['1']);assert(!mirror.meta.refereeSeatsV1);
 await f.scoreHandle(f.command('host','resize',{count:2,expectedTarget:1,expectedPlanRevision:after.courtRetirementPlan.revision}));
 assert.equal(f.doc().refereeSeatsV1.courts[2].main,null);assert.equal(f.doc().refereeSeatsV1.requests.inv.status,'stale');assert(f.doc().refereeSeatsV1.courts[2].revision>2);
});

for(const eventAuthority of ['official','community'])test(`${eventAuthority} live court keeps its seat and score until physical retirement`,async()=>{
 const f=fixture(),room=f.doc(),state=JSON.parse(room.data),host=f.profile('host');
 room.createdByRole=eventAuthority==='official'?'staff':'player';room.ownerUid='host';room.eventAuthority=eventAuthority;room.ladderMode=eventAuthority==='community'?'general':'ranked';host.role=eventAuthority==='official'?'admin':'player';
 f.docs.get('systemConfig/refereeSeatsV1').communitySeatsEnabled=true;
 state.meta.eventAuthority=eventAuthority;state.meta.ladderMode=room.ladderMode;
 const m=state.matches[0];m.station=2;m.scoreA=2;m.log=[{test:'preserve'}];state.courtAssignments={court1:{currentMatchId:null},court2:{currentMatchId:'m',nextMatchId:null}};
 room.refereeSeatsV1={version:1,revision:2,courts:{1:{revision:1,main:{uid:'keep',name:'保留'},backup1:null,backup2:null},2:{revision:2,main:{uid:'removed',name:'退場'},backup1:null,backup2:null}},requests:{inv:{id:'inv',kind:'invite',station:2,status:'pending',expiresAt:10000}}};
 room.data=JSON.stringify(state);f.docs.set('publicTournaments/BXH-PARTNER',{bracketView:JSON.stringify(state)});
 await f.scoreHandle(f.command('host','resize',{count:1,expectedTarget:2,expectedPlanRevision:0}));
 let saved=f.doc(),s=JSON.parse(saved.data);assert.equal(s.meta.stations,2);assert.equal(s.courtRetirementPlan.targetCount,1);assert.equal(saved.refereeSeatsV1.courts[2].main.uid,'removed');assert.equal(saved.refereeSeatsV1.requests.inv.status,'pending');
 await f.scoreHandle(f.command('host','force-exit',{station:2,matchId:'m',expectedCourtRevisions:{2:2},expectedScoreRevision:0,expectedDispatchRevision:0,expectedExitRevision:0,playerAId:'a',playerBId:'b'}));
 saved=f.doc();s=JSON.parse(saved.data);assert.equal(s.meta.stations,1);assert.equal(s.matches[0].station,0);assert.equal(s.matches[0].scoreA,2);assert.deepEqual(s.matches[0].log,[{test:'preserve'}]);assert.equal(saved.refereeSeatsV1.courts[2].main,null);assert.equal(saved.refereeSeatsV1.requests.inv.status,'stale');
});
