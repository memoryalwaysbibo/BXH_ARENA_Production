'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
if(!/^127\.0\.0\.1:8091$/.test(process.env.FIRESTORE_EMULATOR_HOST||''))throw Error('Only the dedicated local Firestore emulator is allowed');
const {initializeApp}=require('firebase-admin/app');
const {getFirestore}=require('firebase-admin/firestore');
initializeApp({projectId:'demo-qr-checkin'});
const db=getFirestore();
const {createCheckinHandler}=require('./firebase-callable.cjs');
const {signToken}=require('./core.cjs');
const secret='emulator-only-test-secret';
const handle=createCheckinHandler(db,()=>secret);
let serial=0;
async function seed(){
 const code='BXH-EM'+String(++serial).padStart(4,'0');
 const players=[{id:'p1',name:'選手甲',registrationUid:'u1',registrationId:'r1',checkedIn:false},{id:'p2',name:'選手乙',registrationUid:'u2',registrationId:'r2',checkedIn:false}];
 const state={id:code,meta:{checkinRequired:true,name:'模擬器賽事'},players};
 const ref=db.doc('tournaments/'+code),pub=db.doc('publicTournaments/'+code);
 const batch=db.batch();
 batch.set(db.doc('systemConfig/qrCheckin'),{enabled:true,writerGuardsVerified:true,roomCodes:[code]});
 for(const uid of ['u1','u2'])batch.set(db.doc('users/'+uid),{active:true,role:'player'});
 batch.set(db.doc('users/manager'),{active:true,role:'admin'});
 batch.set(ref,{data:JSON.stringify(state),tournamentPhase:'waiting',qrCheckin:{enabled:true,session:'s1'}});
 batch.set(pub,{bracketView:JSON.stringify({players:players.map(p=>({id:p.id,name:p.name,checkedIn:false}))})});
 for(const [i,uid] of ['u1','u2'].entries())batch.set(ref.collection('registrations').doc('r'+(i+1)),{uid,status:'confirmed',displayName:players[i].name});
 await batch.commit();
 const token=signToken(code,'s1',Date.now(),secret);
 return {code,ref,pub,token,scan:uid=>handle({auth:{uid},data:{action:'scan',code,token}}),command:data=>handle({auth:{uid:'manager'},data:{code,...data}})};
}
async function seedOnsite(){
 const x=await seed(),t=(await x.ref.get()).data(),s=JSON.parse(t.data);
 const common={capacity:3,confirmedCount:2,waitlistCount:1,registrationStatus:'closed',onsiteWaitlistDrawEnabled:true,onsiteWaitlistServerOwned:true,onsiteWaitlistRuntimeRevision:1,qrCheckinManaged:true,qrCheckinRevision:1};
 Object.assign(s,{qrCheckinManaged:true,qrCheckinRevision:1,onsiteWaitlistServerOwned:true,onsiteWaitlistRuntimeRevision:1,waitlistPlayers:[{id:'p3',name:'備取丙',registrationId:'r3',registrationUid:'u3',source:'online',checkedIn:false}]});
 s.players=s.players.map(p=>({...p,source:'online'}));s.meta.registrationCapacity=3;
 const batch=db.batch();
 batch.update(x.ref,{...common,data:JSON.stringify(s),onsiteWaitlistDraw:{enabled:true,status:'open',revision:1,roundNumber:0}});
 batch.update(x.pub,{...common,bracketView:JSON.stringify({meta:{},players:s.players.map(p=>({id:p.id,name:p.name,checkedIn:false})),onsiteWaitlistServerOwned:true,onsiteWaitlistRuntimeRevision:1})});
 batch.set(x.ref.collection('registrations').doc('r3'),{uid:'u3',status:'waitlist',displayName:'備取丙',waitRank:1});
 batch.set(db.doc('users/u3'),{role:'player',active:true});
 batch.update(db.doc('systemConfig/qrCheckin'),{onsiteIntegrationVerified:true});await batch.commit();
 const O=require('./onsite/core.cjs'),{FirestoreStore}=require('./onsite/firestore-store.cjs'),{FieldValue}=require('firebase-admin/firestore');
 const run=O.createOnsiteWaitlistService({store:new FirestoreStore(db,FieldValue),enabled:true});
 return {...x,legacy:data=>run({auth:{uid:'manager'},data:{code:x.code,...data}})};
}
test('four concurrent scans of one player commit one audit and one receipt',async()=>{
 const x=await seed();const rs=await Promise.all(Array.from({length:4},()=>x.scan('u1')));
 assert.equal(rs.filter(r=>!r.already).length,1);assert.equal(new Set(rs.map(r=>r.firstAt)).size,1);
 assert.equal((await x.ref.collection('checkinAudit').get()).size,1);assert.equal((await x.ref.collection('checkinReceipts').get()).size,1);
});
test('different concurrent players both remain checked in in private and public data',async()=>{
 const x=await seed();await Promise.all([x.scan('u1'),x.scan('u2')]);
 const privatePlayers=JSON.parse((await x.ref.get()).data().data).players;
 const publicPlayers=JSON.parse((await x.pub.get()).data().bracketView).players;
 assert.equal(privatePlayers.filter(p=>p.checkedIn).length,2);assert.equal(publicPlayers.filter(p=>p.checkedIn).length,2);
 assert.equal((await x.ref.collection('checkinAudit').get()).size,2);
});
test('corrupt mirror leaves no receipt, audit or half-updated private room',async()=>{
 const x=await seed();await x.pub.update({bracketView:'broken'});const before=(await x.ref.get()).data();
 await assert.rejects(x.scan('u1'),/checkin-unavailable/);
 assert.deepEqual((await x.ref.get()).data(),before);assert.equal((await x.ref.collection('checkinAudit').get()).size,0);assert.equal((await x.ref.collection('checkinReceipts').get()).size,0);
});
test('latest waitlist registration rejects a stale confirmed roster without writes',async()=>{
 const x=await seed();await x.ref.collection('registrations').doc('r1').update({status:'waitlist'});
 await assert.rejects(x.scan('u1'),/not-confirmed/);assert.equal((await x.ref.collection('checkinAudit').get()).size,0);
});
test('manual check-in, revoke, replay and recheck keep the first successful time',async()=>{
 const x=await seed();const request={action:'manual',playerId:'p1',operationId:'manual-operation-001'};
 const first=await x.command(request);await x.command({action:'revoke',playerId:'p1',operationId:'revoke-operation-001'});
 const replay=await x.command(request);assert.equal(replay.firstAt,first.firstAt);
 assert.equal(JSON.parse((await x.ref.get()).data().data).players[0].checkedIn,false);
 const next=await x.command({...request,operationId:'manual-operation-002'});assert.equal(next.firstAt,first.firstAt);
 assert.equal((await x.ref.collection('checkinAudit').get()).size,3);
});
test('player cannot read management history',async()=>{
 const x=await seed();await assert.rejects(handle({auth:{uid:'u1'},data:{code:x.code,action:'history'}}),/permission-denied/);
});
test('manager history contains committed audit time, actor and event',async()=>{
 const x=await seed();await x.scan('u1');const r=await x.command({action:'history'});
 assert.equal(r.records.length,1);assert.equal(r.records[0].actorUid,'u1');assert.equal(r.records[0].accountUid,'u1');assert.equal(r.records[0].registrationId,'r1');assert.equal(r.records[0].checkedIn,true);assert.equal(r.records[0].eventName,'模擬器賽事');assert.equal(typeof r.records[0].at,'number');
});
test('configure and scan advance matching private and public revision',async()=>{
 const x=await seed();await x.command({action:'configure',enabled:true});const s=await x.command({action:'status'});
 await handle({auth:{uid:'u1'},data:{code:x.code,action:'scan',token:s.token}});
 assert.equal((await x.ref.get()).data().qrCheckinRevision,2);assert.equal((await x.pub.get()).data().qrCheckinRevision,2);
});
test('closing check-in invalidates an unexpired QR',async()=>{
 const x=await seed();await x.command({action:'configure',enabled:false});await assert.rejects(x.scan('u1'),/checkin-closed/);
});
test('verified roster-sync overlay preserves QR check-in while advancing both revisions',async()=>{
 const x=await seed();await x.scan('u1');
 await db.doc('systemConfig/registrationRosterSync').set({enabled:true});
 await x.ref.update({registrationEnabled:true});await x.pub.update({registrationEnabled:true,registrationRosterSyncBackendEnabled:true});
 await x.ref.collection('registrations').doc('r3').set({uid:'u3',status:'confirmed',displayName:'新選手'});
 const fs=require('node:fs'),path=require('node:path'),module={exports:{}};
 const source=fs.readFileSync(__dirname+'/overlays/registration-roster-sync.js','utf8');
 function load(name){
  if(name==='firebase-functions/v2/firestore')return {onDocumentWritten:(_opts,fn)=>fn};
  if(name==='firebase-functions/v2/https')return {...require(name),onCall:(_opts,fn)=>fn};
  if(name.startsWith('./'))return require(path.join(__dirname,'overlays',name));
  return require(name);
 }
 new Function('require','module','exports',source)(load,module,module.exports);
 await module.exports.syncRegistrationRoster({data:true,params:{code:x.code}});
 const privateDoc=(await x.ref.get()).data(),publicDoc=(await x.pub.get()).data(),state=JSON.parse(privateDoc.data);
 assert.equal(state.players.find(p=>p.id==='p1').checkedIn,true);
 assert.equal(state.players.find(p=>p.registrationUid==='u3').checkedIn,false);
 assert.equal(privateDoc.qrCheckinRevision,2);assert.equal(publicDoc.qrCheckinRevision,2);
 assert.equal((await x.ref.collection('checkinAudit').get()).size,1);
});
test('guarded original roster service preserves attendance during configuration',async()=>{
 const x=await seed();await x.scan('u1');
 const {guardFirestore}=require('./guard-firestore.cjs');
 const {createRosterService}=require('./overlays/roster-service.js');
 const {FieldValue}=require('firebase-admin/firestore');
 const run=createRosterService(guardFirestore(db),FieldValue);
 await run({auth:{uid:'manager'},data:{action:'configure',code:x.code,enabled:true,operationId:'emulator-configure-001'}});
 const t=(await x.ref.get()).data(),p=(await x.pub.get()).data();
 assert.equal(JSON.parse(t.data).players.find(p=>p.id==='p1').checkedIn,true);
 assert.equal(t.qrCheckinRevision,2);assert.equal(p.qrCheckinRevision,2);
});
test('guard rolls back an incomplete private-only original backend write',async()=>{
 const x=await seed();await x.scan('u1');const before=(await x.ref.get()).data();
 const {guardFirestore}=require('./guard-firestore.cjs');
 const guarded=guardFirestore(db);
 await assert.rejects(guarded.runTransaction(async tx=>{const t=await tx.get(x.ref);await tx.get(x.pub);tx.update(x.ref,{data:t.data().data,updatedAt:1});}),/paired-write-required/);
 assert.deepEqual((await x.ref.get()).data(),before);
});
test('concurrent original roster configuration and a second scan preserve both players',async()=>{
 const x=await seed();await x.scan('u1');
 const {guardFirestore}=require('./guard-firestore.cjs');
 const {createRosterService}=require('./overlays/roster-service.js');
 const {FieldValue}=require('firebase-admin/firestore');
 const run=createRosterService(guardFirestore(db),FieldValue);
 await Promise.all([x.scan('u2'),run({auth:{uid:'manager'},data:{action:'configure',code:x.code,enabled:true,operationId:'concurrent-configure-001'}})]);
 const t=(await x.ref.get()).data(),p=(await x.pub.get()).data();
 assert.equal(JSON.parse(t.data).players.filter(p=>p.checkedIn).length,2);
 assert.equal(JSON.parse(p.bracketView).players.filter(p=>p.checkedIn).length,2);
 assert.equal(t.qrCheckinRevision,3);assert.equal(p.qrCheckinRevision,3);
 assert.equal((await x.ref.collection('checkinAudit').get()).size,2);
});
test('public-only backend projection rolls back without erasing attendance',async()=>{
 const x=await seed();await x.scan('u1');const before=(await x.pub.get()).data();
 const {guardFirestore}=require('./guard-firestore.cjs');
 await assert.rejects(guardFirestore(db).runTransaction(async tx=>{await tx.get(x.pub);tx.update(x.pub,{bracketView:'{"players":[]}'});}),/paired-write-required/);
 assert.deepEqual((await x.pub.get()).data(),before);
});
test('ordinary backend deletion of a QR managed room rolls back',async()=>{
 const x=await seed();await x.scan('u1');const before=(await x.ref.get()).data();
 const {guardFirestore}=require('./guard-firestore.cjs');
 await assert.rejects(guardFirestore(db).runTransaction(async tx=>{await tx.get(x.ref);tx.delete(x.ref);}),/audited-delete-required/);
 assert.deepEqual((await x.ref.get()).data(),before);
 assert.equal((await x.ref.collection('checkinAudit').get()).size,1);
});
test('actual room access configuration preserves attendance, mirror and replay behavior',async()=>{
 const x=await seed();await x.scan('u1');await x.ref.update({eventAuthority:'community',ownerUid:'manager'});
 const {guardFirestore}=require('./guard-firestore.cjs');
 const {createRoomAccessService}=require('./overlays/room-access-service.js');
 const run=createRoomAccessService(guardFirestore(db));
 const req={auth:{uid:'manager'},data:{action:'configure',code:x.code,mode:'password',password:'emu-password-123',operationId:'access-configure-001'}};
 assert.equal((await run(req)).ok,true);assert.equal((await run(req)).replayed,true);
 const t=(await x.ref.get()).data(),p=(await x.pub.get()).data();
 assert.equal(t.qrCheckinRevision,2);assert.equal(p.qrCheckinRevision,2);
 assert.equal(JSON.parse(t.data).players[0].checkedIn,true);assert.equal(JSON.parse(p.bracketView).players[0].checkedIn,true);
 assert.equal(t.roomAccessMode,'password');assert.equal(p.roomLocked,true);
 assert.equal(p.roomAccessHash,undefined);assert.equal(p.roomAccessSalt,undefined);
 assert.equal((await x.ref.collection('checkinAudit').get()).size,1);
});
test('actual completed-room hosting trigger retains attendance and counts the host once',async()=>{
 const x=await seed();await x.scan('u1');
 const state=JSON.parse((await x.ref.get()).data().data);
 state.archiveStatus='completed';state.completedAt=Date.now();state.expiresAtMs=Date.now()+86400000;
 state.matches=[{id:'m1',a:{playerId:'p1'},b:{playerId:'p2'},winnerId:'p1',completed:true}];
 await x.ref.update({eventAuthority:'community',createdBy:'manager',expiresAt:state.expiresAtMs,data:JSON.stringify(state)});
 const fs=require('node:fs'),path=require('node:path'),module={exports:{}};
 const {guardFirestore}=require('./guard-firestore.cjs');
 const guarded=guardFirestore(db);
 function load(name){
  if(name==='firebase-functions/v2/firestore')return {onDocumentWritten:(_opts,fn)=>fn};
  if(name==='firebase-functions/v2/scheduler')return {onSchedule:(_opts,fn)=>fn};
  if(name==='firebase-functions/v2/https')return {...require(name),onCall:(_opts,fn)=>fn};
  if(name==='firebase-admin/firestore')return {...require(name),getFirestore:()=>guarded};
  if(name.startsWith('./'))return require(path.join(__dirname,'overlays',name));
  return require(name);
 }
 new Function('require','module','exports',fs.readFileSync(__dirname+'/overlays/hosting.js','utf8'))(load,module,module.exports);
 const event={data:{after:{exists:true}},params:{code:x.code}};
 await module.exports.preserveCompletedRoomAndCountHost(event);await module.exports.preserveCompletedRoomAndCountHost(event);
 const t=(await x.ref.get()).data(),p=(await x.pub.get()).data();
 assert.equal(t.expiresAt,null);assert.equal(p.expiresAt,null);
 assert.equal(t.qrCheckinRevision,2);assert.equal(p.qrCheckinRevision,2);
 assert.equal(JSON.parse(t.data).players[0].checkedIn,true);assert.equal(JSON.parse(p.bracketView).players[0].checkedIn,true);
 assert.equal((await db.doc('hostCompletionLedger/'+x.code).get()).exists,true);
 assert.equal((await db.doc('hostStats/manager').get()).data().completedHostedCount,1);
 assert.equal((await x.ref.collection('checkinAudit').get()).size,1);
});
test('event staff authorization is rechecked against the parent within each request',async()=>{
 const x=await seed(),C=require('./event-staff-core.cjs');
 const parent={role:'player',active:true,partnerOrganizer:{status:'active',organizationId:'org1',orderCode:'ORDER1',expiresAtMs:Date.now()+3600000}};
 const room={createdBy:'organizer',createdByRole:'partner_organizer',eventAuthority:'official',partnerOrganizationCode:'org1',partnerContractOrderCode:'ORDER1'};
 const invitation={...C.makeInvitation({eventCode:x.code,targetUid:'helper',organizerUid:'organizer',organizerProfile:parent,tournament:room,duties:['checkin'],displayName:'報到協助'}),status:'accepted'};
 await db.doc('users/organizer').set(parent);await db.doc('users/helper').set({role:'player',active:true});
 await x.ref.update({...room,eventStaffAssignments:{helper:invitation}});
 const request={auth:{uid:'helper'},data:{action:'manual',code:x.code,playerId:'p1',operationId:'helper-operation-001'}};
 assert.equal((await handle(request)).ok,true);
 await db.doc('users/organizer').update({'partnerOrganizer.status':'revoked'});
 await assert.rejects(handle({...request,data:{...request.data,playerId:'p2',operationId:'helper-operation-002'}}),/permission-denied/);
 assert.equal((await x.ref.collection('checkinAudit').get()).size,1);
});
test('onsite confirmed scan and duplicate use the original draw counters without promotion',async()=>{
 const x=await seedOnsite();const first=await x.scan('u1'),again=await x.scan('u1');
 assert.equal(again.already,true);assert.equal(again.firstAt,first.firstAt);
 const t=(await x.ref.get()).data(),p=(await x.pub.get()).data(),s=JSON.parse(t.data);
 assert.equal(t.onsiteWaitlistDraw.revision,2);assert.equal(t.onsiteWaitlistRuntimeRevision,2);assert.equal(p.onsiteWaitlistRuntimeRevision,2);
 assert.equal(t.qrCheckinRevision,2);assert.equal(p.qrCheckinRevision,2);
 assert.equal(s.players[0].checkedIn,true);assert.equal(s.waitlistPlayers.length,1);
 assert.equal((await x.ref.collection('registrations').doc('r3').get()).data().status,'waitlist');
 assert.equal((await x.ref.collection('checkinAudit').get()).size,1);assert.equal((await x.ref.collection('onsiteWaitlistOperations').get()).size,1);
 await assert.rejects(x.scan('u3'),/not-confirmed/);
});
test('onsite manual revoke, replay and recheck share the same first-time ledger',async()=>{
 const x=await seedOnsite();
 const manual={action:'checkIn',playerId:'p1',checkedIn:true,operationId:'onsite-manual-001',expectedRevision:1};
 await x.legacy(manual);const first=(await x.command({action:'history'})).records[0];
 await x.legacy({...manual,checkedIn:false,operationId:'onsite-revoke-001',expectedRevision:2});
 assert.equal((await x.legacy(manual)).replayed,true);
 assert.equal(JSON.parse((await x.ref.get()).data().data).players[0].checkedIn,false);
 await x.scan('u1');const records=(await x.command({action:'history'})).records;
 assert.equal(records.length,3);assert.equal(records.find(r=>r.action==='scan').firstAt,first.firstAt);
 assert.equal(first.actorUid,'manager');assert.equal(first.accountUid,'u1');
 assert.equal((await x.ref.get()).data().qrCheckinRevision,4);
});
test('concurrent onsite manual check-in and scan never create duplicate attendance audits',async()=>{
 const x=await seedOnsite();
 const results=await Promise.allSettled([x.scan('u1'),x.legacy({action:'checkIn',playerId:'p1',checkedIn:true,operationId:'onsite-concurrent-001',expectedRevision:1})]);
 assert.equal(results[0].status,'fulfilled');
 if(results[1].status==='rejected')assert.match(results[1].reason.message,/stale-revision/);
 const t=(await x.ref.get()).data();assert.equal(JSON.parse(t.data).players[0].checkedIn,true);
 assert.equal((await x.ref.collection('checkinAudit').get()).size,1);assert.equal((await x.ref.collection('checkinReceipts').get()).size,1);
 assert.equal(t.qrCheckinRevision,2);
});
test('onsite capacity changes preserve QR attendance and update the returned canonical roster',async()=>{
 const x=await seedOnsite();await x.scan('u1');
 const result=await x.legacy({action:'increaseCapacity',capacity:4,operationId:'onsite-capacity-001',expectedRevision:2});
 assert.equal(result.canonicalState.players[0].checkedIn,true);assert.equal(result.canonicalState.qrCheckinRevision,3);
 assert.equal(result.state.participants.find(p=>p.playerId==='p1').checkedIn,true);
 const t=(await x.ref.get()).data(),p=(await x.pub.get()).data();assert.equal(t.qrCheckinRevision,3);assert.equal(p.qrCheckinRevision,3);
 assert.equal(t.capacity,4);assert.equal((await x.ref.collection('checkinAudit').get()).size,1);
});
test('finalized draw still accepts confirmed scans while keeping the frozen draw snapshot unchanged',async()=>{
 const x=await seedOnsite();let preview=await x.legacy({action:'preview'});
 await x.legacy({action:'close',candidateHash:preview.candidateHash,operationId:'onsite-close-001',expectedRevision:1});
 preview=await x.legacy({action:'preview'});
 await x.legacy({action:'finalize',candidateHash:preview.candidateHash,operationId:'onsite-finalize-001',expectedRevision:2});
 const before=(await x.ref.get()).data(),snapshot=JSON.stringify(before.onsiteWaitlistDraw.finalization);
 assert.equal((await x.scan('u1')).ok,true);
 const after=(await x.ref.get()).data(),pub=(await x.pub.get()).data();
 assert.equal(JSON.stringify(after.onsiteWaitlistDraw.finalization),snapshot);assert.equal(after.onsiteWaitlistDraw.revision,before.onsiteWaitlistDraw.revision);
 assert.equal(after.onsiteWaitlistRuntimeRevision,before.onsiteWaitlistRuntimeRevision+1);assert.equal(pub.onsiteWaitlistRuntimeRevision,after.onsiteWaitlistRuntimeRevision);
 assert.equal(JSON.parse(after.data).players[0].checkedIn,true);assert.equal((await x.ref.collection('checkinAudit').get()).size,1);
});
test('onsite QR stop and restart advance runtime mirrors without altering the draw round',async()=>{
 const x=await seedOnsite();await x.command({action:'configure',enabled:false});await assert.rejects(x.scan('u1'),/checkin-closed/);
 await x.command({action:'configure',enabled:true});const status=await x.command({action:'status'});
 assert.equal(status.enabled,true);await handle({auth:{uid:'u1'},data:{action:'scan',code:x.code,token:status.token}});
 const t=(await x.ref.get()).data(),pub=(await x.pub.get()).data();
 assert.equal(t.onsiteWaitlistDraw.revision,2);assert.equal(t.onsiteWaitlistRuntimeRevision,4);assert.equal(pub.onsiteWaitlistRuntimeRevision,4);assert.equal(t.qrCheckinRevision,4);
});
test('onsite mirror inconsistency rolls back every receipt, operation and audit',async()=>{
 const x=await seedOnsite();await x.pub.update({onsiteWaitlistRuntimeRevision:2});const before=(await x.ref.get()).data();
 await assert.rejects(x.scan('u1'),/registration-state-conflict/);assert.deepEqual((await x.ref.get()).data(),before);
 for(const collection of ['checkinReceipts','checkinAudit','onsiteWaitlistOperations'])assert.equal((await x.ref.collection(collection).get()).size,0);
});
test('onsite verification cannot be enabled from a scan payload or bypassed by legacy manual check-in',async()=>{
 const x=await seedOnsite();await db.doc('systemConfig/qrCheckin').update({onsiteIntegrationVerified:false});const before=(await x.ref.get()).data();
 await assert.rejects(handle({auth:{uid:'u1'},data:{action:'scan',code:x.code,token:x.token,onsiteReady:true,onsiteIntegrationVerified:true}}),/onsite-integration-required/);
 await assert.rejects(x.legacy({action:'checkIn',playerId:'p1',checkedIn:true,operationId:'onsite-disabled-001',expectedRevision:1}),/onsite-integration-required/);
 assert.deepEqual((await x.ref.get()).data(),before);assert.equal((await x.ref.collection('checkinAudit').get()).size,0);
});
test('mismatched QR mirror revision is rejected before any new check-in writes',async()=>{
 const x=await seed();await x.scan('u1');await x.pub.update({qrCheckinRevision:99});const before=(await x.ref.get()).data();
 await assert.rejects(x.scan('u2'),/checkin-state-stale/);assert.deepEqual((await x.ref.get()).data(),before);
 assert.equal((await x.ref.collection('checkinAudit').get()).size,1);
});
test('automatic cleanup cannot resume deletion of a QR room or remove its audit',async()=>{
 const x=await seed();await x.scan('u1');
 await x.ref.update({eventAuthority:'community'});
 await db.doc('systemSettings/communityCleanup').set({enabled:true,mode:'delete',readinessVerified:true});
 const job=db.doc('communityCleanupJobs/'+x.code);
 await job.set({status:'deleting',leaseUntil:0,token:'old-cleanup-token'});
 const {cleanRoom}=require('./overlays/cleanup/community-cleanup-engine.js');
 let deletes=0;
 const wrapped=new Proxy(db,{get(target,key){if(key==='recursiveDelete')return()=>{deletes++;throw Error('unexpected-delete');};const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;}});
 const r=await cleanRoom(wrapped,x.code,Date.now(),'new-cleanup-token');
 assert.equal(r.status,'qr-checkin-records-retained');assert.equal(deletes,0);
 assert.equal((await x.ref.get()).exists,true);assert.equal((await x.pub.get()).exists,true);
 assert.equal((await x.ref.collection('checkinAudit').get()).size,1);assert.equal((await job.get()).data().token,'old-cleanup-token');
});
test('ordinary expired unmanaged community room cleanup still completes',async()=>{
 const x=await seed();const t=(await x.ref.get()).data(),s=JSON.parse(t.data);
 s.meta.eventAuthority='community';s.updatedAt=Date.now()-3*86400000;s.matches=[];
 await x.ref.update({eventAuthority:'community',updatedAt:s.updatedAt,data:JSON.stringify(s)});
 await db.doc('systemSettings/communityCleanup').set({enabled:true,mode:'delete',readinessVerified:true});
 const {cleanRoom}=require('./overlays/cleanup/community-cleanup-engine.js');
 const r=await cleanRoom(db,x.code,Date.now()+40*86400000,'unmanaged-cleanup-token');
 assert.equal(r.status,'deleted');assert.equal((await x.ref.get()).exists,false);assert.equal((await x.pub.get()).exists,false);
 assert.equal((await db.doc('communityCleanupJobs/'+x.code).get()).data().status,'done');
});
test('deletion freeze and public closure both block new QR check-in while history stays readable',async()=>{
 const x=await seed();await x.ref.update({systemClosed:true,deletionStatus:'deleting'});
 await assert.rejects(x.scan('u1'),/checkin-closed/);assert.equal((await x.command({action:'history'})).records.length,0);
 const y=await seed();await y.pub.update({systemClosed:true});await assert.rejects(y.scan('u1'),/checkin-closed/);
 assert.equal((await y.command({action:'status'})).enabled,false);
 assert.equal((await y.ref.collection('checkinAudit').get()).size,0);
});
test('actual idle-close and restore handlers preserve audit and resume QR check-in after restoration',async()=>{
 const x=await seed();await x.scan('u1');await db.doc('users/manager').update({role:'super_admin'});
 const old=Date.now()-3*86400000,t=(await x.ref.get()).data(),s=JSON.parse(t.data);
 Object.assign(s,{archiveStatus:'ongoing',matches:[]});Object.assign(s.meta,{date:new Date(old).toISOString().slice(0,10),startTime:'00:00',registrationStatus:'closed'});
 await x.ref.update({data:JSON.stringify(s),archiveStatus:'ongoing',registrationStatus:'closed'});
 const fs=require('node:fs'),path=require('node:path'),module={exports:{}};
 const C=require('./overlays/lifecycle/operations-core.js');
 await db.doc('systemSettings/tournamentOperations').set({enabled:true,enabledAt:old});
 await db.doc('tournamentActivity/'+x.code).set({observedAt:old,lastAt:old,fingerprint:C.fingerprint((await x.ref.get()).data())});
 const {guardFirestore}=require('./guard-firestore.cjs');const guarded=guardFirestore(db);
 function load(name){
  if(name==='firebase-functions/v2/firestore')return {onDocumentWritten:(_opts,fn)=>fn};
  if(name==='firebase-functions/v2/scheduler')return {onSchedule:(_opts,fn)=>fn};
  if(name==='firebase-functions/v2/https')return {...require(name),onCall:(_opts,fn)=>fn};
  if(name==='firebase-admin/firestore')return {...require(name),getFirestore:()=>guarded};
  if(name==='./release-controls')return {backgroundJobsEnabled:async()=>true};
  if(name.startsWith('./'))return require(path.join(__dirname,'overlays/lifecycle',name));
  return require(name);
 }
 const source=fs.readFileSync(__dirname+'/overlays/lifecycle/operations.js','utf8')+'\nexports.__checkAndClose=checkAndClose;';
 new Function('require','module','exports',source)(load,module,module.exports);
 await module.exports.__checkAndClose(x.code);
 const closed=(await x.ref.get()).data();assert.equal(closed.systemClosed,true);assert.equal(closed.qrCheckinRevision,2);
 assert.equal(JSON.parse(closed.data).players[0].checkedIn,true);await assert.rejects(x.scan('u2'),/checkin-closed/);
 assert.equal((await module.exports.restoreIdleTournament({auth:{uid:'manager'},data:{code:x.code,reason:'模擬器恢復報到驗證'}})).ok,true);
 const restored=(await x.ref.get()).data(),pub=(await x.pub.get()).data();
 assert.equal(restored.systemClosed,false);assert.equal(restored.qrCheckinRevision,3);assert.equal(pub.qrCheckinRevision,3);
 assert.equal(JSON.parse(restored.data).players[0].checkedIn,true);assert.equal((await x.ref.collection('checkinAudit').get()).size,1);
 assert.equal((await x.scan('u2')).ok,true);assert.equal((await x.ref.collection('checkinAudit').get()).size,2);
});

