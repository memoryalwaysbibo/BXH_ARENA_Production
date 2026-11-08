'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=__dirname,release=path.resolve(root,'../../../release/buckets/admissions');
const specs=JSON.parse(fs.readFileSync(path.join(release,'patch-manifest.json'))).patches;
const NOW=1900000000000,code='BXH-TEST01',uid='admin',clone=x=>x===undefined?undefined:JSON.parse(JSON.stringify(x));
function memory(){
 const rows=new Map(),versions=new Map(),created=new Map(),writes=[];let interfere;let serial=0;
 const put=(p,d)=>{rows.set(p,clone(d));versions.set(p,++serial);if(!created.has(p))created.set(p,serial);};
 const snapshot=p=>({id:p.split('/').at(-1),ref:ref(p),exists:rows.has(p),data:()=>clone(rows.get(p)),createTime:{seconds:created.get(p),nanoseconds:0},updateTime:{seconds:11,nanoseconds:0}});
 const ref=p=>({path:p,id:p.split('/').at(-1),collection:c=>query(p+'/'+c),get:async()=>snapshot(p)});
 function query(p){let maximum=Infinity;const filters=[];const q={query:true,path:p,doc:id=>ref(p+'/'+id),where(...f){filters.push(f);return q;},limit(n){maximum=n;return q;},orderBy(){return q;},get:async()=>{const docs=[...rows.keys()].filter(k=>k.startsWith(p+'/')&&!k.slice(p.length+1).includes('/')&&filters.every(([f,op,v])=>op==='=='&&rows.get(k)[f]===v)).slice(0,maximum).map(snapshot);return {docs,size:docs.length,empty:!docs.length};}};return q;}
 function apply(kind,p,value,options){if(kind==='create')assert(!rows.has(p));writes.push({kind,path:p,value:clone(value),options:clone(options)});if(kind==='delete'){rows.delete(p);created.delete(p);versions.set(p,++serial);return;}const next=kind==='update'||options?.merge?{...rows.get(p)}:{};for(const [k,v]of Object.entries(value)){if(v&&v.__increment!==undefined)next[k]=Number(next[k]||0)+v.__increment;else next[k]=clone(v);}put(p,next);}
 const db={doc:ref,collection:query,runTransaction:async cb=>{for(let attempt=0;attempt<4;attempt++){
  const reads=new Map(),pending=[];const get=async r=>{assert.equal(pending.length,0,'read after write');if(r.query)return r.get();reads.set(r.path,versions.get(r.path)||0);return snapshot(r.path);};
  const tx={get,getAll:(...refs)=>Promise.all(refs.map(get)),set:(r,d,o)=>pending.push(['set',r.path,d,o]),update:(r,d)=>pending.push(['update',r.path,d]),create:(r,d)=>pending.push(['create',r.path,d]),delete:r=>pending.push(['delete',r.path])};
  const result=await cb(tx);if(interfere&&pending.length){const fn=interfere;interfere=null;fn();}
  if([...reads].some(([p,v])=>(versions.get(p)||0)!==v))continue;pending.forEach(args=>apply(...args));return result;
 }throw Error('retry exhausted');}};
 return {db,rows,put,writes,remove:p=>{rows.delete(p);created.delete(p);versions.set(p,++serial);},set interfere(x){interfere=x;}};
}

