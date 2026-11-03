'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=__dirname,source=path.join(root,'fixtures/delete'),code='BXH-TEST01',uid='admin',operationId='delete-operation-0001';
const clone=x=>x===undefined?undefined:JSON.parse(JSON.stringify(x));
function fixture(){
 let time=10;const rows=new Map(),writes=[],recursive=[],commits=[];let interfere,failChild=false,childGate;
 const put=(p,data)=>{const old=rows.get(p);rows.set(p,{data:clone(data),version:++time,created:old?.created||time});};
 const state={id:'room',cloudCode:code,meta:{stations:6,eventAuthority:'official',formatType:'single'},players:[],matches:[]};
 put('tournaments/'+code,{eventAuthority:'official',createdBy:'host',updatedAt:1,data:JSON.stringify(state),refereeSeatsV1:{version:1}});
 put('publicTournaments/'+code,{updatedAt:1,bracketView:JSON.stringify(state)});put('users/'+uid,{active:true,role:'super_admin'});
 put('tournaments/'+code+'/registrations/r1',{uid:'synthetic'});put('tournamentActivity/'+code,{lastAt:1});
 const reference=p=>({path:p,id:p.split('/').at(-1),get:async()=>snapshot(p),collection:c=>query(p+'/'+c),set:async(d,o)=>apply('set',p,d,o),listCollections:async()=>[...new Set([...rows.keys()].filter(k=>k.startsWith(p+'/')).map(k=>k.slice(p.length+1).split('/')[0]))].map(n=>query(p+'/'+n))});
 const snapshot=p=>{const v=rows.get(p);return {ref:reference(p),id:p.split('/').at(-1),exists:!!v,createTime:v?{seconds:v.created,nanoseconds:0}:undefined,data:()=>clone(v?.data)};};
 function query(p){let max=Infinity;const q={path:p,id:p.split('/').at(-1),query:true,doc:n=>reference(p+'/'+n),where(){return q;},limit(n){max=n;return q;},get:async()=>{const docs=[...rows.keys()].filter(k=>k.startsWith(p+'/')&&!k.slice(p.length+1).includes('/')).slice(0,max).map(snapshot);return {docs,size:docs.length};}};return q;}
 function apply(kind,p,data,options){writes.push({kind,path:p});if(kind==='delete')rows.delete(p);else put(p,kind==='update'||options?.merge?{...rows.get(p)?.data,...data}:data);}
 const db={doc:reference,collection:query,batch:()=>{const pending=[];return {delete:r=>pending.push(['delete',r.path]),commit:async()=>pending.forEach(args=>apply(...args))};},recursiveDelete:async col=>{
  assert(col.query,'parent document must never reach recursiveDelete');recursive.push(col.path);
  assert(rows.get('tournaments/'+code)?.data.bucketMigration?.status==='deleting','parent lease must remain throughout traversal');
  if(failChild){failChild=false;throw Error('synthetic child failure');}
  if(childGate)await childGate();
  for(const p of [...rows.keys()])if(p.startsWith(col.path+'/'))apply('delete',p);
 },runTransaction:async cb=>{
  for(let attempt=0;attempt<4;attempt++){
   const reads=new Map(),pending=[];
   const tx={get:async r=>{if(r.query)return r.get();reads.set(r.path,rows.get(r.path)?.version||0);return snapshot(r.path);},update:(r,d)=>pending.push(['update',r.path,d]),set:(r,d,o)=>pending.push(['set',r.path,d,o]),create:(r,d)=>pending.push(['create',r.path,d]),delete:r=>pending.push(['delete',r.path])};
   const result=await cb(tx);
   if(interfere&&pending.some(x=>x[1]==='tournaments/'+code&&x[2]?.bucketMigration)){const fn=interfere;interfere=undefined;fn();}
   if([...reads].some(([p,v])=>(rows.get(p)?.version||0)!==v))continue;
   commits.push(pending.map(x=>({kind:x[0],path:x[1]})));pending.forEach(args=>apply(...args));return result;
  }
  throw Error('retry exhausted');
 }};
 return {db,rows,put,writes,recursive,commits,set interfere(v){interfere=v;},set failChild(v){failChild=v;},set childGate(v){childGate=v;}};
}
function load(m){
 class HttpsError extends Error{constructor(code,message){super(message);this.code=code;}}
 const req=name=>{
  if(name==='firebase-functions/v2/https')return {onCall:(_o,fn)=>fn,HttpsError};
  if(name==='firebase-admin/firestore')return {getFirestore:()=>m.db,FieldValue:{serverTimestamp:()=>123,increment:n=>n}};
  if(name==='./hosting-core')return require(path.join(source,'hosting-core.js'));
  if(name==='./tournament-delete-core')return require(path.join(source,'tournament-delete-core.js'));
  return require(name);
 };
 const module={exports:{}};
 vm.runInThisContext('(function(require,module,exports,process){'+fs.readFileSync(path.resolve(root,'../../../release/buckets/deletion/tournament-delete.js'),'utf8')+'\n})')(req,module,module.exports,{env:{GCLOUD_PROJECT:'bxh-arena'}});
 return module.exports;
}
function migration(){
 const module={exports:{}};const req=n=>n==='node:crypto'?require(n):new Proxy({},{get(){throw Error('unexpected migration encoding before ownership rejection');}});
 vm.runInThisContext('(function(require,module,exports){'+fs.readFileSync(path.join(root,'fixtures/bucket-migration-plan.cjs'),'utf8')+'\n})')(req,module,module.exports);
 return module.exports;
}
const request={auth:{uid},data:{code,operationId}},intent={uid,code,operationId};
(async()=>{
 let n=0;
 for(const key of ['scoreStorage','scoreBucketProjection','bucketMigration'])for(const value of [null,false,{}, {status:'active'}, {status:'migrating'}])for(const side of ['tournaments','publicTournaments']){
  const m=fixture(),p=side+'/'+code;m.put(p,{...m.rows.get(p).data,[key]:value});const mod=load(m);
  await assert.rejects(mod.deleteTournamentSafely(request),/bucket-scoring-required|bucket-migration-in-progress/);assert.equal(m.writes.length,0);assert.equal(m.recursive.length,0);n++;
 }
 {const m=fixture();m.put('tournaments/'+code+'/matchBuckets/court-1',{matches:'[]'});await assert.rejects(load(m).deleteTournamentSafely(request),/bucket-scoring-required/);assert.equal(m.writes.length,0);n++;}
 {const m=fixture();m.put('users/'+uid,{active:false,role:'super_admin'});await assert.rejects(load(m).deleteTournamentSafely(request),/inactive-account/);assert.equal(m.writes.length,0);n++;}
 {const m=fixture(),mod=load(m);m.interfere=()=>m.put('tournaments/'+code,{...m.rows.get('tournaments/'+code).data,scoreStorage:{status:'active'}});await assert.rejects(mod.deleteTournamentSafely(request),/bucket-scoring-required/);assert.equal(m.writes.length,0);assert.equal(m.recursive.length,0);n++;}
 {const m=fixture(),mod=load(m);m.interfere=()=>{m.rows.delete('tournaments/'+code);m.put('tournaments/'+code,{data:'new room'});};await assert.rejects(mod.deleteTournamentSafely(request),/deletion-room-changed/);assert.equal(m.writes.length,0);n++;}
 {const m=fixture(),mod=load(m),job=await mod._private.claim(intent),P=migration();
  assert.throws(()=>P.prepare({action:'activate',code,epoch:'test-epoch',room:m.rows.get('tournaments/'+code).data,publicDocument:m.rows.get('publicTournaments/'+code).data,buckets:[],versions:{}}),/migration-metadata-exists/);
  const marker=m.rows.get('publicTournaments/'+code).data.bucketMigration;assert(!('actorUid' in marker)&&!('operationId' in marker)&&!('previousSystemClosed' in marker));
  const writes=m.writes.length;const waiting=await mod._private.claim({...intent,operationId:'other-operation-0001'});assert.equal(waiting.pending,true);assert.equal(waiting.result.operationId,operationId);assert.equal(m.writes.length,writes);n++;
 }
 {const m=fixture(),mod=load(m),result=await mod.deleteTournamentSafely(request);assert(result.ok);assert(!m.rows.has('tournaments/'+code));assert(!m.rows.has('publicTournaments/'+code));assert(m.recursive.every(p=>p!=='tournaments/'+code));
  const final=m.commits.find(c=>c.some(w=>w.kind==='delete'&&w.path==='tournaments/'+code));assert(final.some(w=>w.kind==='delete'&&w.path==='publicTournaments/'+code));assert.equal(m.rows.get('tournamentDeletionAudit/'+operationId).data.status,'completed');
  const count=m.recursive.length;assert((await mod.deleteTournamentSafely(request)).replayed);assert.equal(m.recursive.length,count);n++;
 }
 {const m=fixture(),mod=load(m);m.failChild=true;await assert.rejects(mod.deleteTournamentSafely(request),/synthetic child failure/);assert(m.rows.has('tournaments/'+code));assert.equal(m.rows.get('tournaments/'+code).data.bucketMigration.status,'deleting');assert((await mod.deleteTournamentSafely(request)).ok);n++;}
 {const m=fixture(),mod=load(m),job=await mod._private.claim(intent);m.put('users/'+uid,{active:false,role:'super_admin'});await assert.rejects(mod._private.finish(job,{...intent,hostRecordPreserved:false,assignmentCount:0}),/tournament-delete-denied/);assert(m.rows.has('tournaments/'+code));n++;}
 {const m=fixture(),mod=load(m),job=await mod._private.claim(intent);m.put('publicTournaments/'+code,{bracketView:'new public room'});await assert.rejects(mod._private.finish(job,{...intent,hostRecordPreserved:false,assignmentCount:0}),/deletion-public-lease-lost/);assert(m.rows.has('tournaments/'+code));assert.equal(m.rows.get('publicTournaments/'+code).data.bracketView,'new public room');n++;}
 {const m=fixture(),mod=load(m);m.rows.delete('tournaments/'+code);m.rows.delete('tournaments/'+code+'/registrations/r1');assert((await mod.deleteTournamentSafely(request)).ok);assert.equal(m.recursive.length,0);n++;}
 {const m=fixture(),mod=load(m);await mod.deleteTournamentSafely(request);m.put('tournaments/'+code,{data:'reused code'});await assert.rejects(mod.deleteTournamentSafely(request),/deletion-operation-outdated/);assert.equal(m.rows.get('tournaments/'+code).data.data,'reused code');n++;}
 {const m=fixture(),mod=load(m);m.put('tournaments/'+code,{...m.rows.get('tournaments/'+code).data,qrCheckinManaged:true});assert((await mod.deleteTournamentSafely(request)).ok);n++;}
 {const m=fixture(),mod=load(m);let unblock,entered;const started=new Promise(r=>entered=r),gate=new Promise(r=>unblock=r);
  m.childGate=async()=>{entered();await gate;};const first=mod.deleteTournamentSafely(request);await started;
  const before=m.writes.length;
  for(const op of [operationId,'old-browser-new-operation']){const result=await mod.deleteTournamentSafely({...request,data:{code,operationId:op}});assert.equal(result.pending,true);assert.equal(result.operationId,operationId);}
  assert.equal(m.writes.length,before);assert.equal(m.recursive.length,1);unblock();assert((await first).ok);n++;
 }
 {const m=fixture(),mod=load(m);m.failChild=true;await assert.rejects(mod.deleteTournamentSafely(request),/synthetic child failure/);
  assert.equal(m.rows.get('tournamentDeletionAudit/'+operationId).data.workerStatus,'paused');
  assert((await mod.deleteTournamentSafely({...request,data:{code,operationId:'retry-from-old-browser'}})).ok);
  assert(!m.rows.has('tournamentDeletionAudit/retry-from-old-browser'));assert.equal(m.rows.get('tournamentDeletionAudit/'+operationId).data.status,'completed');n++;
 }
 {const m=fixture(),mod=load(m),old=await mod._private.claim(intent);await mod._private.pause(old);const resumed=await mod._private.claim(intent);
  assert.notEqual(resumed.workerToken,old.workerToken);await mod._private.pause(old);
  assert.equal(m.rows.get('tournamentDeletionAudit/'+operationId).data.workerStatus,'active');
  await assert.rejects(mod._private.assertLease(old),/deletion-worker-lost/);
  await assert.rejects(mod._private.finish(old,{...intent,hostRecordPreserved:false,assignmentCount:0}),/deletion-lease-lost/);await mod._private.assertLease(resumed);n++;
 }
 {const m=fixture(),mod=load(m);await mod._private.claim(intent);const audit='tournamentDeletionAudit/'+operationId;
  m.put(audit,{...m.rows.get(audit).data,startedAt:1});const before=m.writes.length;assert((await mod._private.claim(intent)).pending);assert.equal(m.writes.length,before);n++;
 }
 {const m=fixture(),mod=load(m);await mod._private.claim(intent);m.put('users/other-admin',{active:true,role:'super_admin'});const before=m.writes.length;
  await assert.rejects(mod.deleteTournamentSafely({auth:{uid:'other-admin'},data:{code,operationId:'other-operator-delete'}}),/bucket-migration-in-progress/);assert.equal(m.writes.length,before);n++;
 }
 console.log(JSON.stringify({checks:n,productionWrites:0,deployed:false}));
})().catch(e=>{console.error(e);process.exitCode=1;});
