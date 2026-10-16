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
 const code='BXH-EMU'+String(++serial).padStart(4,'0');
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
 assert.equal(r.records.length,1);assert.equal(r.records[0].actorUid,'u1');assert.equal(r.records[0].eventName,'模擬器賽事');assert.equal(typeof r.records[0].at,'number');
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
