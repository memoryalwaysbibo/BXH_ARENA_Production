'use strict';
const {test,after}=require('node:test'),assert=require('node:assert/strict');
const {db,FieldValue,handlers,service,seed,request,audit,drainAll}=require('./harness.cjs');
const {createApi}=require('../backend/api.cjs');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {resolve,promise};};
after(()=>db.terminate());
test('five independent services accept the same operation once and reject changed payload',async()=>{
 const {code,ids:[uid]}=await seed(1),services=Array.from({length:5},()=>service());
 const req=request(code,uid);
 await Promise.all(services.map(s=>s.enqueue(uid,req)));
 await assert.rejects(services[0].enqueue(uid,{...req,payload:{...req.payload,childEligibilityConfirmed:false}}),/operation-conflict/);
 await drainAll(services,code);assert.equal((await audit(code,1)).summary.jobs,1);
});
test('lost submission response is recovered by a fresh service without a second registration',async()=>{
 const {code,ids:[uid]}=await seed(1),first=service(),req=request(code,uid);
 await first.enqueue(uid,req); // simulate caller disconnect immediately after acceptance
 const second=service();await second.sweep();
 assert.equal((await second.status(uid,code,req.operationId)).operation.state,'completed');
 await second.enqueue(uid,req);assert.equal((await audit(code,1)).summary.jobs,1);
});
test('expired worker cannot write after another worker takes the lease',async()=>{
 const {code,ids:[uid]}=await seed(1),entered=deferred(),resume=deferred();let now=Date.now();
 const old=service({workerId:'old',leaseMs:100,clock:()=>now,beforeExecute:async()=>{entered.resolve();await resume.promise;}});
 await old.enqueue(uid,request(code,uid));const oldDrain=old.drain(code).catch(e=>e.message);await entered.promise;
 now+=101;const replacement=service({workerId:'new',leaseMs:1000,clock:()=>now});
 await replacement.drain(code);resume.resolve();await oldDrain;
 assert.equal((await audit(code,1)).summary.completed,1);
});
test('rechecks account and close time after acceptance, before allocation',async()=>{
 const {code,ids}=await seed(2),s=service();
 for(const uid of ids)await s.enqueue(uid,request(code,uid));
 await db.doc('users/'+ids[0]).update({active:false});
 await db.doc('tournaments/'+code).update({registrationCloseAt:Date.now()-1});
 await s.drain(code);
 const a=await audit(code,0);assert.equal(a.summary.rejected,2);
 assert.deepEqual(a.jobs.map(j=>j.reason).sort(),['auth-required','closed']);
});
test('join, player cancellation and automatic fill share one room lease and preserve counts',async()=>{
 const {code,ids:[one,two,three]}=await seed(3,1,2),services=Array.from({length:5},()=>service());
 for(const uid of [one,two])await services[0].enqueue(uid,request(code,uid));
 await drainAll(services,code);let a=await audit(code,2);assert.equal(a.summary.confirmed,1);assert.equal(a.summary.waitlist,1);
 const cancel={code,route:'roster',operationId:'cancel-first-user',payload:{action:'cancel',code,intent:'player',registrationId:one,operationId:'cancel-first-user'}};
 await services[1].enqueue(one,cancel);await delay(2);await services[2].enqueue(three,request(code,three));
 await drainAll(services,code);a=await audit(code,2);
 assert.equal(a.rows.find(r=>r.id===one).status,'cancelled');
 assert.equal(a.rows.find(r=>r.id===two).status,'confirmed');
 assert.equal(a.rows.find(r=>r.id===three).status,'waitlist');
 assert.equal(a.summary.jobs,4);assert.equal(a.summary.completed,4);
});
test('duplicate cancellation cannot decrement twice or promote twice',async()=>{
 const {code,ids:[one,two]}=await seed(2,1,1),s=service();
 for(const uid of [one,two])await s.enqueue(uid,request(code,uid));await drainAll([s],code);
 const cancel={code,route:'roster',operationId:'cancel-only-once',payload:{action:'cancel',code,intent:'player',registrationId:one,operationId:'cancel-only-once'}};
 await Promise.all(Array.from({length:20},()=>s.enqueue(one,cancel)));await drainAll([s],code);
 const a=await audit(code,1);assert.equal(a.summary.confirmed,1);assert.equal(a.summary.waitlist,0);assert.equal(a.summary.jobs,3);
});
test('family registration keeps all selected identities atomic and preserves allocation consent',async()=>{
 const {code,ids:[parent]}=await seed(1,1,1),s=service();
 await db.doc('familyPlayers/'+parent).set({profiles:[{id:'kid1',guardianUid:parent,name:'Synthetic child',nickname:'',displayCode:'P001C1',playerId:'CHILD001'}]});
 const req=request(code,parent);req.payload.childIds=[null,'kid1'];req.payload.allocation=[{registrationId:parent,status:'confirmed'},{registrationId:'family_kid1',status:'waitlist'}];
 await s.enqueue(parent,req);await s.drain(code);const a=await audit(code,2);
 assert.equal(a.rows.find(r=>r.id==='family_kid1').guardianUid,parent);assert.equal(a.rows.find(r=>r.id==='family_kid1').ladderEligible,false);
 assert.equal((await s.status(parent,code,req.operationId)).operation.state,'completed');
});
test('V2 queue family admission reaches staff preparation and guardian QR check-in after roster sync',async()=>{
 const {code,ids:[parent]}=await seed(1,3),s=service();
 const room=db.doc('tournaments/'+code),publicRoom=db.doc('publicTournaments/'+code);
 const state=JSON.parse((await room.get()).data().data);state.meta.checkinRequired=true;
 await room.update({data:JSON.stringify(state),eventAuthority:'official',qrCheckin:{enabled:true,session:'ready'}});
 await publicRoom.update({registrationRosterSyncBackendEnabled:true});
 await db.doc('familyPlayers/'+parent).set({profiles:[{id:'kid1',guardianUid:parent,name:'Synthetic child',nickname:'',displayCode:'P001C1',playerId:'CHILD001'}]});
 const staff='staff-'+code;await db.doc('users/'+staff).set({active:true,role:'staff'});
 const req=request(code,parent);req.payload.childIds=[null,'kid1'];await s.enqueue(parent,req);await s.drain(code);
 const {createStaffRosterHandler}=require('../../staff-roster/functions/service.cjs');
 const roster=()=>createStaffRosterHandler(db)({auth:{uid:staff},data:{code}});
 assert.deepEqual((await roster()).rows.map(row=>row.name).sort(),['Synthetic','Synthetic child'].sort());
 await db.doc('systemConfig/registrationRosterSync').set({enabled:true,roomCodes:[code]});
 await db.doc('systemConfig/qrCheckin').set({enabled:true,writerGuardsVerified:true,roomCodes:[code]});
 const {createCheckinHandler}=require('../../qr-checkin/backend/firebase-callable.cjs');
 const {signToken}=require('../../qr-checkin/backend/core.cjs');
 const secret='synthetic-v2-checkin-key',checkin=createCheckinHandler(db,()=>secret);
 const token=signToken(code,'ready',Date.now(),secret);
 const candidates=()=>checkin({auth:{uid:parent},data:{action:'candidates',code,token}});
 assert.equal((await candidates()).players.length,0,'QR needs the backend room projection before it can find the registrations');
 const fs=require('node:fs'),path=require('node:path'),overlayDir=path.join(__dirname,'../../qr-checkin/backend/overlays');
 const source=fs.readFileSync(path.join(overlayDir,'registration-roster-sync.js'),'utf8'),module={exports:{}};
 const load=name=>name==='firebase-functions/v2/firestore'?{onDocumentWritten:(_options,fn)=>fn}:
  name==='firebase-functions/v2/https'?{...require(name),onCall:(_options,fn)=>fn}:
  name.startsWith('./')?require(path.join(overlayDir,name)):require(name);
 new Function('require','module','exports',source)(load,module,module.exports);
 await module.exports.syncRegistrationRoster({data:true,params:{code}});
 assert.equal(JSON.parse((await room.get()).data().data).players.length,2);
 assert.equal(JSON.parse((await publicRoom.get()).data().bracketView).players.length,2);
 const rows=(await candidates()).players;assert.equal(rows.length,2);
 const child=rows.find(row=>row.family&&row.name==='Synthetic child');assert(child);
 assert.equal((await checkin({auth:{uid:parent},data:{action:'scan',code,token,playerId:child.id}})).checkedIn,true);
 assert.equal((await roster()).rows.find(row=>row.name==='Synthetic child').checkedIn,true);
});
test('status is actor-scoped and never returns a manager runtime snapshot',async()=>{
 const {code,ids:[uid,other]}=await seed(2),s=service(),req=request(code,uid);await s.enqueue(uid,req);await s.drain(code);
 assert.equal((await s.status(other,code,req.operationId)).operation.state,'not-found');
 const status=await s.status(uid,code,req.operationId);assert(!('state' in status.operation.result));
 await db.doc('users/'+uid).update({active:false});await assert.rejects(s.status(uid,code,req.operationId),/auth-required/);
});
test('API rollout is disabled by default and status acceptance is never reported as registration success',async()=>{
 const {code,ids:[uid]}=await seed(1),q=service(),family=handlers.family(db);
 await assert.rejects(createApi({queue:q,family})({auth:{uid},data:{action:'submit',code,operation:request(code,uid)}}),/queue-disabled/);
 const api=createApi({queue:q,family,enabled:async()=>true});
 const accepted=await api({auth:{uid},data:{action:'submit',code,operation:request(code,uid)}});assert.equal(accepted.operation.state,'queued');assert.equal(accepted.status,undefined);
 await q.drain(code);const mine=await api({auth:{uid},data:{action:'mine',code,operationId:request(code,uid).operationId}});assert.equal(mine.operation.state,'completed');assert.equal(mine.rows[0].status,'confirmed');
});