async function writerSeed(extra={}){
 const x=await seed(),t=(await x.ref.get()).data(),state=JSON.parse(t.data),now=Date.now();
 state.matches=[];state.players=state.players.map(p=>({...p,source:'online'}));
 const common={capacity:10,confirmedCount:2,waitlistCount:0,tournamentPhase:'waiting',registrationEnabled:true,visibility:'public',registrationVisibility:'public',publishedAt:now-1000,registrationOpenAt:now-1000,registrationCloseAt:now+3600000,cancellationDeadline:now+3600000,...extra};
 const batch=db.batch();batch.update(x.ref,{...common,data:JSON.stringify(state)});batch.update(x.pub,common);
 batch.set(db.doc('users/u3'),{active:true,role:'player',realName:'新選手',phone:'0900000000',profileCompleted:true});await batch.commit();
 await x.scan('u1');return x;
}
async function assertWriterAttendance(x,audits=1){
 const t=(await x.ref.get()).data(),p=(await x.pub.get()).data();
 const player=JSON.parse(t.data).players.find(p=>p.id==='p1');
 assert.equal(player.checkedIn,true);assert.ok(player.checkinFirstAt>0);
 assert.equal(JSON.parse(p.bracketView).players.find(p=>p.id==='p1').checkedIn,true);
 assert.equal(t.qrCheckinRevision,p.qrCheckinRevision);
 assert.equal((await x.ref.collection('checkinAudit').get()).size,audits);
 return t;
}
const {loadWriter}=require('./writer-fixtures.cjs');
test('exact deployed lottery join preserves attendance without advancing roster revision',async()=>{
 const x=await writerSeed({registrationSelection:{status:'open',capacity:2,version:2},registeredCount:2});
 const run=loadWriter('lotteryRegistration','registration-selection.js',db).lotteryRegistration;
 const result=await run({auth:{uid:'u3'},data:{code:x.code,action:'join'}});
 assert.equal(result.status,'pending_draw');assert.equal((await assertWriterAttendance(x)).qrCheckinRevision,1);
 assert.equal((await x.ref.collection('registrations').doc('u3').get()).data().status,'pending_draw');
});
test('exact deployed lottery cancellation pairs multiple private writes with the public mirror',async()=>{
 const x=await writerSeed({registrationSelection:{status:'drawn',capacity:2,version:2},registeredCount:2});
 const t=(await x.ref.get()).data(),s=JSON.parse(t.data);s.entrySelection={vacancies:0,waitingCount:0};
 await x.ref.update({data:JSON.stringify(s)});await x.ref.collection('registrations').doc('u2').set({uid:'u2',status:'confirmed'});
 const run=loadWriter('lotteryRegistration','registration-selection.js',db).lotteryRegistration;
 assert.equal((await run({auth:{uid:'u2'},data:{code:x.code,action:'cancel'}})).status,'cancelled');
 assert.equal((await assertWriterAttendance(x)).qrCheckinRevision,2);
 assert.equal(JSON.parse((await x.pub.get()).data().bracketView).players.length,2);
});
test('exact deployed registration selection configure preserves attendance and denies player management',async()=>{
 const x=await writerSeed(),run=loadWriter('manageRegistrationSelection','registration-selection.js',db).manageRegistrationSelection;
 const data={code:x.code,action:'configure',capacity:2,operationId:'selection-config-001'};
 await assert.rejects(run({auth:{uid:'u1'},data}),/tournament-access-denied/);
 const before=(await x.ref.get()).data();
 assert.equal((await run({auth:{uid:'manager'},data})).ok,true);
 const after=await assertWriterAttendance(x);assert.equal(after.qrCheckinRevision,before.qrCheckinRevision+1);
});
test('exact deployed entry selection configure, draw and replay preserve checked-in players',async()=>{
 const x=await writerSeed();await x.scan('u2');
 const run=loadWriter('manageEntrySelection','entry-selection.js',db).manageEntrySelection;
 const command=data=>run({auth:{uid:'manager'},data:{code:x.code,...data}});
 await command({action:'configure',capacity:2,operationId:'entry-config-001'});
 const preview=await command({action:'preview'});assert.equal(preview.count,2);
 const draw={action:'draw',operationId:'entry-draw-001',candidateHash:preview.candidateHash};
 const result=await command(draw);assert.equal(result.state.players.filter(p=>p.checkedIn).length,2);
 const before=(await x.ref.get()).data().qrCheckinRevision;
 assert.equal((await command(draw)).replayed,true);
 assert.equal((await assertWriterAttendance(x,2)).qrCheckinRevision,before);
});
test('exact deployed family quick signup and cancellation retain an existing QR check-in',async()=>{
 const x=await writerSeed({eventAuthority:'community',communityQuickRegistration:true,ownerUid:'u3',createdBy:'u3',registrationOpenAt:null,registrationCloseAt:null,cancellationDeadline:null});
 await db.doc('familyPlayers/u3').set({profiles:[{id:'child1',playerId:'CCHILD001',displayCode:'P003C1',guardianUid:'u3',name:'家庭小選手',nickname:'小選手'}]});
 const run=loadWriter('familyRegistration','family-registration.js',db).createFamilyRegistration(require('./guard-firestore.cjs').guardFirestore(db));
 const join={code:x.code,action:'join',childIds:['child1'],operationId:'family-qr-join-001'};
 assert.equal((await run({auth:{uid:'u3'},data:join})).status,'confirmed');
 let t=await assertWriterAttendance(x);assert.equal(JSON.parse(t.data).players.some(p=>p.familyPlayerId==='child1'),true);
 assert.equal((await run({auth:{uid:'u3'},data:join})).replayed,true);
 await run({auth:{uid:'u3'},data:{code:x.code,action:'cancel',registrationId:'family_child1',operationId:'family-qr-cancel-001'}});
 t=await assertWriterAttendance(x);assert.equal(JSON.parse(t.data).players.some(p=>p.familyPlayerId==='child1'),false);
});
test('exact deployed team signup and replay leave attendance and QR revision unchanged',async()=>{
 const x=await writerSeed({battleMode:'team',teamSize:3});
 const run=loadWriter('teamRegistration','team-registration-service.js',db).createTeamRegistration(require('./guard-firestore.cjs').guardFirestore(db));
 const req={auth:{uid:'u3'},data:{code:x.code,action:'join',teamName:'測試隊伍',members:['甲','乙','丙'],operationId:'team-qr-join-001'}};
 assert.equal((await run(req)).status,'confirmed');assert.equal((await run(req)).replayed,true);
 assert.equal((await assertWriterAttendance(x)).qrCheckinRevision,1);
});
test('exact deployed invitation acceptance and replay leave the current QR attendance intact',async()=>{
 const x=await writerSeed();await x.ref.collection('registrationInvitations').doc('u3').set({targetUid:'u3',status:'pending',expiresAt:Date.now()+600000});
 const run=loadWriter('registrationInvitations','registration-invitations.js',db).createRegistrationInvitationService(require('./guard-firestore.cjs').guardFirestore(db));
 const req={auth:{uid:'u3'},data:{code:x.code,action:'respond',decision:'accept'}};
 assert.equal((await run(req)).status,'confirmed');assert.equal((await run(req)).replayed,true);
 assert.equal((await assertWriterAttendance(x)).qrCheckinRevision,1);
});
test('exact deployed court handler list preserves QR state after the event starts',async()=>{
 const x=await writerSeed(),t=(await x.ref.get()).data(),s=JSON.parse(t.data);
 s.startedAt=Date.now();s.matches=[{id:'m1',station:1,round:0,a:{playerId:'p1'},b:{playerId:'p2'},completed:false}];
 await x.ref.update({data:JSON.stringify(s),assignedStaffUids:['manager']});
 const run=loadWriter('courtCallService','court-call-service.js',db).createCourtCallService(require('./guard-firestore.cjs').guardFirestore(db));
 assert.equal((await run({auth:{uid:'manager'},data:{code:x.code,action:'list'}})).ok,true);
 assert.equal((await assertWriterAttendance(x)).qrCheckinRevision,1);
});
test('exact deployed court PASS writes preserve attendance and advance both QR mirrors',async()=>{
 const x=await writerSeed(),t=(await x.ref.get()).data(),s=JSON.parse(t.data);
 s.startedAt=Date.now();s.matches=[1,2].map(n=>({id:'m'+n,seq:n,station:1,bracket:'SE',round:0,a:{playerId:'p1'},b:{playerId:'p2'},completed:false,status:n===1?'in_progress':'pending'}));
 s.courtAssignments={court1:{currentMatchId:'m1',nextMatchId:'m2',status:'in_progress'}};
 await x.ref.update({data:JSON.stringify(s),assignedStaffUids:['manager']});await x.pub.update({bracketView:JSON.stringify({players:s.players.map(p=>({id:p.id,name:p.name,checkedIn:p.checkedIn})),matches:s.matches})});
 const run=loadWriter('courtCallService','court-call-service.js',db).createCourtCallService(require('./guard-firestore.cjs').guardFirestore(db));
 await run({auth:{uid:'manager'},data:{code:x.code,action:'notify',matchId:'m1',operationId:'court-notify-001'}});
 const req={auth:{uid:'u1'},data:{code:x.code,action:'respond',matchId:'m1',response:'pass',reason:'裝備處理',sequence:1,operationId:'court-pass-001'}};
 assert.equal((await run(req)).ok,true);
 const after=await assertWriterAttendance(x);assert.equal(after.qrCheckinRevision,2);
 assert.equal(JSON.parse(after.data).courtAssignments.court1.currentMatchId,'m2');
});
test('exact deployed final team score and replay preserve QR attendance',async()=>{
 const x=await writerSeed(),t=(await x.ref.get()).data(),s=JSON.parse(t.data);
 Object.assign(s.meta,{battleMode:'team',formatType:'single'});s.startedAt=Date.now();
 s.matches=[{id:'tm1',station:1,bracket:'SE',round:0,indexInRound:0,teamIds:['ta','tb'],completed:false}];
 await x.ref.update({data:JSON.stringify(s)});await x.pub.update({bracketView:JSON.stringify({players:s.players.map(p=>({id:p.id,name:p.name,checkedIn:p.checkedIn})),matches:s.matches})});
 await x.ref.collection('teamLineups').doc('tm1').set({lineupsRevealed:true,lineups:{ta:['a1','a2','a3'],tb:['b1','b2','b3']}});
 const run=loadWriter('teamScoring','team-scoring-service.js',db).createTeamScoringService(require('./guard-firestore.cjs').guardFirestore(db));
 let req,result;
 for(let n=1;n<=3;n++){
  req={auth:{uid:'manager'},data:{code:x.code,action:'score',matchId:'tm1',winnerSide:0,finish:'extreme',operationId:'team-score-00'+n}};
  result=await run(req);
 }
 assert.equal(result.matchCompleted,true);assert.equal((await run(req)).replayed,true);
 const after=await assertWriterAttendance(x);assert.equal(after.qrCheckinRevision,2);assert.equal(JSON.parse(after.data).championId,'ta');
});
test('exact deployed already-awarded ladder archive preserves QR attendance without awarding twice',async()=>{
 const x=await writerSeed({eventAuthority:'official',ladderMode:'ranked',ladderPointsAwarded:true}),t=(await x.ref.get()).data(),s=JSON.parse(t.data);
 s.meta.formatType='single';s.championId='p1';s.runnerUpId='p2';s.startedAt=Date.now();
 s.matches=[{id:'m1',bracket:'SE',round:0,a:{playerId:'p1'},b:{playerId:'p2'},completed:true,winnerId:'p1',loserId:'p2'}];
 await x.ref.update({data:JSON.stringify(s)});
 const run=loadWriter('ladderAutoSettlement','ladder-auto-settlement.js',db)._ladderAutoSettlementTest.createSettlementService({db:require('./guard-firestore.cjs').guardFirestore(db)});
 const result=await run.settle(x.code);assert.equal(result.archived,true);assert.equal(result.alreadyAwarded,true);
 assert.equal((await run.settle(x.code)).alreadyArchived,true);
 const after=await assertWriterAttendance(x);assert.equal(after.qrCheckinRevision,2);assert.equal(after.archiveStatus,'completed');
 assert.equal((await db.collection('ladderTransactions').where('eventCode','==',x.code).get()).size,0);
});

