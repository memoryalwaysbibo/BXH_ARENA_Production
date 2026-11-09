'use strict';
const {test,after}=require('node:test'),assert=require('node:assert/strict');
const {db,FieldValue,handlers,service,seed,request,audit,drainAll}=require('./harness.cjs');
const {createApi}=require('../backend/api.cjs');
const {create: createFeedback}=require('../../modules/main-app/registration-feedback.js');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {resolve,promise};};
after(()=>db.terminate());
test('queue recovery has collection-group indexing for job state',()=>{
 const {fieldOverrides}=require('../indexes.json');
 const state=fieldOverrides.find(field=>field.collectionGroup==='_registrationQueueJobsV2'&&field.fieldPath==='state');
 assert.ok(state?.indexes.some(index=>index.queryScope==='COLLECTION_GROUP'&&index.order==='ASCENDING'),
  'the scheduled sweep filters jobs by state across rooms');
 assert.ok(state.indexes.some(index=>index.queryScope==='COLLECTION'&&index.order==='ASCENDING'),
  'the lifecycle handler filters jobs by state within the current room');
});
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
test('player cancellation waits for its queue receipt and automatic fill shares the join queue',async t=>{
 const {code,ids:[one,two,three]}=await seed(3,1,2),services=Array.from({length:5},()=>service());
 for(const uid of [one,two])await services[0].enqueue(uid,request(code,uid));
 await drainAll(services,code);let a=await audit(code,2);assert.equal(a.summary.confirmed,1);assert.equal(a.summary.waitlist,1);
 const cancel={code,route:'roster',operationId:'cancel-first-user',payload:{action:'cancel',code,intent:'player',registrationId:one,localId:'',operationId:'cancel-first-user'}};
 const api=createApi({queue:services[1],family:handlers.family(db),enabled:async c=>c===code});
 const call=(uid,data)=>api({auth:{uid},data:{...data,code}});
 const checked=deferred();let clock=Date.now();
 const feedback=createFeedback({getUid:()=>one,now:()=>clock,
  read:(room,operation)=>{assert.equal(room,code);assert.equal(operation.action,'cancel');return call(one,{action:'status',operationId:operation.operationId});},
  onChange:rows=>{if(rows[0]?.state==='unconfirmed'&&rows[0].lastCheckAt!==null)checked.resolve();}
 });
 t.after(()=>feedback.dispose());
 const cancellation=feedback.run(code,async progress=>{
  progress.submitting([one],cancel.payload);
  const accepted=await call(one,{action:'submit',operation:cancel});
  assert.equal(accepted.operation.state,'queued');assert.equal(accepted.operation.result,undefined);
  return accepted;
 },'cancel');
 await Promise.race([checked.promise,cancellation.then(()=>assert.fail('queue acceptance is not a cancellation'))]);
 assert.equal(feedback.snapshot()[0].state,'unconfirmed');
 await delay(2);await services[2].enqueue(three,request(code,three));
 await drainAll(services,code);a=await audit(code,2);
 assert.equal(a.rows.find(r=>r.id===one).status,'cancelled');
 assert.equal(a.rows.find(r=>r.id===two).status,'confirmed');
 assert.equal(a.rows.find(r=>r.id===three).status,'waitlist');
 assert.equal(a.summary.jobs,4);assert.equal(a.summary.completed,4);
 clock+=3001;
 await feedback.recheck(code);
 assert.deepEqual(await cancellation,{ok:true,status:'cancelled',registrationId:one,autoPromoted:true,queueCancellation:true,recovered:true});
 const status={action:'status',operationId:cancel.operationId};
 const receipt=(await call(one,status)).operation;
 assert.equal(receipt.state,'completed');
 assert.equal(receipt.result.status,'cancelled');
 assert.equal(receipt.result.autoPromoted,true);
 assert.equal(receipt.result.promotedRegistrationId,undefined);
 assert.equal(receipt.result.state,undefined);
 assert.equal((await call(two,status)).operation.state,'not-found');
 const disabled=createApi({queue:services[1],family:handlers.family(db)});
 assert.deepEqual((await disabled({auth:{uid:one},data:{...status,code}})).operation,receipt);
});
test('the player API refuses administrative mutations and the queue rejects another player’s cancellation',async()=>{
 const {code,ids:[owner,other]}=await seed(2),s=service();
 await s.enqueue(owner,request(code,owner));await s.drain(code);
 const api=createApi({queue:s,family:handlers.family(db),enabled:async c=>c===code});
 const call=data=>api({auth:{uid:other},data:{...data,code}});
 const operationId='cancel-other-player';
 const cancel={code,route:'roster',operationId,payload:{action:'cancel',code,intent:'player',registrationId:owner,operationId}};
 await assert.rejects(call({action:'submit'}),/invalid-operation/);
 for(const operation of [
  {...cancel,payload:{...cancel.payload,intent:'admin'}},
  {...cancel,payload:{...cancel.payload,action:'promote'}},
  {...cancel,payload:{...cancel.payload,action:'configure',enabled:false}},
  {...cancel,payload:{...cancel.payload,registrationId:'',localId:owner}},
  {...cancel,route:'family',payload:{...cancel.payload,action:'syncSummary'}},
 ])await assert.rejects(call({action:'submit',operation}),/invalid-operation/);
 assert.equal((await audit(code,1)).summary.jobs,1);
 await call({action:'submit',operation:cancel});await s.drain(code);
 const receipt=(await call({action:'status',operationId})).operation;
 assert.equal(receipt.state,'rejected');
 assert.equal(receipt.reason,'permission-denied');
 assert.equal((await audit(code,1)).summary.confirmed,1);
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

test('manager cancellation, manual promotion and new signup share the room lease',async()=>{
 const {createManagementApi,createManagementAuthorizer,createQueuedPromotion}=require('../backend/management.cjs');
 const {manager,promotionManager}=require('../../qr-checkin/backend/overlays/roster-service.js');
 const {createPromotionHandler,authorized}=require('../../registration-promotion/functions/service.cjs');
 const {code,ids:[first,second,third,late,admin,revoked]}=await seed(6,2,4);
 for(const path of ['tournaments','publicTournaments']){
  await db.doc(path+'/'+code).update({eventAuthority:'official'});
 }
 await db.doc('users/'+admin).update({role:'admin'});
 await db.doc('users/'+revoked).update({role:'admin'});
 const options={handlers:{...handlers,promotion:createQueuedPromotion({
  roster:handlers.roster,promote:store=>createPromotionHandler(store,{timestamp:()=>FieldValue.serverTimestamp(),allowUnseatedOfficial:true})
 })}};
 const workers=Array.from({length:5},()=>service(options));
 const authorize=createManagementAuthorizer({db,canCancel:manager,canPromote:authorized,canPromoteUnlimited:promotionManager});
 const api=createManagementApi({queue:workers[0],authorize,enabled:async c=>c===code});
 const send=(uid,data)=>api({auth:{uid},data:{...data,code}});
 const [privateRef,publicRef]=['tournaments','publicTournaments'].map(path=>db.doc(path+'/'+code));
 const privateRoom=(await privateRef.get()).data();
 await privateRef.update({data:JSON.stringify({...JSON.parse(privateRoom.data),meta:{registrationAutoFillEnabled:false}})});
 for(const uid of [first,second,third]){await workers[0].enqueue(uid,request(code,uid));await drainAll(workers,code);}
 assert.equal((await audit(code,3)).rows.find(row=>row.id===third).status,'waitlist');

 const cancellation={action:'cancel',registrationId:first,operationId:'admin-cancel-first'};
 const promotion={action:'promote',registrationId:third,operationId:'admin-promote-third',expandBy:0};
 await assert.rejects(send(late,cancellation),/permission-denied/);
 await assert.rejects(send(late,promotion),/permission-denied/);
 await assert.rejects(send(admin,{...promotion,intent:'player'}),/invalid-operation/);
 assert.equal((await send(admin,cancellation)).operation.state,'queued');
 await delay(2);
 assert.equal((await send(admin,promotion)).operation.state,'queued');
 await delay(2);
 await Promise.all([send(admin,promotion),workers[1].enqueue(late,request(code,late))]);
 const revokedRequest={action:'cancel',registrationId:second,operationId:'admin-revoked-cancel'};
 await send(revoked,revokedRequest);
 await db.doc('users/'+revoked).update({role:'player'});
 await drainAll(workers,code);

 const {rows,summary}=await audit(code,3);
 assert.deepEqual(Object.fromEntries(rows.map(row=>[row.id,row.status])),{
  [first]:'cancelled',[second]:'confirmed',[third]:'confirmed',[late]:'waitlist'
 });
 assert.deepEqual([summary.confirmed,summary.waitlist,summary.jobs,summary.rejected],[2,1,7,1]);
 const privateState=JSON.parse((await privateRef.get()).data().data);
 const publicState=JSON.parse((await publicRef.get()).data().bracketView);
 assert.deepEqual(publicState.players.map(p=>p.id),privateState.players.map(p=>p.id));
 const disabled=createManagementApi({queue:workers[1],authorize});
 const status=(uid,operationId)=>disabled({auth:{uid},data:{action:'status',code,operationId}});
 const result=(await status(admin,promotion.operationId)).operation;
 assert.equal(result.state,'completed');
 assert.equal(result.result.registrationId,third);
 assert.equal(result.result.state,undefined);
 assert.equal((await status(late,promotion.operationId)).operation.state,'not-found');
 assert.equal((await status(revoked,revokedRequest.operationId)).operation.reason,'permission-denied');
 await assert.rejects(disabled({auth:{uid:admin},data:{...promotion,code}}),/registration-queue-disabled/);

 const full={...promotion,registrationId:late,operationId:'admin-promote-full'};
 await send(admin,full);
 await drainAll(workers,code);
 assert.equal((await status(admin,full.operationId)).operation.reason,'capacity-full');
 const expand={...full,operationId:'admin-promote-expand',expandBy:8};
 await send(admin,expand);
 await drainAll(workers,code);
 const expanded=(await status(admin,expand.operationId)).operation.result;
 assert.deepEqual([expanded.capacity,expanded.confirmedCount,expanded.waitlistCount],[10,3,0]);
 const expandedAudit=await audit(code,3);
 assert.deepEqual([expandedAudit.summary.confirmed,expandedAudit.summary.waitlist],[3,0]);

 const toggle={action:'configure',enabled:true,operationId:'admin-enable-autofill'};
 const demote={action:'demote',registrationId:late,operationId:'admin-demote-player'};
 await assert.rejects(send(late,toggle),/permission-denied/);
 await assert.rejects(send(late,demote),/permission-denied/);
 await send(admin,toggle);
 await send(admin,demote);
 await drainAll(workers,code);
 assert.equal((await status(admin,toggle.operationId)).operation.result.enabled,true);
 assert.equal((await status(admin,demote.operationId)).operation.result.status,'waitlist');
 const demoted=await audit(code,3);
 assert.deepEqual([demoted.summary.confirmed,demoted.summary.waitlist],[2,1]);
 const currentPrivate=JSON.parse((await privateRef.get()).data().data);
 const currentPublic=JSON.parse((await publicRef.get()).data().bracketView);
 assert.equal(currentPrivate.meta.registrationAutoFillEnabled,true);
 assert.equal(currentPublic.meta.registrationAutoFillEnabled,true);
 assert.equal(currentPrivate.waitlistPlayers.find(p=>p.registrationId===late).waitRank,1);
 assert.ok(!currentPublic.players.some(p=>p.id==='reg_'+late));
});

test('a job added after the active batch was read can retry its own event',async()=>{
 const {code,ids:[first,second]}=await seed(2),entered=deferred(),resume=deferred();
 const active=service({beforeExecute:async()=>{entered.resolve();await resume.promise;}}),other=service();
 const firstRequest=request(code,first),secondRequest=request(code,second);
 const firstRef=active.jobRef(code,first,firstRequest.operationId),secondRef=other.jobRef(code,second,secondRequest.operationId);
 await active.enqueue(first,firstRequest);
 const delivery=active.drainCreatedJob(code,firstRef.id);
 await entered.promise;
 try{
  await other.enqueue(second,secondRequest);
  await assert.rejects(other.drainCreatedJob(code,secondRef.id),/queue-delivery-pending/);
 }finally{
  resume.resolve();
  await delivery;
 }
 assert.equal((await secondRef.get()).data().state,'queued');
 await other.drainCreatedJob(code,secondRef.id);
 await other.drainCreatedJob(code,secondRef.id);
 const a=await audit(code,2);
 assert.equal(a.summary.completed,2);
 assert.deepEqual(a.jobs.map(job=>job.attempts),[1,1]);
});
test('a bounded batch retries the triggering job if its turn has not arrived',async()=>{
 const {code,ids:[first,second]}=await seed(2),worker=service();
 await worker.enqueue(first,request(code,first));
 const later=request(code,second),ref=worker.jobRef(code,second,later.operationId);
 await worker.enqueue(second,later);
 await assert.rejects(worker.drainCreatedJob(code,ref.id,{limit:1}),/queue-delivery-pending/);
 assert.equal((await audit(code,1)).summary.completed,1);
 await worker.drainCreatedJob(code,ref.id,{limit:1});
 assert.equal((await audit(code,2)).summary.completed,2);
});

for(const firstAction of ['promoteLocal','join']){
 test(firstAction+' wins the last seat shared by onsite and online players',async()=>{
  const {createManagementApi,createManagementAuthorizer,createQueuedPromotion}=require('../backend/management.cjs');
  const {manager,promotionManager}=require('../../qr-checkin/backend/overlays/roster-service.js');
  const {createPromotionHandler,authorized}=require('../../registration-promotion/functions/service.cjs');
  const {code,ids:[player,staff]}=await seed(2,1,2);
  await db.doc('users/'+staff).update({role:'staff'});
  await db.doc('systemConfig/staffPromotion').set({enabled:true});
  const privateRef=db.doc('tournaments/'+code),publicRef=db.doc('publicTournaments/'+code);
  const guest={id:'onsite-last-seat',name:'Onsite fixture',source:'onsite',waitRank:1,checkedIn:true};
  const state=JSON.parse((await privateRef.get()).data().data);
  state.waitlistPlayers=[guest];
  await privateRef.update({eventAuthority:'official',assignedStaffUids:[staff],data:JSON.stringify(state)});
  await publicRef.update({eventAuthority:'official'});
  const options={handlers:{...handlers,promotion:createQueuedPromotion({
   roster:handlers.roster,promote:store=>createPromotionHandler(store,{timestamp:()=>FieldValue.serverTimestamp(),allowUnseatedOfficial:true})
  })}};
  const entered=deferred(),resume=deferred();
  const first=service({...options,beforeExecute:async job=>{
   if(job.payload.action===firstAction){entered.resolve();await resume.promise;}
  }});
  const second=service(options);
  const authorize=createManagementAuthorizer({db,canCancel:manager,canPromote:authorized,canPromoteUnlimited:promotionManager});
  const manage=createManagementApi({queue:second,authorize,enabled:async c=>c===code});
  const local={action:'promoteLocal',code,localId:guest.id,expandBy:0,operationId:'onsite-last-place'};
  const signup=request(code,player);
  const submitLocal=()=>manage({auth:{uid:staff},data:local});
  const submitJoin=()=>second.enqueue(player,signup);
  await assert.rejects(manage({auth:{uid:player},data:local}),/permission-denied/);
  const localFirst=firstAction==='promoteLocal';
  await (localFirst?submitLocal:submitJoin)();
  const started=first.drain(code);
  await entered.promise;
  try{
   await (localFirst?submitJoin:submitLocal)();
   assert.equal((await second.drain(code)).busy,true);
  }finally{resume.resolve();await started;}
  await drainAll([first,second],code);

  const localReceipt=(await second.status(staff,code,local.operationId)).operation;
  const onlineReceipt=(await second.status(player,code,signup.operationId)).operation;
  const currentPrivate=(await privateRef.get()).data(),currentPublic=(await publicRef.get()).data();
  const roster=JSON.parse(currentPrivate.data),mirror=JSON.parse(currentPublic.bracketView);
  assert.equal(onlineReceipt.result.status,localFirst?'waitlist':'confirmed');
  assert.equal(currentPrivate.confirmedCount,localFirst?0:1);
  assert.equal(currentPublic.confirmedCount,currentPrivate.confirmedCount);
  assert.equal(currentPublic.waitlistCount,localFirst?1:0);
  assert.equal(roster.players.some(row=>row.id===guest.id),localFirst);
  assert.equal(mirror.players.some(row=>row.id===guest.id),localFirst);
  assert.equal(currentPrivate.confirmedCount+roster.players.filter(row=>row.source==='onsite').length,1);
  assert.equal((await audit(code,1)).summary.jobs,2);
  if(localFirst){
   assert.equal(localReceipt.result.localId,guest.id);
   assert.equal(localReceipt.result.expanded,false);
   assert.equal(localReceipt.result.state,undefined);
   assert.equal(roster.players[0].checkedIn,true);
   assert.equal(roster.players[0].waitRank,undefined);
   const preview=await handlers.family(db)({auth:{uid:staff},data:{action:'preview',code,childIds:[null]}});
   assert.equal(preview.allocation[0].status,'waitlist');
  }else{
   assert.equal(localReceipt.reason,'capacity-full');
   const expansion={...local,operationId:'onsite-expand-denied',expandBy:8};
   await manage({auth:{uid:staff},data:expansion});await drainAll([first,second],code);
   assert.equal((await second.status(staff,code,expansion.operationId)).operation.reason,'permission-denied');
  }
 });
}

test('onsite batch and online signup share seats and an oversized batch leaves no partial write',async()=>{
 const {createManagementApi,createManagementAuthorizer,createQueuedPromotion}=require('../backend/management.cjs');
 const {manager,promotionManager}=require('../../qr-checkin/backend/overlays/roster-service.js');
 const {createPromotionHandler,authorized}=require('../../registration-promotion/functions/service.cjs');
 const {code,ids:[player,admin]}=await seed(2,2,2);
 const tr=db.doc('tournaments/'+code),pr=db.doc('publicTournaments/'+code);
 await Promise.all([tr.update({eventAuthority:'official'}),pr.update({eventAuthority:'official'}),db.doc('users/'+admin).update({role:'admin'})]);
 const options={handlers:{...handlers,promotion:createQueuedPromotion({
  roster:handlers.roster,promote:store=>createPromotionHandler(store,{timestamp:()=>FieldValue.serverTimestamp(),allowUnseatedOfficial:true})
 })}};
 const first=service(options),second=service(options);
 const authorize=createManagementAuthorizer({db,canCancel:manager,canPromote:authorized,canPromoteUnlimited:promotionManager});
 const api=createManagementApi({queue:first,authorize,enabled:async c=>c===code});
 const batch={action:'addLocal',code,operationId:'onsite-batch-oversize',names:['Guest A','Guest B','Guest C']};
 const send=data=>api({auth:{uid:admin},data});
 await assert.rejects(api({auth:{uid:player},data:batch}),/permission-denied/);
 await send(batch);await drainAll([first,second],code);
 assert.equal((await first.status(admin,code,batch.operationId)).operation.reason,'capacity-full');
 assert.equal(JSON.parse((await tr.get()).data().data).players.length,0);
 assert.equal(JSON.parse((await pr.get()).data().bracketView).players.length,0);

 const exact={...batch,operationId:'onsite-batch-accepted',names:['Guest A','Guest B']};
 const signup=request(code,player);
 await send(exact);
 await Promise.all([send(exact),second.enqueue(player,signup)]);
 await drainAll([first,second],code);
 const receipt=(await first.status(admin,code,exact.operationId)).operation;
 assert.deepEqual([receipt.result.status,receipt.result.addedCount,receipt.result.checkedIn],['added',2,true]);
 assert.equal(receipt.result.state,undefined);
 assert.equal((await first.status(player,code,signup.operationId)).operation.result.status,'waitlist');
 const runtime=JSON.parse((await tr.get()).data().data);
 const publicPlayers=JSON.parse((await pr.get()).data().bracketView).players;
 assert.equal(runtime.players.length,2);
 assert.equal(new Set(runtime.players.map(p=>p.id)).size,2);
 assert.ok(runtime.players.every(p=>p.source==='onsite'&&!p.ladderEligible&&!p.accountLinked));
 assert.ok(publicPlayers.every(p=>!('accountLinked' in p)));
 assert.deepEqual((await audit(code,1)).summary,{confirmed:0,waitlist:1,registrations:1,jobs:3,completed:2,rejected:1});
});

test('server ownership switches legacy callable writes to the queue without blocking previews',async()=>{
 const {createGuardedLegacyWriter}=require('../backend/legacy-writer.cjs');
 const {code,ids:[player]}=await seed(1);
 const tr=db.doc('tournaments/'+code);
 const queued=service({requireRoomOwnership:true});
 const guarded=createGuardedLegacyWriter({db,makeHandler:handlers.family,isMutation:action=>['join','cancel','syncSummary'].includes(action)});
 const signup=request(code,player);
 const call=data=>guarded({auth:{uid:player},data});
 await assert.rejects(queued.enqueue(player,signup),/registration-queue-disabled/);
 await tr.update({registrationQueueVersion:2});
 await assert.rejects(call(signup.payload),/registration-queue-required/);
 assert.equal((await call({action:'preview',code,childIds:[null]})).allocation[0].status,'confirmed');
 assert.equal((await audit(code,0)).summary.jobs,0);
 await queued.enqueue(player,signup);await queued.drain(code);
 assert.equal((await queued.status(player,code,signup.operationId)).operation.result.status,'confirmed');
 const {code:old,ids:[legacyPlayer]}=await seed(1);
 assert.equal((await guarded({auth:{uid:legacyPlayer},data:request(old,legacyPlayer).payload})).status,'confirmed');
});

test('disabled release bindings deny intake and leave background processing idle',async()=>{
 const {createBindings}=require('../backend/bindings.cjs');
 const {code,ids:[player]}=await seed(1);
 const tr=db.doc('tournaments/'+code);
 await tr.update({registrationQueueVersion:2});
 const queued=service({requireRoomOwnership:true});
 const signup=request(code,player);
 await queued.enqueue(player,signup);
 const family=Object.assign(store=>handlers.family(store),{v2CapacityAware:true});
 let workers=false;
 const dependencies={db,FieldValue,createFamilyRegistration:family,rosterFactory:handlers.roster,
  promotionFactory:()=>()=>{},authorizeManagement:async()=>{},enabled:async()=>true};
 const call=(endpoint,data)=>endpoint.run({auth:{uid:player},data:{code,...data}});
 const defaults=createBindings(dependencies);
 const event={params:{code,job:queued.jobRef(code,player,signup.operationId).id}};
 await assert.rejects(call(defaults.registrationQueueV2,{action:'submit',operation:signup}),/registration-queue-disabled/);
 await assert.rejects(call(defaults.registrationRosterQueueV2,{action:'configure',operationId:'manage-closed-test',enabled:true}),/registration-queue-disabled/);
 await defaults.registrationQueueV2Worker.run(event);
 await defaults.registrationQueueV2Sweep.run({});
 assert.equal((await audit(code,0)).summary.jobs,1);
 assert.equal((await call(defaults.registrationQueueV2,{action:'status',operationId:signup.operationId})).operation.state,'queued');
 const enabled=createBindings({...dependencies,enabled:async()=>false,workersEnabled:async()=>workers});
 workers=true;
 await assert.rejects(call(enabled.registrationQueueV2,{action:'submit',operation:signup}),/registration-queue-disabled/);
 await enabled.registrationQueueV2Sweep.run({});
 assert.equal((await call(enabled.registrationQueueV2,{action:'status',operationId:signup.operationId})).operation.state,'completed');
 assert.equal((await audit(code,1)).summary.confirmed,1);
});

test('ownership removed after admission stops the worker before the roster changes',async()=>{
 const {code,ids:[player]}=await seed(1);
 const tr=db.doc('tournaments/'+code);
 await tr.update({registrationQueueVersion:2});
 const queued=service({requireRoomOwnership:true,beforeExecute:()=>tr.update({registrationQueueVersion:FieldValue.delete()})});
 const signup=request(code,player);
 await queued.enqueue(player,signup);
 await queued.drain(code);
 const result=await queued.status(player,code,signup.operationId);
 assert.equal(result.operation.state,'rejected');
 assert.equal(result.operation.reason,'registration-queue-disabled');
 assert.equal((await audit(code,0)).summary.confirmed,0);
});

test('the closed deployment rejects every callable before database access even when configured gates return true',async()=>{
 const {createBindings}=require('../backend/bindings.cjs');
 const unexpected=()=>{throw Error('closed deployment accessed Firestore');};
 const db={collection:()=>({doc:unexpected}),doc:unexpected,getAll:unexpected,runTransaction:unexpected,collectionGroup:unexpected};
 const createFamilyRegistration=Object.assign(()=>unexpected,{v2CapacityAware:true});
 const release=createBindings({db,FieldValue,createFamilyRegistration,rosterFactory:()=>unexpected,
  promotionFactory:()=>unexpected,authorizeManagement:unexpected,stagedOnly:true,
  enabled:async()=>true,workersEnabled:async()=>true,startEnabled:async()=>true,drawEnabled:async()=>true});
 for(const name of ['registrationQueueV2','registrationRosterQueueV2','registrationDrawV2','registrationStartV2']){
  await assert.rejects(release[name].run({auth:{uid:'fixture'},data:{action:'status',code:'BXH-TEST'}}),
   {code:'failed-precondition',message:'registration-queue-disabled'});
 }
 await release.registrationQueueV2Worker.run({params:{code:'BXH-TEST',job:'fixture'}});
 await release.registrationQueueV2Sweep.run({});
});
