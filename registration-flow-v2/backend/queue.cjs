'use strict';
const {createHash, randomUUID}=require('node:crypto');
const {registrationQueueOwnsRoom}=require('./legacy-writer.cjs');
const digest=value=>createHash('sha256').update(value).digest('hex');
const canonical=value=>JSON.stringify(value===null||typeof value!=='object'?value:Array.isArray(value)?value.map(x=>JSON.parse(canonical(x))):Object.fromEntries(Object.keys(value).sort().map(k=>[k,JSON.parse(canonical(value[k]))])));
const active=u=>u?.active===true&&!u.deleted&&!['deleted','disabled','frozen'].includes(u.accountStatus);
const millis=t=>t?.toMillis?t.toMillis():Number(t)||0;
const businessRejections=new Set(('auth-required not-found room-password-required operation-conflict onsite-waitlist-managed corrupt-state family-lottery-unavailable tournament-started registration-state-conflict permission-denied not-enabled not-open-yet closed profile-incomplete invalid-participants child-not-found roster-locked child-eligibility-required already-registered full allocation-changed invalid-operation cancel-deadline-passed not-registered nothing-to-cancel bracket-locked selection-managed team-roster-managed bucket-scoring-required unlimited-quick-registration-required not-waitlist invalid-registration-capacity invalid-registration-schedule capacity-full invalid-capacity-step promotion-route-not-supported operation-outdated qr-checkin-stale court-lifecycle-stale roster-too-large online-registration-required invalid-request unauthenticated public-mirror-stale not-confirmed call-state-stale entry-selection-stale').split(' '));
const fail=reason=>Object.assign(Error(reason),{reason});
function safeResult(result,job){
 const out={};
 for(const key of ['ok','status','registrationId','autoPromoted','alreadyCancelled','replayed','confirmedCount','waitlistCount','capacity','communityParticipantCount','enabled'])if(result?.[key]!==undefined)out[key]=result[key];
 if(job?.payload.intent==='admin'&&result?.localId){
  out.localId=result.localId;
  if(result.expanded!==undefined)out.expanded=result.expanded;
 }
 if(job?.payload.action==='addLocal'&&job.payload.intent==='admin'){
  out.addedCount=result.addedCount;
  out.checkedIn=result.checkedIn;
 }
 if(Array.isArray(result?.rows))out.rows=result.rows.map(row=>Object.fromEntries(['registrationId','childId','status','participantName'].filter(k=>row[k]!==undefined).map(k=>[k,row[k]])));
 return out;
}
function validate(uid,input){
 if(!uid)throw fail('auth-required');
 const code=String(input?.code||'').toUpperCase();
 if(!/^BXH-[A-Z0-9]{4,16}$/.test(code)||!['family','roster','promotion'].includes(input?.route)||!/^[A-Za-z0-9_-]{8,100}$/.test(input?.operationId||''))throw fail('invalid-operation');
 const d=JSON.parse(JSON.stringify(input.payload||{}));
 const allowed={family:['join','cancel','syncSummary'],roster:['cancel','promote','configure'],promotion:['promote','demote','promoteLocal','addLocal']}[input.route];
 if(!allowed.includes(d.action)||d.code!==code||d.operationId!==input.operationId)throw fail('invalid-operation');
 if(Buffer.byteLength(JSON.stringify(d))>12000)throw fail('invalid-operation');
 return {uid,code,route:input.route,operationId:input.operationId,payload:d};
}