async function seedFamily(){
 const x=await seed(),state=JSON.parse((await x.ref.get()).data().data);
 for(const id of ['child1','child2'])state.players.push({id:'row-'+id,name:id,source:'online',registrationId:'reg-'+id,registrationUid:'u1',guardianUid:'u1',familyPlayerId:id,checkedIn:false});
 const batch=db.batch();batch.update(x.ref,{data:JSON.stringify(state)});
 batch.set(db.doc('familyPlayers/u1'),{profiles:['child1','child2'].map(id=>({id,guardianUid:'u1'}))});
 for(const id of ['child1','child2'])batch.set(x.ref.collection('registrations').doc('reg-'+id),{uid:'u1',guardianUid:'u1',familyPlayerId:id,status:'confirmed'});
 await batch.commit();
 return {...x,choose:()=>handle({auth:{uid:'u1'},data:{code:x.code,token:x.token,action:'candidates'}}),child:(id,uid='u1')=>handle({auth:{uid},data:{code:x.code,token:x.token,action:'scan',playerId:'row-'+id}})};
}
test('family discovery is read only and exposes only the caller confirmed participants',async()=>{
 const x=await seedFamily(),before=(await x.ref.get()).data();const r=await x.choose();
 assert.deepEqual(r.players.map(p=>p.id),['p1','row-child1','row-child2']);
 assert.deepEqual((await x.ref.get()).data(),before);assert.equal((await x.ref.collection('checkinAudit').get()).size,0);
});
test('concurrent sibling scans and duplicate taps commit independent receipts and public states',async()=>{
 const x=await seedFamily();await Promise.all([x.child('child1'),x.child('child2'),x.child('child1')]);
 const privatePlayers=JSON.parse((await x.ref.get()).data().data).players;
 const publicPlayers=JSON.parse((await x.pub.get()).data().bracketView).players;
 for(const rows of [privatePlayers,publicPlayers]){assert.equal(rows.find(p=>p.id==='p1').checkedIn,false);assert.equal(rows.filter(p=>p.checkedIn).length,2);}
 assert.equal((await x.ref.collection('checkinAudit').get()).size,2);assert.equal((await x.ref.collection('checkinReceipts').get()).size,2);
});
test('a different logged in guardian cannot use a valid room QR to check in this child',async()=>{
 const x=await seedFamily();await assert.rejects(x.child('child1','u2'),/not-confirmed/);assert.equal((await x.ref.collection('checkinAudit').get()).size,0);
});
test('cancellation after family discovery is rechecked transactionally without any attendance writes',async()=>{
 const x=await seedFamily();await x.choose();await x.ref.collection('registrations').doc('reg-child1').update({status:'cancelled'});
 await assert.rejects(x.child('child1'),/not-confirmed/);assert.equal((await x.ref.collection('checkinAudit').get()).size,0);
});
test('independent account transfer after discovery blocks the old guardian',async()=>{
 const x=await seedFamily();await x.choose();await db.doc('familyPlayers/u1').update({profiles:[{id:'child1',guardianUid:'u1',accountUid:'independent',transferStatus:'completed'},{id:'child2',guardianUid:'u1'}]});
 await assert.rejects(x.child('child1'),/not-confirmed/);assert.deepEqual((await x.choose()).players.map(p=>p.id),['p1','row-child2']);
});