function load(spec,patched,m){
 const base=path.join(root,'fixtures',String(spec.sourceSet)),cache=new Map();class FixedDate extends Date{static now(){return NOW;}}
 const sdk={getFirestore:()=>m.db,FieldValue:{serverTimestamp:()=>NOW,increment:n=>({__increment:n})},FieldPath:{documentId:()=> '__name__'}};
 function moduleAt(filename){if(cache.has(filename))return cache.get(filename).exports;
  const module={exports:{}};cache.set(filename,module);
  const actual=patched&&filename===path.join(base,spec.path)?path.join(release,'candidate',String(spec.sourceSet),spec.path):filename;
  function req(n){
   if(n==='./_qr_checkin/admin-firestore.cjs')return sdk;
   if(n==='firebase-functions/v2/https'){class HttpsError extends Error{constructor(code,message){super(message);this.code=code;}}return {onCall:(_o,fn)=>fn,HttpsError};}
   if(n==='node:crypto')return {...require(n),randomInt:(min)=>min,randomUUID:()=> 'synthetic-operation-id'};
   if(n.startsWith('.')){const p=path.resolve(path.dirname(filename),n),resolved=[p,p+'.js',p+'.cjs'].find(x=>fs.existsSync(x));if(!resolved||!resolved.startsWith(base+path.sep))throw Error('unexpected dependency '+n);return moduleAt(resolved);}return require(n);
  }
  vm.runInThisContext('(function(require,module,exports,Date){'+fs.readFileSync(actual,'utf8')+'\n})',{filename:actual})(req,module,module.exports,FixedDate);return module.exports;
 }
 const mod=moduleAt(path.join(base,spec.path));return spec.function==='registrationInvitations'?mod.createRegistrationInvitationService(m.db,()=>NOW):mod[spec.function];
}
function fixture(spec,action){
 const m=memory(),state={meta:{formatType:'single'},players:[{id:'p1',name:'One',checkedIn:true},{id:'p2',name:'Two',checkedIn:true},{id:'p3',name:'Three',checkedIn:true}],matches:[]};
 const t={createdBy:uid,ownerUid:uid,eventAuthority:'official',tournamentPhase:'waiting',data:JSON.stringify(state),capacity:10,confirmedCount:0,waitlistCount:0,waitlistEnabled:true,waitlistCapacity:10};
 const pub={bracketView:JSON.stringify(state),capacity:10,confirmedCount:0,waitlistCount:0,registrationEnabled:true,registrationVisibility:'public',registrationOpenAt:NOW-1000,registrationCloseAt:NOW+100000};
 m.put('users/'+uid,{active:true,role:'super_admin',realName:'Synthetic',phone:'0900000000',profileCompleted:true});m.put('users/target',{active:true,role:'player',realName:'Target',phone:'0900000001',profileCompleted:true});
 if(spec.function==='lotteryRegistration')t.registrationSelection={status:'open',capacity:2,version:2};
 m.put('tournaments/'+code,t);m.put('publicTournaments/'+code,pub);
 const d={code,operationId:'operation-000001'};
 if(spec.function==='manageEntrySelection')Object.assign(d,{action:action||'configure',capacity:2});
 if(spec.function==='lotteryRegistration'){
  Object.assign(d,{action:action||'join'});
  if(d.action==='cancel')m.put('tournaments/'+code+'/registrations/'+uid,{uid,status:'pending_draw'});
 }
 if(spec.function==='registrationInvitations'){
  Object.assign(d,{action:action==='invite'||!action?'invite':'respond',targetUid:'target'});
  if(d.action==='respond'){
   delete d.targetUid;d.decision=action==='accept'?'accept':'decline';
   m.put('tournaments/'+code+'/registrationInvitations/'+uid,{code,targetUid:uid,invitedByUid:'host',status:action==='replay'?'declined':'pending',expiresAt:action==='expired'?NOW-1:NOW+100000});
  }
 }
 return {m,request:{auth:{uid},data:d}};
}
function normalized(m,result){const rows=clone([...m.rows]);for(const [p,d] of rows)if(p.includes('/registrationInvitations/'))delete d.sourceCreatedAt;
 const writes=clone(m.writes);for(const w of writes)if(w.value&&w.path.includes('/registrationInvitations/'))delete w.value.sourceCreatedAt;
 return clone({result,rows,writes});}
