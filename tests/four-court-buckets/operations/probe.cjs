'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=__dirname,release=path.resolve(root,'../../../release/buckets/operations');
const patches=JSON.parse(fs.readFileSync(path.join(release,'patch-manifest.json'))).patches;
const specs=patches.flatMap(s=>s.functions.map(name=>({...s,function:name})));
const NOW=1900000000000,code='BXH-TEST01',uid='organizer',clone=x=>x===undefined?undefined:JSON.parse(JSON.stringify(x));
function memory(){
 const rows=new Map(),versions=new Map(),created=new Map(),writes=[];let interfere;let serial=0;
 const put=(p,d)=>{rows.set(p,clone(d));versions.set(p,++serial);if(!created.has(p))created.set(p,serial);};
 const snapshot=p=>{const value=clone(rows.get(p)),exists=rows.has(p),born=created.get(p),version=versions.get(p)||0;return {id:p.split('/').at(-1),ref:ref(p),exists,data:()=>clone(value),createTime:exists?{seconds:born,nanoseconds:0}:undefined,updateTime:{seconds:version,nanoseconds:0,toMillis:()=>version*1000}};};
 const ref=p=>({path:p,id:p.split('/').at(-1),collection:c=>query(p+'/'+c),get:async()=>snapshot(p)});
 function query(p){let maximum=Infinity;const filters=[];const q={query:true,path:p,doc:id=>ref(p+'/'+id),where(...f){filters.push(f);return q;},limit(n){maximum=n;return q;},orderBy(){return q;},get:async()=>{const docs=[...rows.keys()].filter(k=>k.startsWith(p+'/')&&!k.slice(p.length+1).includes('/')&&filters.every(([f,op,v])=>op==='=='&&rows.get(k)[f]===v)).slice(0,maximum).map(snapshot);return {docs,size:docs.length,empty:!docs.length};}};return q;}
 function apply(kind,p,value,options){if(kind==='create')assert(!rows.has(p));writes.push({kind,path:p,value:clone(value),options:clone(options)});if(kind==='delete'){rows.delete(p);created.delete(p);versions.set(p,++serial);return;}const next=kind==='update'||options?.merge?{...rows.get(p)}:{};for(const [k,v]of Object.entries(value)){if(v&&v.__increment!==undefined)next[k]=Number(next[k]||0)+v.__increment;else if(v&&v.__arrayUnion){next[k]=[...(next[k]||[])];for(const item of v.__arrayUnion)if(!next[k].some(old=>JSON.stringify(old)===JSON.stringify(item)))next[k].push(clone(item));}else next[k]=clone(v);}put(p,next);}
 const db={doc:ref,collection:query,getAll:async(...refs)=>Promise.all(refs.map(r=>r.get())),runTransaction:async cb=>{for(let attempt=0;attempt<4;attempt++){
  const reads=new Map(),pending=[];const get=async r=>{assert.equal(pending.length,0,'read after write');if(r.query)return r.get();reads.set(r.path,versions.get(r.path)||0);return snapshot(r.path);};
  const tx={get,getAll:(...refs)=>Promise.all(refs.map(get)),set:(r,d,o)=>pending.push(['set',r.path,d,o]),update:(r,d)=>pending.push(['update',r.path,d]),create:(r,d)=>pending.push(['create',r.path,d]),delete:r=>pending.push(['delete',r.path])};
  const result=await cb(tx);if(interfere&&pending.length){const fn=interfere;interfere=null;fn();}
  if([...reads].some(([p,v])=>(versions.get(p)||0)!==v))continue;pending.forEach(args=>apply(...args));return result;
 }throw Error('retry exhausted');}};
 return {db,rows,put,writes,snapshot,remove:p=>{rows.delete(p);created.delete(p);versions.set(p,++serial);},set interfere(x){interfere=x;}};
}

