'use strict';
const {randomUUID}=require('node:crypto');
const {SCHEMA,RELEASE}=require('./engine.cjs');
const {ENGINE_VERSION:VERSION,RUNS,ROOT:REBUILDS}=require('./rebuild.cjs');
const {normalizeLifecycle,parseState}=require('./lifecycle.js');
const BOOTSTRAP_SCHEMA=26,SCOPE='individual-family',PAGE=32,LEASE_MS=15000;
const PATHS={control:'myEventsMembershipControl/rollout',runs:RUNS};
const keyOK=x=>typeof x==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(x);
const runOK=x=>typeof x==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(x);
const uidOK=x=>typeof x==='string'&&/^[^\s/]{1,128}$/.test(x);
const natural=x=>Number.isSafeInteger(x)&&x>=0;
const summaryPath=p=>typeof p==='string'&&/^users\/[^/]+\/myEventRooms\/[A-Za-z0-9_-]{1,128}$/.test(p)&&uidOK(p.split('/')[1]);
function discoveryScope(raw){const life=normalizeLifecycle(raw);if(life.status==='supported')return life.active?'active':'inactive';if(life.status==='unsupported'&&life.reason==='selection-not-finalized')return 'excluded';if(life.status==='unsupported'&&life.reason==='unsupported-room-mode'){const state=parseState(raw);if([raw,state,state?.meta].some(x=>x&&(x.battleMode==='team'||Object.hasOwn(x,'teamRegistration'))))return 'excluded';}return 'unresolved';}
const link=runId=>({schemaVersion:BOOTSTRAP_SCHEMA,runId,engineVersion:VERSION});
const matches=(p,id)=>p?.schemaVersion===BOOTSTRAP_SCHEMA&&p.runId===id&&p.engineVersion===VERSION;
function validRun(r,id){return !!r&&r.schemaVersion===BOOTSTRAP_SCHEMA&&r.runId===id&&r.engineVersion===VERSION&&r.scope===SCOPE&&r.captureMode==='same-service-engine'&&['running','complete','needs-repair'].includes(r.state)&&['rooms','summaries','waiting','complete'].includes(r.phase)&&typeof r.pending==='boolean'&&typeof r.roomDiscoveryDone==='boolean'&&typeof r.summaryDiscoveryDone==='boolean'&&['queuedRooms','completedRooms','rebuiltRooms','quarantinedRooms','failedRooms','leaseUntil','dueAt','pages','roomRows','summaryRows','skippedInactiveRooms','excludedRooms','startedAt','updatedAt'].every(k=>natural(r[k]))&&r.completedRooms<=r.queuedRooms&&r.failedRooms<=r.queuedRooms&&r.completedRooms===r.rebuiltRooms+r.quarantinedRooms&&(r.roomDiscoveryCursor===null||keyOK(r.roomDiscoveryCursor))&&(r.summaryDiscoveryCursor===null||summaryPath(r.summaryDiscoveryCursor))&&(r.leaseToken===null||typeof r.leaseToken==='string')&&(r.phase==='rooms'?!r.roomDiscoveryDone&&!r.summaryDiscoveryDone:r.phase==='summaries'?r.roomDiscoveryDone&&!r.summaryDiscoveryDone:r.roomDiscoveryDone&&r.summaryDiscoveryDone)&&(r.state==='complete'?r.phase==='complete'&&r.pending===false&&r.completedRooms===r.queuedRooms&&r.failedRooms===0&&natural(r.completedAt)&&r.disposition===(r.quarantinedRooms===0?'clean':'with-quarantine'):r.phase!=='complete'&&r.pending===(r.state==='running'));}
function shouldProcessBootstrap(event,at){
 const after=event?.data?.after,before=event?.data?.before;if(!after?.exists||!natural(at))return false;
 const a=after.data(),b=before?.exists?before.data():null;
 return a?.schemaVersion===BOOTSTRAP_SCHEMA&&a.engineVersion===VERSION&&a.state==='running'&&a.pending===true&&natural(a.dueAt)&&a.dueAt<=at&&(!b||b.state!=='running'||b.phase!==a.phase||b.roomDiscoveryCursor!==a.roomDiscoveryCursor||b.summaryDiscoveryCursor!==a.summaryDiscoveryCursor||b.completedRooms!==a.completedRooms||b.failedRooms!==a.failedRooms);
}
function createBootstrap({bridge,rebuilder,enabled=false,clock=Date.now,documentId='__name__',hooks={}}={}){
 const disabled=async()=>({status:'disabled'});if(enabled!==true)return {beginRun:disabled,processPage:disabled,finalizeRun:disabled,retryRun:disabled,captureRoom:disabled,repair:disabled};
 if(!bridge?.run||!bridge?.doc||!bridge?.collection||!bridge?.collectionGroup||typeof rebuilder?.beginRoom!=='function')throw Error('bootstrap-dependencies-required');
 const now=()=>{const n=clock();if(!natural(n))throw Error('invalid-clock');return n;};
 const runRef=id=>bridge.doc(PATHS.runs+'/'+id),controlRef=()=>bridge.doc(PATHS.control);
 const checked=id=>{if(!runOK(id))throw Error('invalid-run-id');};
 const valid=(r,id)=>{if(!validRun(r,id))throw Error('invalid-bootstrap-run');return r;};
 async function beginRun(input={}){
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>k!=='runId'))throw Error('invalid-bootstrap-input');
  const runId=input.runId===undefined?randomUUID():input.runId;checked(runId);
  return (await bridge.run('v26-bootstrap-begin',async tx=>{
   const [control,existing]=await Promise.all([tx.get(controlRef()),tx.get(runRef(runId))]),c=control.data()||{},r=existing.data();
   if(r){valid(r,runId);return {status:r.state,runId,resumed:true};}
   if(c.activeBootstrap){if(!matches(c.activeBootstrap,c.activeBootstrap.runId)||!runOK(c.activeBootstrap.runId))throw Error('invalid-active-bootstrap');const active=await tx.get(runRef(c.activeBootstrap.runId));if(!active.exists)throw Error('missing-active-bootstrap');valid(active.data(),c.activeBootstrap.runId);if(active.data().state!=='complete')return {status:'busy',runId:c.activeBootstrap.runId};}
   const at=now(),run={schemaVersion:BOOTSTRAP_SCHEMA,runId,engineVersion:VERSION,scope:SCOPE,captureMode:'same-service-engine',state:'running',phase:'rooms',pending:true,roomDiscoveryDone:false,summaryDiscoveryDone:false,roomDiscoveryCursor:null,summaryDiscoveryCursor:null,queuedRooms:0,completedRooms:0,rebuiltRooms:0,quarantinedRooms:0,failedRooms:0,leaseToken:null,leaseUntil:0,dueAt:at,pages:0,roomRows:0,summaryRows:0,skippedInactiveRooms:0,excludedRooms:0,startedAt:at,updatedAt:at};
   tx.set(runRef(runId),run);
   tx.set(controlRef(),{...c,schemaVersion:SCHEMA,release:RELEASE,scope:SCOPE,enabled:c.enabled===true,baselineComplete:false,bootstrap:null,activeBootstrap:link(runId),updatedAt:at});
   return {status:'started',runId};
  })).value;
 }
 async function claim(runId){checked(runId);return (await bridge.run('v26-bootstrap-claim',async tx=>{
  const [doc,control]=await Promise.all([tx.get(runRef(runId)),tx.get(controlRef())]);if(!doc.exists)return {status:'missing'};
  const r=valid(doc.data(),runId),at=now();if(r.state!=='running')return {status:r.state};if(!matches(control.data()?.activeBootstrap,runId))return {status:'superseded'};if(r.leaseUntil>at)return {status:'busy'};
  const token=randomUUID();tx.set(runRef(runId),{...r,leaseToken:token,leaseUntil:at+LEASE_MS,dueAt:at+LEASE_MS,updatedAt:at});
  return {status:'claimed',runId,token,phase:r.phase,cursor:r.phase==='rooms'?r.roomDiscoveryCursor:r.summaryDiscoveryCursor};
 })).value;}
 const owns=(r,c,at)=>r&&r.state==='running'&&r.leaseToken===c.token&&r.leaseUntil>at&&r.phase===c.phase&&(r.phase==='rooms'?r.roomDiscoveryCursor:r.summaryDiscoveryCursor)===c.cursor;
 async function failClaim(c,reason){return (await bridge.run('v26-bootstrap-failed',async tx=>{
  const d=await tx.get(runRef(c.runId)),r=d.data(),at=now();if(!owns(r,c,at))return {status:'stale'};
  tx.set(runRef(c.runId),{...r,state:'needs-repair',pending:false,leaseToken:null,leaseUntil:0,dueAt:at,updatedAt:at,failureReason:reason});return {status:'needs-repair',reason};
 })).value;}
 async function finalizeRun(runId){checked(runId);return (await bridge.run('v26-bootstrap-finalize',async tx=>{
  const [doc,control]=await Promise.all([tx.get(runRef(runId)),tx.get(controlRef())]);if(!doc.exists)return {status:'missing'};
  const r=valid(doc.data(),runId),c=control.data()||{},at=now();if(r.state==='complete')return {status:'complete',runId};if(r.state!=='running')return {status:r.state};if(!matches(c.activeBootstrap,runId))return {status:'superseded'};
  if(!r.roomDiscoveryDone||!r.summaryDiscoveryDone||r.phase!=='waiting'||r.completedRooms!==r.queuedRooms||r.completedRooms!==r.rebuiltRooms+r.quarantinedRooms||r.failedRooms!==0)return {status:'waiting',queuedRooms:r.queuedRooms,completedRooms:r.completedRooms,failedRooms:r.failedRooms};
  tx.set(runRef(runId),{...r,state:'complete',phase:'complete',pending:false,leaseToken:null,leaseUntil:0,dueAt:at,updatedAt:at,completedAt:at,disposition:r.quarantinedRooms===0?'clean':'with-quarantine'});
  tx.set(controlRef(),{...c,schemaVersion:SCHEMA,release:RELEASE,scope:SCOPE,baselineComplete:true,bootstrap:link(runId),activeBootstrap:null,updatedAt:at});
  return {status:'complete',runId,queuedRooms:r.queuedRooms,rebuiltRooms:r.rebuiltRooms,quarantinedRooms:r.quarantinedRooms,disposition:r.quarantinedRooms===0?'clean':'with-quarantine'};
 })).value;}
 async function processPage(runId){
  const c=await claim(runId);if(c.status!=='claimed')return c;if(hooks.afterClaim)await hooks.afterClaim(c);
  if(c.phase==='waiting'){
   const out=await finalizeRun(runId);if(out.status==='waiting')await bridge.run('v26-bootstrap-wait',async tx=>{const d=await tx.get(runRef(runId)),r=d.data(),at=now();if(owns(r,c,at))tx.set(runRef(runId),{...r,leaseToken:null,leaseUntil:0,dueAt:at+LEASE_MS,updatedAt:at});});return out;
  }
  let q=c.phase==='rooms'?bridge.collection('tournaments'):bridge.collectionGroup('myEventRooms');q=q.orderBy(documentId).limit(PAGE);if(c.cursor)q=q.startAfter(c.phase==='rooms'?c.cursor:bridge.doc(c.cursor));
  const rows=(await bridge.run('v26-bootstrap-discover',tx=>tx.get(q),{readOnly:true})).value;
  // Parse every row before enqueueing. Malformed/unknown owners never silently disappear.
  const codes=[];let skippedInactive=0,excluded=0;for(const d of rows.docs){
   if(c.phase==='rooms'){if(!keyOK(d.id)||d.ref?.path!=='tournaments/'+d.id)return failClaim(c,'invalid-canonical-room-path');const scope=discoveryScope(d.data());if(scope==='unresolved')return failClaim(c,'unresolved-room-scope');if(scope==='inactive')skippedInactive++;else if(scope==='excluded')excluded++;else codes.push(d.id);}
   else{const path=d.ref?.path,v=d.data();if(!summaryPath(path)||v?.ownerUid!==path.split('/')[1]||v?.code!==path.split('/')[3])return failClaim(c,'invalid-existing-summary-owner');codes.push(v.code);}
  }
  if(hooks.afterDiscovery)await hooks.afterDiscovery({claim:c,rows});
  for(const code of new Set(codes)){
   // Idempotent beginRoom transaction owns queuedRooms and per-room run linkage.
   const out=await rebuilder.beginRoom({code,runId});
   if(out?.status==='busy'){await bridge.run('v26-bootstrap-enqueue-wait',async tx=>{const d=await tx.get(runRef(runId)),r=d.data(),at=now();if(owns(r,c,at))tx.set(runRef(runId),{...r,leaseToken:null,leaseUntil:0,dueAt:at+LEASE_MS,updatedAt:at});});return {status:'waiting-room',code};}
   if(!['queued','existing','needs-repair'].includes(out?.status))return failClaim(c,'room-enqueue-rejected');
  }
  if(hooks.beforeCheckpoint)await hooks.beforeCheckpoint({claim:c,rows});
  return (await bridge.run('v26-bootstrap-checkpoint',async tx=>{
   const [d,control]=await Promise.all([tx.get(runRef(runId)),tx.get(controlRef())]),r=d.data(),at=now();if(!owns(r,c,at)||!matches(control.data()?.activeBootstrap,runId))return {status:'stale'};
   valid(r,runId);const done=rows.size<PAGE,last=rows.size?(c.phase==='rooms'?rows.docs.at(-1).id:rows.docs.at(-1).ref.path):c.cursor;
   const next={...r,leaseToken:null,leaseUntil:0,dueAt:at,updatedAt:at,pages:r.pages+1};
   if(c.phase==='rooms'){next.roomDiscoveryCursor=last;next.roomRows=r.roomRows+rows.size;next.skippedInactiveRooms=r.skippedInactiveRooms+skippedInactive;next.excludedRooms=r.excludedRooms+excluded;next.roomDiscoveryDone=done;if(done)next.phase='summaries';}
   else{next.summaryDiscoveryCursor=last;next.summaryRows=r.summaryRows+rows.size;next.summaryDiscoveryDone=done;if(done)next.phase='waiting';}
   if(!natural(next.pages)||!natural(next.roomRows)||!natural(next.summaryRows)||!natural(next.skippedInactiveRooms)||!natural(next.excludedRooms))throw Error('bootstrap-counter-overflow');
   tx.set(runRef(runId),next);return {status:done?'phase-complete':'page',phase:c.phase,rows:rows.size,runId};
  })).value;
 }
 async function retryRun(runId){checked(runId);return (await bridge.run('v26-bootstrap-retry',async tx=>{const [d,c]=await Promise.all([tx.get(runRef(runId)),tx.get(controlRef())]);if(!d.exists)return {status:'missing'};const r=valid(d.data(),runId),at=now();if(!matches(c.data()?.activeBootstrap,runId))return {status:r.state==='complete'?'complete':'superseded'};if(r.state!=='needs-repair')return {status:r.state};if(Object.hasOwn(r,'failureCode'))return {status:'needs-repair',reason:'capture-revalidation-required'};const next={...r,state:'running',pending:true,leaseToken:null,leaseUntil:0,dueAt:at,updatedAt:at};delete next.failureReason;delete next.failureCode;tx.set(runRef(runId),next);return {status:'queued',runId};})).value;}
 async function captureRoom({code}={}){
  if(!keyOK(code))throw Error('invalid-room-code');
  const c=(await bridge.run('v26-bootstrap-capture',tx=>tx.get(controlRef()),{readOnly:true})).value.data(),p=c?.activeBootstrap;
  if(!p)return {status:'idle'};if(!runOK(p.runId)||!matches(p,p.runId))throw Error('invalid-active-bootstrap');
  const current=(await bridge.run('v26-bootstrap-capture-scope',async tx=>{const [room,job]=await Promise.all([tx.get(bridge.doc('tournaments/'+code)),tx.get(bridge.doc(REBUILDS+'/'+code))]);return {exists:room.exists,scope:room.exists?discoveryScope(room.data()):'missing',alreadyQueued:job.data()?.runId===p.runId};},{readOnly:true})).value;
  // Existing same-run work always revalidates incarnation, including close/delete.
  if(current.alreadyQueued||!current.exists||current.scope==='active')return rebuilder.beginRoom({code,runId:p.runId});
  if(current.scope==='inactive'||current.scope==='excluded')return {status:'out-of-scope',reason:current.scope};
  return (await bridge.run('v26-bootstrap-capture-unresolved',async tx=>{const [d,control]=await Promise.all([tx.get(runRef(p.runId)),tx.get(controlRef())]),r=d.data(),at=now();if(!r||r.state!=='running'||!matches(control.data()?.activeBootstrap,p.runId))return {status:'idle'};valid(r,p.runId);tx.set(d.ref,{...r,state:'needs-repair',pending:false,leaseToken:null,leaseUntil:0,dueAt:at,updatedAt:at,failureReason:'unresolved-room-scope',failureCode:code});return {status:'needs-repair',reason:'unresolved-room-scope'};})).value;
 }
 async function repair(){const q=bridge.collection(PATHS.runs).where('engineVersion','==',VERSION).where('state','==','running').where('pending','==',true).where('dueAt','<=',now()).orderBy('dueAt').limit(4);const rows=(await bridge.run('v26-bootstrap-repair-list',tx=>tx.get(q),{readOnly:true})).value,out=[];for(const d of rows.docs)out.push(await processPage(d.id));return {status:'repaired',pages:out};}
 return {beginRun,processPage,finalizeRun,retryRun,captureRoom,repair};
}
module.exports={createBootstrap,shouldProcessBootstrap,validRun,discoveryScope,VERSION,BOOTSTRAP_SCHEMA,SCOPE,PAGE,LEASE_MS,PATHS};