module.exports={memory,load,fixture,specs,NOW,code,uid};
if(require.main===module)(async()=>{let checks=0;
 for(const spec of specs){
  const actions=spec.function==='manageEntrySelection'?['configure','preview']:spec.function==='lotteryRegistration'?['join','cancel']:['invite','accept','decline','expired','replay'];
  for(const action of actions){
   const a=fixture(spec,action),b=fixture(spec,action),ra=await load(spec,false,a.m)(a.request),rb=await load(spec,true,b.m)(b.request);
   assert.deepEqual(normalized(b.m,rb),normalized(a.m,ra),spec.function+' '+action+' legacy drift');checks++;
   for(const marker of ['scoreStorage','scoreBucketProjection','bucketMigration','deletionStatus'])for(const value of [null,false,0,'unknown',{},[],{status:'deleting'}])for(const side of ['tournaments','publicTournaments']){
    const f=fixture(spec,action),p=side+'/'+code;f.m.put(p,{...f.m.rows.get(p),[marker]:value});f.m.put('tournaments/'+code,{...f.m.rows.get('tournaments/'+code),data:'{invalid'});
    await assert.rejects(load(spec,true,f.m)(f.request),/bucket-scoring-required/);assert.equal(f.m.writes.length,0);checks++;
   }
   if(action!=='preview'&&action!=='replay'){
    const f=fixture(spec,action);f.m.interfere=()=>f.m.put('tournaments/'+code,{...f.m.rows.get('tournaments/'+code),bucketMigration:{status:'deleting'}});
    await assert.rejects(load(spec,true,f.m)(f.request),/bucket-scoring-required/);assert.equal(f.m.writes.length,0);checks++;
   }
  }
 }
 const entry=specs.find(s=>s.function==='manageEntrySelection');
 {let original;
  for(const candidate of [false,true]){
   const f=fixture(entry),fn=load(entry,candidate,f.m),base=f.request.data;
   await fn(f.request);const preview=await fn({auth:{uid},data:{code,action:'preview'}});
   const drawn=await fn({auth:{uid},data:{code,action:'draw',operationId:'draw-operation-0001',candidateHash:preview.candidateHash}});
   const promoted=await fn({auth:{uid},data:{code,action:'promote',operationId:'promote-operation-0001',removeKey:drawn.state.entrySelection.selected[0].key,reason:'replacement'}});
   const view=normalized(f.m,promoted);if(!candidate)original=view;else assert.deepEqual(view,original,'full entry draw and promotion legacy drift');
   if(candidate){const count=f.m.writes.length;f.m.put('publicTournaments/'+code,{...f.m.rows.get('publicTournaments/'+code),scoreStorage:null});await assert.rejects(fn(f.request),/bucket-scoring-required/);assert.equal(f.m.writes.length,count);}
  }checks+=2;
 }
 const inv=specs.find(s=>s.function==='registrationInvitations'),rp='tournaments/'+code,ip=rp+'/registrationInvitations/'+uid;
 for(const action of ['accept','decline','expired','replay']){
  for(const kind of ['deleted','reused','mismatchedGeneration']){
   const f=fixture(inv,action),t=f.m.rows.get(rp);
   if(kind==='deleted')f.m.remove(rp);
   else if(kind==='reused'){f.m.remove(rp);f.m.put(rp,t);}
   else f.m.put(ip,{...f.m.rows.get(ip),sourceCreatedAt:'wrong-generation'});
   await assert.rejects(load(inv,true,f.m)(f.request),/not-found|invitation-room-changed/);assert.equal(f.m.writes.length,0);checks++;
  }
 }
 // Invitation role, target eligibility and current generation are checked anew
 // on every native transaction retry, before mail or counters are written.
 for(const kind of ['actorRevoked','actorPermissionLost','targetRevoked','roomReused']){
  const f=fixture(inv,'invite');f.m.interfere=()=>{
   if(kind==='actorRevoked')f.m.put('users/'+uid,{active:false,role:'super_admin'});
   if(kind==='actorPermissionLost'){f.m.put('users/'+uid,{active:true,role:'player'});f.m.put(rp,{...f.m.rows.get(rp),createdBy:'other',ownerUid:'other'});}
   if(kind==='targetRevoked')f.m.put('users/target',{active:false});
   if(kind==='roomReused'){const t=f.m.rows.get(rp);f.m.remove(rp);f.m.put(rp,t);}
  };
  await assert.rejects(load(inv,true,f.m)(f.request),/auth-required|permission-denied|player-not-found|invitation-room-changed/);assert.equal(f.m.writes.length,0);checks++;
 }
 {const f=fixture(inv,'invite'),handle=load(inv,true,f.m);await handle(f.request);assert.match(f.m.rows.get(rp+'/registrationInvitations/target').sourceCreatedAt,/^\d+:\d+$/);checks++;}
 // Invitation reads use one native batch rather than independently acquiring
 // seven overlapping document locks. Retain the same read set and transaction.
 for(const pending of [false,true]){
  const f=fixture(inv,'invite'),batches=[],run=f.m.db.runTransaction.bind(f.m.db);
  if(pending)f.m.put(rp+'/registrationInvitations/target',{targetUid:'target',status:'pending',expiresAt:NOW+100000});
  f.m.db.runTransaction=callback=>run(tx=>callback(new Proxy(tx,{get(target,key){
   if(key==='get')return async()=>{throw Error('invite used a separate point read');};
   if(key==='getAll')return async(...refs)=>{batches.push(refs.map(r=>r.path));return target.getAll(...refs);};
   const value=target[key];return typeof value==='function'?value.bind(target):value;
  }})));
  const fn=load(inv,true,f.m);
  if(pending){await assert.rejects(fn(f.request),/invite-pending/);assert.equal(f.m.writes.length,0);}
  else{await fn(f.request);assert.equal(f.m.rows.get('mailboxStats/target').unreadCount,1);}
  assert.deepEqual(batches,[[rp,'publicTournaments/'+code,'users/'+uid,'users/target',rp+'/registrationInvitations/target',rp+'/registrations/target','mailboxStats/target']]);checks++;
 }
 {const f=fixture(inv,'invite');f.m.put('mailboxStats/target',{unreadCount:7});f.m.interfere=()=>f.m.put('mailboxStats/target',{unreadCount:20});await load(inv,true,f.m)(f.request);assert.equal(f.m.rows.get('mailboxStats/target').unreadCount,21,'batch counter read lost concurrent mail');assert.equal(f.m.writes.filter(x=>x.path==='mailboxStats/target').length,1);checks++;}
 console.log(JSON.stringify({admissionChecks:checks,functions:specs.length,productionWrites:0,deploymentPerformed:false}));
})().catch(e=>{console.error(e);process.exitCode=1;});