function load(spec,patched,m){
 const base=path.join(root,'fixtures',String(spec.sourceSet)),cache=new Map();class FixedDate extends Date{static now(){return NOW;}}
 const sdk={getFirestore:()=>m.db,FieldValue:{serverTimestamp:()=>NOW,increment:n=>({__increment:n}),arrayUnion:(...values)=>({__arrayUnion:values})},FieldPath:{documentId:()=> '__name__'}};
 function moduleAt(filename){if(cache.has(filename))return cache.get(filename).exports;
  const module={exports:{}};cache.set(filename,module);
  const actual=patched&&filename===path.join(base,spec.path)?path.join(release,'candidate',String(spec.sourceSet),spec.path):filename;
  function req(n){
   if(n==='./_qr_checkin/admin-firestore.cjs'||n==='firebase-admin/firestore')return sdk;
   if(n==='firebase-functions/v2/https'){class HttpsError extends Error{constructor(code,message){super(message);this.code=code;}}return {onCall:(_o,fn)=>fn,HttpsError};}
   if(n==='firebase-functions/v2/firestore')return {onDocumentWritten:(_o,fn)=>fn};
   if(n==='firebase-functions/v2/scheduler')return {onSchedule:(_o,fn)=>fn};
   if(n==='node:crypto')return {...require(n),randomInt:(min)=>min,randomUUID:()=> 'synthetic-operation-id'};
   if(n.startsWith('.')){const p=path.resolve(path.dirname(filename),n),resolved=[p,p+'.js',p+'.cjs'].find(x=>fs.existsSync(x));if(!resolved||!resolved.startsWith(base+path.sep))throw Error('unexpected dependency '+n);return moduleAt(resolved);}return require(n);
  }
  vm.runInThisContext('(function(require,module,exports,Date,process){'+fs.readFileSync(actual,'utf8')+'\n})',{filename:actual})(req,module,module.exports,FixedDate,{env:{GCLOUD_PROJECT:'bxh-arena'}});return module.exports;
 }
 const mod=moduleAt(path.join(base,spec.path));return mod[spec.function];
}

