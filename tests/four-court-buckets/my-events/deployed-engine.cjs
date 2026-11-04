'use strict';
const {randomUUID,createHash}=require('node:crypto');
const {normalizeLifecycle}=require('./lifecycle');
const {collectOwners}=require('./owners');
const SCHEMA=24,RELEASE='individual-family-v24',PAGE=32,LEASE_MS=15000;
const COUNTERS=['selfConfirmed','selfWaitlist','familyConfirmed','familyWaitlist','unsupported'];
const PATHS={jobs:'myEventRoomJobs',refs:'myEventRoomRefs',failures:'myEventMembershipFailuresV24'};
const keyOK=x=>typeof x==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(x);
const segmentOK=x=>typeof x==='string'&&x.length>0&&Buffer.byteLength(x)<=1500&&!x.includes('/')&&x!=='.'&&x!=='..';
const uidOK=x=>typeof x==='string'&&/^[^\s/]{1,128}$/.test(x);
const stamp=t=>t&&Number.isSafeInteger(t.seconds)&&Number.isInteger(t.nanoseconds)&&t.nanoseconds>=0&&t.nanoseconds<1e9?{seconds:t.seconds,nanoseconds:t.nanoseconds}:null;
const same=(a,b)=>a===null&&b===null||!!a&&!!b&&a.seconds===b.seconds&&a.nanoseconds===b.nanoseconds;
const before=(a,b)=>a.seconds<b.seconds||a.seconds===b.seconds&&a.nanoseconds<b.nanoseconds;
const ownerHints=row=>[...new Set([row?.uid===('family_'+row?.familyPlayerId)&&typeof row?.familyPlayerId==='string'?null:row?.uid,row?.guardianUid].filter(uidOK))];
const empty=()=>Object.fromEntries(COUNTERS.map(k=>[k,0]));
const validCounts=c=>c&&Object.keys(c).length===COUNTERS.length&&COUNTERS.every(k=>Number.isSafeInteger(c[k])&&c[k]>=0);
function target(room){if(!room.exists)return 'missing';const x=normalizeLifecycle(room.data());return x.status==='supported'?(x.active?'active':'inactive'):x.status;}
function bucket(r){return r.kind==='self'&&r.status==='confirmed'?'selfConfirmed':r.kind==='self'&&r.status==='waitlist'?'selfWaitlist':r.kind==='family'&&r.status==='confirmed'?'familyConfirmed':r.kind==='family'&&r.status==='waitlist'?'familyWaitlist':'unsupported';}
function summary(uid,code,inc,counts,t,at,unresolved=false){return {schemaVersion:SCHEMA,release:RELEASE,code,ownerUid:uid,roomIncarnation:inc,counts,candidate:unresolved||t==='invalid'||t==='unsupported'||t==='active'&&COUNTERS.some(k=>counts[k]>0),state:unresolved||t==='invalid'?'unresolved':t==='unsupported'||counts.unsupported>0?'unsupported':'ready',updatedAt:at};}
function createEngine({bridge,enabled=false,clock=Date.now,documentId='__name__',hooks={}}={}){
 const disabled=async()=>({status:'disabled'});if(enabled!==true)return {ingestRegistration:disabled,recordRoom:disabled,processPage:disabled,repair:disabled};
 if(!bridge?.run||!bridge?.doc||!bridge?.collection)throw Error('bridge-required');
 const now=()=>{const n=clock();if(!Number.isSafeInteger(n)||n<0)throw Error('invalid-clock');return n;};
 const checked=(code,id)=>{if(!keyOK(code)||id!==undefined&&!segmentOK(id))throw Error('invalid-source-path');};
 const refPath=(code,id)=>PATHS.refs+'/'+code+'/registrations/'+id;
 const member=(uid,code)=>bridge.doc('users/'+uid+'/myEventRooms/'+code);
 const ownerError=(uid,code,id,kind='registration')=>bridge.doc('users/'+uid+'/myEventErrors/'+createHash('sha256').update(JSON.stringify([kind,code,id])).digest('hex'));
 const errorData=(code,reason,at)=>({schemaVersion:SCHEMA,release:RELEASE,open:true,code,reason,updatedAt:at});
 const failureRef=(code,id,kind='registration')=>bridge.doc(PATHS.failures+'/'+createHash('sha256').update(JSON.stringify([kind,code,id])).digest('hex'));
 const jobRef=code=>bridge.doc(PATHS.jobs+'/'+code);
 async function ingestRegistration({code,id,expectedRoomIncarnation,expectedRebuildGeneration,rebuildLease}){checked(code,id);return (await bridge.run('v24-registration',async tx=>{
  const rr=bridge.doc(refPath(code,id)),fr=failureRef(code,id),pageFr=failureRef(code,id,'lifecycle');
  const [row,room,previous,failed,pageFailed,rebuildJob]=await Promise.all([tx.get(bridge.doc('tournaments/'+code+'/registrations/'+id)),tx.get(bridge.doc('tournaments/'+code)),tx.get(rr),tx.get(fr),tx.get(pageFr),tx.get(bridge.doc('myEventRebuildsV26/'+code))]);
  const old=previous.data(),inc=stamp(room.createTime),ct=stamp(row.createTime),ut=stamp(row.updateTime),t=target(room),at=now();
  const receipt=(value,eligible=false)=>({...value,receiptEligible:eligible,roomIncarnation:inc,roomTarget:t,sourcePath:'tournaments/'+code+'/registrations/'+id,sourceCreateTime:ct,sourceUpdateTime:ut});
  if(expectedRoomIncarnation!==undefined&&(!stamp(expectedRoomIncarnation)||!same(stamp(expectedRoomIncarnation),inc)))return receipt({status:'incarnation-mismatch'});
  if(expectedRebuildGeneration!==undefined&&(rebuildJob.data()?.generation!==expectedRebuildGeneration||rebuildJob.data()?.dualWrite!==true))return receipt({status:'stale-rebuild'});
  if(rebuildJob.data()?.dualWrite===true)return require('./rebuild.cjs').reconcileInTransaction({bridge,tx,code,id,row,room,previous,failed,pageFailed,jobSnapshot:rebuildJob,at,clock:now,expectedRebuildGeneration,rebuildLease});
  let next=null,invalid=null,unsupported=false,knownSourceOwners=false;
  const rawPriorHints=Array.isArray(old?.sourceOwnerHints)?old.sourceOwnerHints:[old?.ownerUid].filter(uidOK),priorHints=rawPriorHints.slice(0,2),currentHints=row.exists?ownerHints(row.data()):[];
  if(rawPriorHints.length>2||priorHints.some(u=>!uidOK(u))||old&&!priorHints.includes(old.ownerUid))invalid='invalid-reverse-hints';
  if(old&&(!uidOK(old.ownerUid)||!stamp(old.roomIncarnation)||!stamp(old.registrationCreateTime)||!stamp(old.registrationUpdateTime)||old.schemaVersion!==SCHEMA||old.release!==RELEASE||!['self','family','unsupported'].includes(old.kind)||!['confirmed','waitlist','unsupported'].includes(old.status)))invalid='invalid-reverse';
  if(row.exists){
   if(!ct||!ut||!inc||before(ct,inc))invalid='orphan-or-unversioned-registration';
   const owners=collectOwners({code,registrations:[{id,data:row.data()}]});
   if(owners.status==='invalid'||owners.hasUnknownOwners||owners.ownerUids.length>1)invalid='unresolved-ownership';
   knownSourceOwners=owners.status!=='invalid'&&!owners.hasUnknownOwners&&(owners.ownerUids.length>0||owners.status==='supported'&&currentHints.length>0);
   unsupported=owners.status==='unsupported';
   if(!invalid&&owners.ownerUids.length){const o=owners.owners[0],r=o.registrations[0];next={schemaVersion:SCHEMA,release:RELEASE,ownerUid:o.uid,kind:r.kind,status:r.status,registrationCreateTime:ct,registrationUpdateTime:ut,roomIncarnation:inc,sourceOwnerHints:currentHints};}
  }
  if(!row.exists&&old&&!same(old.roomIncarnation,inc)&&rebuildJob.data()?.quarantined===true&&!invalid){invalid='orphan-or-unversioned-registration';knownSourceOwners=uidOK(old.ownerUid)&&!!stamp(old.roomIncarnation);}
  const uids=[...new Set([...priorHints,...currentHints].filter(uidOK))];if(uids.length>4)throw Error('affected-owner-budget');
  const docs=await Promise.all(uids.map(uid=>tx.get(member(uid,code))));
  const errorUids=[...new Set([...uids,...(Array.isArray(failed.data()?.errorOwnerUids)?failed.data().errorOwnerUids.slice(0,4).filter(uidOK):[])])];
  const errors=await Promise.all(errorUids.map(uid=>tx.get(ownerError(uid,code,id))));
  const knownError=reason=>{for(let i=0;i<errorUids.length;i++){if(uids.includes(errorUids[i]))tx.set(ownerError(errorUids[i],code,id),errorData(code,reason,at));else if(errors[i].exists)tx.delete(ownerError(errorUids[i],code,id));}tx.set(fr,{...errorData(code,reason,at),open:false,errorOwnerUids:uids});return receipt({status:'unresolved',reason,affectedOwners:uids.length});};
  if(invalid){
   if(invalid==='orphan-or-unversioned-registration'&&knownSourceOwners&&rebuildJob.data()?.quarantined===true){const generation=rebuildJob.data().generation;for(let i=0;i<uids.length;i++){tx.set(member(uids[i],code),{...(docs[i].data()||summary(uids[i],code,inc,empty(),t,at,true)),candidate:true,state:'unresolved',quarantinedRebuildGeneration:generation});tx.set(ownerError(uids[i],code,id),errorData(code,invalid,at));}tx.set(fr,{...errorData(code,invalid,at),open:false,disposition:'quarantined',errorOwnerUids:uids,quarantineGeneration:generation});return receipt({status:'quarantined',reason:invalid,affectedOwners:uids.length});}
   for(let i=0;i<errorUids.length;i++)if(!uids.includes(errorUids[i])&&errors[i].exists)tx.delete(ownerError(errorUids[i],code,id));
   for(const uid of uids)tx.set(ownerError(uid,code,id),errorData(code,invalid,at));
   tx.set(fr,{schemaVersion:SCHEMA,release:RELEASE,open:true,code,reason:invalid,errorOwnerUids:uids,updatedAt:at});return receipt({status:'unresolved',reason:invalid,affectedOwners:uids.length});
  }
  // Idempotency checks the current source version, never the delivered event version.
  if(old&&next&&old.ownerUid===next.ownerUid&&old.kind===next.kind&&old.status===next.status&&same(old.registrationCreateTime,ct)&&same(old.registrationUpdateTime,ut)&&same(old.roomIncarnation,inc)&&!failed.exists&&!pageFailed.exists&&!errors.some(e=>e.exists)&&docs.every(d=>{const s=d.data();if(!s||!validCounts(s.counts)||!same(s.roomIncarnation,inc))return false;const expected=summary(s.ownerUid,code,inc,s.counts,t,at);return s.candidate===expected.candidate&&s.state===expected.state&&s.schemaVersion===SCHEMA&&s.ownerUid===d.ref?.path.split('/')[1]&&(!next||s.ownerUid!==next.ownerUid||s.counts[bucket(next)]>0);}))return receipt({status:'noop'},!unsupported&&['active','inactive'].includes(t)&&docs.every(d=>d.data()?.state==='ready'&&d.data().counts.unsupported===0));
  for(let i=0;i<uids.length;i++){
   const uid=uids[i],stored=docs[i].data();
   if(stored&&(!validCounts(stored.counts)||stored.schemaVersion!==SCHEMA||stored.ownerUid!==uid)){return knownError('invalid-summary');}
  }
  const updates=[];
  for(let i=0;i<uids.length;i++){
   const uid=uids[i],stored=docs[i].data(),counts=stored&&same(stored.roomIncarnation,inc)?{...stored.counts}:empty();
   if(old?.ownerUid===uid&&same(old.roomIncarnation,inc)){const k=bucket(old);if(counts[k]<1){return knownError('counter-underflow');}counts[k]--;}
   if(next?.ownerUid===uid){const k=bucket(next);if(counts[k]>=Number.MAX_SAFE_INTEGER)return knownError('counter-overflow');counts[k]++;}
   updates.push([member(uid,code),summary(uid,code,inc,counts,t,at)]);
  }
  if(hooks.beforeRegistrationWrite)await hooks.beforeRegistrationWrite({code,id});
  for(const [ref,value]of updates)tx.set(ref,value);if(next)tx.set(rr,next);else if(previous.exists)tx.delete(rr);if(failed.exists)tx.delete(fr);if(pageFailed.exists)tx.delete(pageFr);for(let i=0;i<errorUids.length;i++){if(unsupported&&currentHints.includes(errorUids[i]))tx.set(ownerError(errorUids[i],code,id),errorData(code,'unsupported-registration',at));else if(errors[i].exists)tx.delete(ownerError(errorUids[i],code,id));}
  return receipt({status:'applied',affectedOwners:uids.length},!unsupported&&['active','inactive'].includes(t)&&updates.every(([,value])=>value.state==='ready'&&value.counts.unsupported===0));
 })).value;}
 function makeJob(code,room,old,at){if(old&&(old.schemaVersion!==SCHEMA||old.release!==RELEASE||old.code!==code||!Number.isSafeInteger(old.revision)||old.revision<1||old.revision===Number.MAX_SAFE_INTEGER))throw Error('invalid-job');const t=target(room),inc=stamp(room.createTime);if(old&&old.target===t&&same(old.roomIncarnation,inc))return null;return {schemaVersion:SCHEMA,release:RELEASE,code,target:t,roomIncarnation:inc,revision:(old?.revision||0)+1,dirty:true,restoration:t==='active'&&!!old&&old.target!=='active',cursor:null,leaseToken:null,leaseUntil:0,dueAt:at,updatedAt:at};}
 async function recordRoom({code}){checked(code);return (await bridge.run('v24-room-intent',async tx=>{const [room,job]=await Promise.all([tx.get(bridge.doc('tournaments/'+code)),tx.get(jobRef(code))]);const next=makeJob(code,room,job.data(),now());if(!next)return {status:'noop'};tx.set(jobRef(code),next);return {status:'queued',revision:next.revision};})).value;}
 async function claim(code){return (await bridge.run('v24-page-claim',async tx=>{const d=await tx.get(jobRef(code)),j=d.data(),at=now();if(!j)return {status:'idle'};if(j.schemaVersion!==SCHEMA||j.release!==RELEASE||j.code!==code||!Number.isSafeInteger(j.revision)||j.revision<1||typeof j.dirty!=='boolean'||!Number.isSafeInteger(j.leaseUntil)||j.leaseUntil<0||j.cursor!==null&&!segmentOK(j.cursor))throw Error('invalid-job');if(!j.dirty)return {status:'idle'};if(j.leaseUntil>at)return {status:'busy'};const token=randomUUID();tx.set(jobRef(code),{...j,leaseToken:token,leaseUntil:at+LEASE_MS,dueAt:at+LEASE_MS});return {status:'claimed',code,token,revision:j.revision};})).value;}
 async function processPage(code){checked(code);const c=await claim(code);if(c.status!=='claimed')return c;if(hooks.afterClaim)await hooks.afterClaim(c);
  return (await bridge.run('v24-lifecycle-page',async tx=>{
   const [job,room,rebuild]=await Promise.all([tx.get(jobRef(code)),tx.get(bridge.doc('tournaments/'+code)),tx.get(bridge.doc('myEventRebuildsV26/'+code))]),j=job.data(),at=now();
   if(rebuild.data()?.dualWrite===true)return {status:'rebuild-deferred'};
   if(!j||j.leaseToken!==c.token||j.revision!==c.revision||j.leaseUntil<=at)return {status:'stale'};
   const replacement=makeJob(code,room,j,at);if(replacement){tx.set(jobRef(code),replacement);return {status:'superseded'};}
   let q=bridge.collection(PATHS.refs+'/'+code+'/registrations').orderBy(documentId).limit(PAGE);if(j.cursor)q=q.startAfter(j.cursor);
   const rows=await tx.get(q),uids=[...new Set(rows.docs.map(d=>d.data().ownerUid).filter(uidOK))];
   const summaries=await Promise.all(uids.map(uid=>tx.get(member(uid,code))));
   if(hooks.beforePageWrite)await hooks.beforePageWrite({code,claim:c,rows});
   if(now()>=j.leaseUntil)return {status:'stale'};
   for(let i=0;i<uids.length;i++){
    const s=summaries[i].data();if(!s){tx.set(ownerError(uids[i],code,'','lifecycle'),errorData(code,'missing-summary',at));continue;}
    if(Object.hasOwn(s,'pendingRebuildGeneration')||Object.hasOwn(s,'quarantinedRebuildGeneration')){tx.set(member(uids[i],code),{...s,candidate:true,state:'unresolved',updatedAt:at});continue;}
    if(!validCounts(s.counts)||s.schemaVersion!==SCHEMA){tx.set(ownerError(uids[i],code,'','lifecycle'),errorData(code,'invalid-summary',at));continue;}
    // Old generation reverse records cannot reactivate a new generation summary.
    const eligible=same(s.roomIncarnation,j.roomIncarnation);
    const hasCurrentRef=rows.docs.some(d=>d.data().ownerUid===uids[i]&&same(d.data().roomIncarnation,s.roomIncarnation));
    if(!hasCurrentRef)continue;
    const lowerBound=empty();for(const d of rows.docs){const r=d.data();if(r.ownerUid===uids[i]&&same(r.roomIncarnation,s.roomIncarnation))lowerBound[bucket(r)]++;}
    if(COUNTERS.some(k=>s.counts[k]<lowerBound[k])){tx.set(ownerError(uids[i],code,'','lifecycle'),errorData(code,'counter-underflow',at));continue;}
    // A partial page cannot prove an entire UID/room counter repair. Keep any
    // room-wide lifecycle error until an explicitly verified recount clears it.
    tx.set(member(uids[i],code),{...s,candidate:eligible&&(j.target==='invalid'||j.target==='unsupported'||j.target==='active'&&COUNTERS.some(k=>s.counts[k]>0)),state:j.target==='invalid'?'unresolved':j.target==='unsupported'||s.counts.unsupported>0?'unsupported':'ready',updatedAt:at});
   }
   for(const d of rows.docs){const r=d.data();const ownedSummary=summaries[uids.indexOf(r.ownerUid)]?.data();if(ownedSummary&&Object.hasOwn(ownedSummary,'quarantinedRebuildGeneration'))continue;if(!uidOK(r.ownerUid)||!stamp(r.roomIncarnation)||!same(r.roomIncarnation,j.roomIncarnation)&&j.target!=='missing')tx.set(failureRef(code,d.id,'lifecycle'),errorData(code,'orphan-reverse-incarnation',at));}
   const done=rows.size<PAGE;tx.set(jobRef(code),{...j,cursor:rows.size?rows.docs.at(-1).id:j.cursor,dirty:!done,leaseToken:null,leaseUntil:0,dueAt:at,updatedAt:at});
   return {status:done?'completed':'page',rows:rows.size,owners:uids.length,revision:j.revision};
  })).value;
 }
 async function repair(){const q=bridge.collection(PATHS.jobs).where('release','==',RELEASE).where('dirty','==',true).where('dueAt','<=',now()).orderBy('dueAt').limit(8);const r=await bridge.run('v24-repair-list',tx=>tx.get(q),{readOnly:true});const out=[];for(const d of r.value.docs)out.push(await processPage(d.id));return {status:'repaired',pages:out};}
 return {ingestRegistration,recordRoom,processPage,repair};
}
module.exports={createEngine,SCHEMA,RELEASE,PAGE,LEASE_MS,COUNTERS,PATHS,bucket,validCounts,stamp,same,target,summary};
