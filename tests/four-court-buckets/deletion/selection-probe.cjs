'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const {fixture,load,code,uid,operationId}=require('./deletion-probe.cjs');
const release=path.resolve(__dirname,'../../../release/buckets/deletion');
function selection(m,baseline=false){
 const shared=load(m),cache=new Map();
 class HttpsError extends Error{constructor(code,message){super(message);this.code=code;}}
 function moduleAt(file){
  if(cache.has(file))return cache.get(file).exports;
  const mod={exports:{}};cache.set(file,mod);
  const req=n=>{
   if(n==='firebase-functions/v2/https')return {onCall:(_o,fn)=>fn,HttpsError};
   if(n==='./_qr_checkin/admin-firestore.cjs')return {getFirestore:()=>m.db,FieldValue:{serverTimestamp:()=>123,increment:n=>n},FieldPath:{documentId:()=> '__name__'}};
   if(n==='./tournament-delete')return shared;
   if(n.startsWith('.'))return moduleAt(path.resolve(path.dirname(file),n+'.js'));
   return require(n);
  };
  vm.runInThisContext('(function(require,module,exports){'+fs.readFileSync(file,'utf8')+'\n})')(req,mod,mod.exports);
  return mod.exports;
 }
 // Only the edited entry module comes from the candidate. Pure dependencies
 // always come from the exact captured deployment, not the repository default.
 const file=path.join(__dirname,'fixtures/selection/registration-selection.js');
 if(!baseline){const mod={exports:{}};cache.set(file,mod);
  const req=n=>n==='./tournament-delete'?shared:n==='firebase-functions/v2/https'?{onCall:(_o,fn)=>fn,HttpsError}:n==='./_qr_checkin/admin-firestore.cjs'?{getFirestore:()=>m.db,FieldValue:{serverTimestamp:()=>123,increment:n=>n},FieldPath:{documentId:()=> '__name__'}}:n.startsWith('.')?moduleAt(path.resolve(path.dirname(file),n+'.js')):require(n);
  vm.runInThisContext('(function(require,module,exports){'+fs.readFileSync(path.join(release,'registration-selection.js'),'utf8')+'\n})')(req,mod,mod.exports);return mod.exports;
 }
 return moduleAt(file);
}
function room(){const m=fixture(),p='tournaments/'+code;
 const t=m.rows.get(p).data;t.registrationSelection={status:'open',capacity:2,version:2};m.put(p,t);return m;
}
const request=(action,extra={})=>({auth:{uid},data:{code,operationId,action,...extra}});
const run=(m,action,extra)=>selection(m).manageRegistrationSelection(request(action,extra));
module.exports={selection,room,request};
if(require.main===module)(async()=>{
 let checks=0;
 // Every entrypoint rejects presence before parsing malformed legacy state.
 for(const field of ['scoreStorage','scoreBucketProjection','bucketMigration','deletionStatus'])
 for(const value of [null,false,0,'unknown',{},[],{status:'active'}])
 for(const side of ['tournaments','publicTournaments'])
 for(const action of ['configure','preview','draw','promote','delete','join','cancel']){
  const m=room(),p=side+'/'+code;m.put('tournaments/'+code,{...m.rows.get('tournaments/'+code).data,data:'{invalid'});m.put(p,{...m.rows.get(p).data,[field]:value});
  const selector=selection(m),fn=['join','cancel'].includes(action)?selector.lotteryRegistration:selector.manageRegistrationSelection;
  await assert.rejects(fn(request(action)),/bucket-scoring-required|bucket-migration-in-progress|deletion-in-progress/);
  assert.equal(m.writes.length,0);assert.equal(m.recursive.length,0);checks++;
 }
 // Live selector permissions differ from ordinary deletion: unassigned staff
 // may manage the selector. Retain this scope, never substitute the other policy.
 for(const [profile,tournament,allowed] of [
  [{active:true,role:'staff'},{assignedStaffUids:[]},true],
  [{active:true,role:'staff'},{assignedStaffUids:['someone-else']},false],
  [{active:true,role:'player'},{createdBy:uid},false],
  [{active:false,role:'admin'},{},false],
  [{active:true,role:'tester'},{testMode:true,eventAuthority:'test',createdBy:uid,ownerUid:uid,testExpiresAt:Date.now()+600000},true],
  [{active:true,role:'tester'},{testMode:true,eventAuthority:'test',createdBy:uid,ownerUid:'other',testExpiresAt:Date.now()+600000},false]
 ]){
  const m=room();m.put('users/'+uid,profile);m.put('tournaments/'+code,{...m.rows.get('tournaments/'+code).data,...tournament});
  if(allowed){assert((await run(m,'delete')).deleted);assert(m.recursive.every(p=>p!=='tournaments/'+code));}
  else {await assert.rejects(run(m,'delete'),/denied|inactive-account/);assert.equal(m.writes.length,0);}
  checks++;
 }
 // No selector orphan cleanup, and no adoption of a previously unleased worker.
 {const m=room();m.rows.delete('tournaments/'+code);await assert.rejects(run(m,'delete'),/tournament-not-found/);assert.equal(m.writes.length,0);checks++;}
 for(const fragment of [{deletionStatus:null},{registrationSelection:{status:'deleting'}}]){
  const m=room();m.rows.delete('tournaments/'+code);m.put('publicTournaments/'+code,{...m.rows.get('publicTournaments/'+code).data,...fragment});
  await assert.rejects(load(m).deleteTournamentSafely({auth:{uid},data:{code,operationId}}),/orphan-lease-requires-review/);assert.equal(m.writes.length,0);checks++;
 }
 for(const side of ['tournaments','publicTournaments']){const m=room(),p=side+'/'+code;m.put('tournaments/'+code,{...m.rows.get('tournaments/'+code).data,data:'{invalid'});m.put(p,{...m.rows.get(p).data,registrationSelection:{status:'deleting'}});
  await assert.rejects(run(m,'delete'),/legacy-worker-requires-review/);assert.equal(m.writes.length,0);checks++;
 }
 {const m=room();m.put('tournaments/'+code,{...m.rows.get('tournaments/'+code).data,registrationSelection:{status:'drawing'}});await assert.rejects(run(m,'delete'),/draw-processing/);assert.equal(m.writes.length,0);checks++;}
 {const m=room();m.put('publicTournaments/'+code,{...m.rows.get('publicTournaments/'+code).data,onsiteWaitlistServerOwned:true});await assert.rejects(run(m,'delete'),/onsite-waitlist-managed/);assert.equal(m.writes.length,0);checks++;}
 // A parent ownership change during claim retries cannot start traversal.
 for(const change of ['bucket','recreated']){const m=room();m.interfere=()=>{
  if(change==='recreated')m.rows.delete('tournaments/'+code);
  m.put('tournaments/'+code,{...m.rows.get('tournaments/'+code)?.data,scoreStorage:{status:'active'}});
 };await assert.rejects(run(m,'delete'),/bucket-scoring-required|deletion-room-changed/);assert.equal(m.writes.length,0);assert.equal(m.recursive.length,0);checks++;}
 // Cross-entrypoint retries share the same canonical worker and operation ID.
 {const m=room();let enter,release;const started=new Promise(r=>enter=r),gate=new Promise(r=>release=r);
  m.childGate=async()=>{enter();await gate;};const first=run(m,'delete');await started;
  const before=m.writes.length;const result=await load(m).deleteTournamentSafely({auth:{uid},data:{code,operationId:'another-delete-operation'}});
  assert(result.pending);assert.equal(result.operationId,operationId);assert.equal(m.writes.length,before);assert.equal(m.recursive.length,1);release();assert((await first).deleted);checks++;
 }
 {const m=room();m.failChild=true;await assert.rejects(run(m,'delete'),/synthetic child failure/);
  assert.equal(m.rows.get('tournamentDeletionAudit/'+operationId).data.workerStatus,'paused');
  assert((await run(m,'delete')).deleted);assert((await run(m,'delete')).replayed);
  m.put('tournaments/'+code,{data:'new room'});await assert.rejects(run(m,'delete'),/deletion-operation-outdated/);assert.equal(m.rows.get('tournaments/'+code).data.data,'new room');checks++;
 }
 // Inject migration after freeze, persisted plan, and registration writes.
 // Each later phase must stop, including the finally lease cleanup.
 for(const phase of ['frozen','plan','rows'])for(const side of ['tournaments','publicTournaments']){
  const m=room(),prefix='tournaments/'+code;
  for(const [i,id]of ['r1','r2'].entries())m.put(prefix+'/registrations/'+id,{status:'pending_draw',displayName:id,createdAt:i+1});
  const native=m.db.runTransaction;let injected=false,writesBefore;
  m.db.runTransaction=async cb=>{const result=await native(cb);
   const plan=m.rows.has(prefix+'/registrationDraw/current'),patched=m.rows.get(prefix+'/registrations/r1').data.drawOperationId;
   const ready=phase==='frozen'?m.rows.get(prefix)?.data.registrationSelection.status==='drawing':phase==='plan'?plan:patched;
   if(!injected&&ready){injected=true;const p=side+'/'+code;m.put(p,{...m.rows.get(p).data,bucketMigration:{status:'preparing'}});writesBefore=m.writes.length;}
   return result;
  };
  const C=require('./fixtures/selection/operations-core.js'),candidateHash=C.poolHash([{uid:'r1',at:1},{uid:'r2',at:2}]);
  await assert.rejects(run(m,'draw',{candidateHash}),/bucket-scoring-required/);assert(injected);assert.equal(m.writes.length,writesBefore);checks++;
 }
 // Legacy short operation IDs remain valid through the selector route.
 {const m=room();assert((await selection(m).manageRegistrationSelection(request('delete',{operationId:'a'}))).deleted);checks++;}
 // Non-destructive legacy configure still returns and writes the same data.
 {const a=room(),b=room();for(const m of [a,b])m.put('publicTournaments/'+code,{...m.rows.get('publicTournaments/'+code).data,registrationEnabled:true});
  const fixed=Date.now;Date.now=()=>1900000000000;
  try{const resultA=await selection(a,true).manageRegistrationSelection(request('configure',{capacity:8})),resultB=await run(b,'configure',{capacity:8});assert.deepEqual(resultB,resultA);assert.deepEqual(b.writes,a.writes);assert.deepEqual([...b.rows],[...a.rows]);}finally{Date.now=fixed;}checks++;
 }
 console.log(JSON.stringify({selectionChecks:checks,productionWrites:0,deploymentPerformed:false}));
})().catch(e=>{console.error(e);process.exitCode=1;});