// Private server-only operation journal. This is a candidate, not an installed
// Cloud Tasks deployment. onCreate + a scheduled sweep must both be wired before
// rollout. Queue acceptance is NOT a reservation or proof of registration.
function createQueue(db,{handlers,FieldValue,clock=Date.now,leaseMs=30000,maxAttempts=5,requireRoomOwnership=false,workerId=randomUUID(),beforeExecute=async()=>{}}={}){
 if(!handlers?.family||!handlers?.roster||!FieldValue)throw Error('queue-dependencies-required');
 const rooms=db.collection('_registrationQueueV2');
 const roomRef=code=>rooms.doc(code);
 const jobsRef=code=>roomRef(code).collection('_registrationQueueJobsV2');
 const jobRef=(code,uid,operationId)=>jobsRef(code).doc(digest(uid+'|'+operationId));
 const checkLease=(lease,token)=>{if(lease?.owner!==workerId||lease?.token!==token||millis(lease.until)<=clock())throw fail('queue-lease-lost');};
 async function enqueue(uid,input,authorize){
  const value=validate(uid,input),ref=jobRef(value.code,uid,value.operationId),hash=digest(canonical({route:value.route,payload:value.payload}));
  await db.runTransaction(async tx=>{
   const roomReads=requireRoomOwnership?[db.doc('tournaments/'+value.code)]:[];
   const [user,existing,room]=await tx.getAll(db.doc('users/'+uid),ref,...roomReads);
   if(!active(user.data()))throw fail('auth-required');
   if(existing.exists){if(existing.data().requestHash!==hash)throw fail('operation-conflict');return;}
   const roomData=room?.data();
   if(requireRoomOwnership&&!registrationQueueOwnsRoom(roomData))throw fail('registration-queue-disabled');
   if(requireRoomOwnership&&(roomData.startedAt||roomData.tournamentPhase==='live'))throw fail('tournament-started');
   if(authorize)await authorize(tx,user.data(),value,roomData);
   tx.create(ref,{...value,requestHash:hash,state:'queued',attempts:0,acceptedAt:FieldValue.serverTimestamp(),updatedAt:clock()});
  });
  return status(uid,value.code,value.operationId);
 }
 async function status(uid,code,operationId){
  if(!uid||!/^BXH-[A-Z0-9]{4,16}$/.test(code)||!/^[A-Za-z0-9_-]{8,100}$/.test(operationId||''))throw fail('invalid-operation');
  const [user,snap]=await db.getAll(db.doc('users/'+uid),jobRef(code,uid,operationId));
  if(!active(user.data()))throw fail('auth-required');
  if(!snap.exists)return {ok:true,operation:{state:'not-found'}};
  const j=snap.data();
  if(j.uid!==uid)throw fail('permission-denied');
  return {ok:true,operation:{state:j.state,operationId:j.operationId,acceptedAt:millis(j.acceptedAt),...(j.state==='completed'?{result:j.result}:{}),...(j.state==='rejected'?{reason:j.reason}:{}),...(j.state==='attention'?{reason:'processing-unconfirmed'}:{})}};
 }
 async function acquire(code){
  const ref=roomRef(code),token=randomUUID();
  return db.runTransaction(async tx=>{
   const snap=await tx.get(ref),data=snap.data();
   if(millis(data?.until)>clock())return null;
   tx.set(ref,{owner:workerId,token,until:clock()+leaseMs,updatedAt:clock()},{merge:true});
   return token;
  });
 }
 async function release(code,token){
  await db.runTransaction(async tx=>{const ref=roomRef(code),s=await tx.get(ref);if(s.data()?.owner===workerId&&s.data()?.token===token)tx.set(ref,{until:0,updatedAt:clock()},{merge:true});});
 }
 async function claim(code,ref,token){
  return db.runTransaction(async tx=>{
   const [ls,js]=await tx.getAll(roomRef(code),ref);checkLease(ls.data(),token);
   const j=js.data();if(!j||!['queued','running'].includes(j.state))return null;
   if(millis(j.nextAttemptAt)>clock())return null;
   tx.update(roomRef(code),{until:clock()+leaseMs,updatedAt:clock()});
   tx.update(ref,{state:'running',workerToken:token,attempts:j.attempts+1,updatedAt:clock()});
   return {...j,attempts:j.attempts+1};
  });
 }
 function fencedDatabase(code,ref,token){
  return new Proxy(db,{get(target,key){
   if(key==='runTransaction')return (callback,options)=>{
    if(options?.readOnly)throw fail('queue-unexpected-readonly');
    return target.runTransaction(async tx=>{
     const [ls,js]=await tx.getAll(roomRef(code),ref);checkLease(ls.data(),token);
     if(js.data()?.state!=='running'||js.data()?.workerToken!==token)throw fail('queue-lease-lost');
     // The operation result and all registration mutations commit atomically.
     // A lost response cannot leave a committed registration with an absent
     // completion marker. A new lease invalidates the old transaction's read.
     const result=await callback(tx);
     tx.update(ref,{state:'completed',result:safeResult(result,js.data()),updatedAt:clock(),completedAt:clock()});
     return result;
    },options);
   };
   const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;
  }});
 }
 async function recordError(code,ref,token,job,error){
  const reason=String(error?.reason||error?.message||'unknown');
  if(reason==='queue-lease-lost')return;
  await db.runTransaction(async tx=>{
   const [ls,js]=await tx.getAll(roomRef(code),ref);checkLease(ls.data(),token);
   if(js.data()?.state==='completed')return; // commit succeeded, reply was lost
   if(js.data()?.workerToken!==token)throw fail('queue-lease-lost');
   if(businessRejections.has(reason))tx.update(ref,{state:'rejected',reason,updatedAt:clock()});
   else tx.update(ref,{state:job.attempts>=maxAttempts?'attention':'queued',nextAttemptAt:clock()+Math.min(30000,1000*2**(job.attempts-1)),updatedAt:clock()});
  });
 }
 async function drain(code,{limit=25,budgetMs=20000}={}){
  if(!/^BXH-[A-Z0-9]{4,16}$/.test(code))throw fail('invalid-operation');
  const token=await acquire(code);if(!token)return {busy:true,processed:0};
  const started=clock();let processed=0;
  try{
   const snapshots=await jobsRef(code).where('state','in',['queued','running']).orderBy('acceptedAt').limit(limit).get();
   for(const snap of snapshots.docs){
    if(clock()-started>=budgetMs)break;
    const job=await claim(code,snap.ref,token);if(!job)break;
    try{
     await beforeExecute(job);
     const store=fencedDatabase(code,snap.ref,token);
     // Factories must use only this transaction-bound store for mutations.
     await handlers[job.route](store)({auth:{uid:job.uid},data:job.payload});
    }catch(error){await recordError(code,snap.ref,token,job,error);}
    processed++;
    const current=(await snap.ref.get()).data();
    if(['queued','attention'].includes(current.state))break;
   }
   return {busy:false,processed};
  }finally{await release(code,token);}
 }
 async function drainCreatedJob(code,jobId,options){
  const ref=jobsRef(code).doc(jobId);
  const pending=async()=>['queued','running'].includes((await ref.get()).data()?.state);
  if(!await pending())return;
  await drain(code,options);
  // Another worker may already have read its batch, or this batch may have
  // stopped early. Leave the event retryable until its own job is settled.
  if(await pending())throw fail('queue-delivery-pending');
 }
 async function sweep(){
  // A sweeper is a recovery path, not an unbounded scan of every tournament.
  const pending=await db.collectionGroup('_registrationQueueJobsV2').where('state','in',['queued','running']).limit(200).get();
  const codes=[...new Set(pending.docs.filter(s=>s.ref.parent.parent?.parent.path==='_registrationQueueV2').map(s=>s.data().code))];
  for(const code of codes)await drain(code);
  return {rooms:codes.length};
 }
 return {enqueue,status,drain,drainCreatedJob,sweep,jobRef};
}
module.exports={createQueue,validate,businessRejections,safeResult};