function fixture(spec,action){
 const m=memory(),players=[{id:'p1',name:'One',checkedIn:true},{id:'p2',name:'Two',checkedIn:true},{id:'p3',name:'Three',checkedIn:true}];
 const state={meta:{formatType:'single'},players,matches:[]};
 m.put('users/'+uid,{active:true,role:spec.function==='eventStaffService'?'player':'super_admin',realName:'Organizer',partnerOrganizer:{status:'active',organizationId:'org1',organizationName:'Organization',orderCode:'C-1',expiresAtMs:NOW+86400000}});
 m.put('users/target',{active:true,role:'player',displayName:'Target'});
 m.put('tournaments/'+code,{createdBy:uid,ownerUid:uid,createdByRole:'partner_organizer',eventAuthority:'official',partnerOrganizationCode:'org1',partnerContractOrderCode:'C-1',tournamentPhase:'waiting',data:JSON.stringify(state),name:'Synthetic Event'});
 m.put('publicTournaments/'+code,{bracketView:JSON.stringify(state)});
 let request={auth:{uid},data:{code,operationId:'operation-000001'}},event;
 if(spec.function==='eventStaffService'){
  const C=require('./fixtures/7/event-staff-core.js'),a=action||'invite';
  request.data={action:a==='accept'||a==='reject'?'respond':a,eventCode:code,targetUid:'target',duties:['checkin'],response:a};
  if(a!=='invite'){
   const assignment=C.makeInvitation({eventCode:code,targetUid:'target',organizerUid:uid,organizerProfile:m.rows.get('users/'+uid),tournament:m.rows.get('tournaments/'+code),duties:['checkin'],displayName:'Target',now:NOW-1000});
   const id=require('node:crypto').createHash('sha256').update(code+'|target').digest('hex');
   m.put('eventStaffAssignments/'+id,assignment);m.put('tournaments/'+code,{...m.rows.get('tournaments/'+code),eventStaffAssignments:{target:assignment}});
   if(a==='accept'||a==='reject')request.auth.uid='target';
  }
 }else if(spec.function.startsWith('track')){
  if(spec.function==='trackTournamentActivity')event={params:{code},data:{before:m.snapshot('absent/root'),after:m.snapshot('tournaments/'+code)}};
  else {const p='tournaments/'+code+'/registrations/target';m.put(p,{uid:'target',status:'confirmed'});const before=m.snapshot(p);
   if(action==='delete'){m.remove(p);event={params:{code,uid:'target'},data:{before,after:m.snapshot(p)},time:new Date(NOW).toISOString()};}
   else event={params:{code,uid:'target'},data:{before:m.snapshot('absent/reg'),after:m.snapshot(p)}};
  }
  request=event;
 }else {
  const C=require('./fixtures/5/operations-core.js'),pool=C.candidates(state,'general'),prizes=[{name:'Prize',description:'Synthetic',quantity:1}];
  if(spec.function==='drawTournamentRaffle')Object.assign(request.data,{mode:'general',prizes,candidateHash:C.poolHash(pool)});
  else {Object.assign(request.data,{action:action||'claim',raffleId:'raffle-0001',winnerKey:pool[0].key,reason:'replacement'});
   m.put('tournaments/'+code+'/raffles/raffle-0001',{title:'Prize',description:'Synthetic',prizes,mode:'general',count:1,excludePrevious:true,candidates:pool,winners:C.assignPrizeWinners([pool[0]],prizes).map(w=>({...w,status:action==='replace'?'forfeited':'pending'})),createdBy:uid,createdAt:NOW-1000,revision:0});
   m.put('tournaments/'+code+'/raffleControl/current',{winnerKeys:[pool[0].key]});
  }
 }
 return {m,request};
}
const tracker=s=>s.function.startsWith('track');
const actions=s=>s.function==='eventStaffService'?['invite','accept','reject','revoke']:s.function==='updateTournamentRaffleWinner'?['claim','forfeit','replace']:s.function==='trackTournamentRegistrationActivity'?['write','delete']:['default'];
function normalized(m,result){return JSON.parse(JSON.stringify({rows:[...m.rows],writes:m.writes,result},(k,v)=>k==='sourceCreatedAt'?undefined:v));}
module.exports={memory,load,fixture,bucket,specs,actions,NOW,code,uid};
function bucket(f){
 const tr='tournaments/'+code,pr='publicTournaments/'+code,t=f.m.rows.get(tr),p=f.m.rows.get(pr),s=JSON.parse(t.data);
 s.id='physical-room-1';s.cloudCode=code;s.meta.stations=6;
 const m={schema:'bxh-match-buckets-v1',status:'active',epoch:'epoch-1',roomId:s.id,code,courtCount:6,bucketCount:2};
 f.m.put(tr,{...t,data:JSON.stringify(s),scoreStorage:m});
 f.m.put(pr,{...p,scoreBucketProjection:{epoch:m.epoch,versions:{'court-1':0,'court-2':0}}});
 return {tr,pr};
}
if(require.main===module)(async()=>{let checks=0;
 for(const spec of specs)for(const action of actions(spec)){
  const a=fixture(spec,action),b=fixture(spec,action),ra=await load(spec,false,a.m)(a.request),rb=await load(spec,true,b.m)(b.request);
  assert(a.m.writes.length>0,spec.function+' '+action+' baseline needs real writes');assert.deepEqual(normalized(b.m,rb),normalized(a.m,ra),spec.function+' '+action+' legacy drift');checks++;
  for(const marker of ['scoreStorage','scoreBucketProjection','bucketMigration','deletionStatus'])for(const value of [null,false,0,'unknown',{},[],{status:'deleting'}])for(const side of ['tournaments','publicTournaments']){
   const f=fixture(spec,action),p=side+'/'+code;f.m.put(p,{...f.m.rows.get(p),[marker]:value});
   if(!tracker(spec))f.m.put('tournaments/'+code,{...f.m.rows.get('tournaments/'+code),data:'{invalid'});
   if(tracker(spec))await load(spec,true,f.m)(f.request);else await assert.rejects(load(spec,true,f.m)(f.request),/bucket-scoring-required/);
   assert.equal(f.m.writes.length,0);checks++;
  }
  for(const kind of ['migration','recreated','deleted']){
   const f=fixture(spec,action);f.m.interfere=()=>{const p='tournaments/'+code,t=f.m.rows.get(p);if(kind==='migration')f.m.put(p,{...t,bucketMigration:{status:'deleting'}});else{f.m.remove(p);if(kind==='recreated')f.m.put(p,t);}};
   if(tracker(spec))await load(spec,true,f.m)(f.request);else await assert.rejects(load(spec,true,f.m)(f.request),/bucket-scoring-required|room-generation-changed|event-not-found|tournament-not-found/);
   assert.equal(f.m.writes.length,0);checks++;
  }
 }
 // Old external staff assignments, raffle/control receipts and delayed events
 // cannot attach to a new parent even when contract/room content is identical.
 for(const spec of specs)for(const action of actions(spec)){
  if(spec.function==='eventStaffService'&&action==='invite'||spec.function==='drawTournamentRaffle')continue;
  const f=fixture(spec,action),p='tournaments/'+code,t=f.m.rows.get(p);f.m.remove(p);f.m.put(p,t);
  if(tracker(spec))await load(spec,true,f.m)(f.request);else await assert.rejects(load(spec,true,f.m)(f.request),/room-generation-changed/);
  assert.equal(f.m.writes.length,0);checks++;
 }
 for(const name of ['drawTournamentRaffle','updateTournamentRaffleWinner']){
  const s=specs.find(s=>s.function===name),f=fixture(s),fn=load(s,true,f.m);await fn(f.request);const n=f.m.writes.length;assert((await fn(f.request)).replayed);assert.equal(f.m.writes.length,n);
  f.m.put('publicTournaments/'+code,{scoreStorage:false});await assert.rejects(fn(f.request),/bucket-scoring-required/);assert.equal(f.m.writes.length,n);checks+=2;
 }
 // A delayed registration update/delete loses to a new registration incarnation.
 {const s=specs.find(s=>s.function==='trackTournamentRegistrationActivity');for(const action of ['write','delete']){
  const f=fixture(s,action),p='tournaments/'+code+'/registrations/target';f.m.remove(p);f.m.put(p,{uid:'target',status:'confirmed'});await load(s,true,f.m)(f.request);assert.equal(f.m.writes.length,0);checks++;
 }}
 // Loss of organizer authority or recipient eligibility is observed on retry.
 {const s=specs.find(s=>s.function==='eventStaffService');for(const kind of ['organizer','recipient']){
  const f=fixture(s,'invite');f.m.interfere=()=>f.m.put('users/'+(kind==='organizer'?uid:'target'),{active:false});await assert.rejects(load(s,true,f.m)(f.request),/organizer-access-denied|recipient-inactive/);assert.equal(f.m.writes.length,0);checks++;
 }}
 {const s=specs.find(s=>s.function==='eventStaffService');for(const action of ['accept','reject'])for(const missing of [false,true]){
  const f=fixture(s,action);if(missing)f.m.remove('users/target');else f.m.put('users/target',{active:false});await assert.rejects(load(s,true,f.m)(f.request),/account-inactive/);assert.equal(f.m.writes.length,0);checks++;
 }}
 { const s=specs.find(x=>x.function==='eventStaffService');assert(s);
 for(const action of ['invite','accept','reject','revoke']){
  const f=fixture(s,action);bucket(f);const result=await load(s,true,f.m)(f.request);
  assert(result.ok&&f.m.writes.length>0,action);checks++;
 }
 for(const change of ['private-marker','public-marker','private-vector','public-vector','epoch','migration','deletion','stale-root']){
  const f=fixture(s,'invite'),{tr,pr}=bucket(f),t=f.m.rows.get(tr),p=f.m.rows.get(pr);
  if(change==='private-marker'){delete t.scoreStorage;f.m.put(tr,t);}
  if(change==='public-marker'){delete p.scoreBucketProjection;f.m.put(pr,p);}
  if(change==='private-vector'){t.scoreBucketProjection={};f.m.put(tr,t);}
  if(change==='public-vector'){p.scoreBucketProjection.versions['court-2']=-1;f.m.put(pr,p);}
  if(change==='epoch'){p.scoreBucketProjection.epoch='other';f.m.put(pr,p);}
  if(change==='migration'){t.bucketMigration=null;f.m.put(tr,t);}
  if(change==='deletion'){p.deletionStatus=false;f.m.put(pr,p);}
  if(change==='stale-root'){t.scoreStorage.roomId='other';f.m.put(tr,t);}
  await assert.rejects(load(s,true,f.m)(f.request),/bucket-scoring-required/,change);
  assert.equal(f.m.writes.length,0,change);checks++;
 }
 for(const change of ['epoch','birth']){
  const f=fixture(s,'invite'),{tr}=bucket(f);
  f.m.interfere=()=>{const t=f.m.rows.get(tr);if(change==='epoch')f.m.put(tr,{...t,scoreStorage:{...t.scoreStorage,epoch:'epoch-2'}});else{f.m.remove(tr);f.m.put(tr,t);}};
  await assert.rejects(load(s,true,f.m)(f.request),/room-generation-changed|bucket-scoring-required/,change);
  assert.equal(f.m.writes.length,0,change);checks++;
 }
 for(const action of ['invite','accept','reject','revoke']){
  const f=fixture(s,action),{pr}=bucket(f);
  f.m.interfere=()=>{const p=f.m.rows.get(pr);f.m.remove(pr);f.m.put(pr,p);};
  await assert.rejects(load(s,true,f.m)(f.request),/room-generation-changed/,action+' public root replaced');
  assert.equal(f.m.writes.length,0,action+' public root replaced');checks++;
 }
 {const f=fixture(s,'invite'),{pr}=bucket(f);f.m.interfere=()=>{const p=f.m.rows.get(pr);f.m.put(pr,{...p,scoreBucketProjection:{...p.scoreBucketProjection,versions:{'court-1':1,'court-2':0}}});};const result=await load(s,true,f.m)(f.request);assert(result.ok);checks++;}
 }
 console.log(JSON.stringify({operationsChecks:checks,functions:specs.length,productionWrites:0,deploymentPerformed:false}));
})().catch(e=>{console.error(e);process.exitCode=1;});
