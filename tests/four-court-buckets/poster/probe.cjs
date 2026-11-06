'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {memory}=require('./memory.cjs'),root=__dirname,release=path.resolve(root,'../../../release/buckets/poster'),images=require('./images.json');
const code='BXH-TEST01',NOW=1900000000000,oldPoster='room-posters/'+code+'/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.jpg',oldCover='room-covers/'+code+'/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.jpg';
const clone=x=>JSON.parse(JSON.stringify(x));
class HttpsError extends Error{constructor(code,message){super(message);this.code=code;}}
function fixture(bucket=false){
 const m=memory(),base={id:'room-1',cloudCode:code,meta:{stations:6},matches:[],players:[]},manifest={schema:'bxh-match-buckets-v1',status:'active',roomId:base.id,code,epoch:'epoch-1',courtCount:6,bucketCount:2};
 const top={createdBy:'owner',eventAuthority:'official',data:JSON.stringify(base),posterPath:oldPoster,coverPath:oldCover,posterUrl:'old-poster',coverUrl:'old-cover'};
 const pub={publishedAt:1,visibility:'public',posterUrl:'old-poster',coverUrl:'old-cover'};
 if(bucket){top.scoreStorage=manifest;pub.scoreBucketProjection={epoch:manifest.epoch,versions:{'court-1':7,'court-2':9}};}
 m.put('tournaments/'+code,top);m.put('publicTournaments/'+code,pub);m.put('users/owner',{active:true,role:'staff'});m.put('users/admin',{active:true,role:'admin'});
 return {m,top,pub,base,manifest};
}
function storage({afterSave,failAt=0,deleteFail=false}={}){
 const rows=new Map([[oldPoster,Buffer.from('old poster')],[oldCover,Buffer.from('old cover')]]),calls=[],deletes=[];let saves=0;
 const bucket={file:p=>({name:p,save:async(bytes,options)=>{saves++;calls.push({path:p,options:clone(options)});rows.set(p,Buffer.from(bytes));if(afterSave)await afterSave(p,saves);if(saves===failAt)throw Error('ambiguous upload response');},delete:async()=>{deletes.push(p);if(deleteFail)throw Error('delete failed');rows.delete(p);}})};
 return {bucket,rows,calls,deletes};
}
function load(candidate,f,store,{project='bxh-arena',uuid=null}={}){
 const cache=new Map();let serial=0;class FixedDate extends Date{static now(){return NOW;}}
 const SDK={HttpsError,onCall:(_,fn)=>fn,onDocumentDeleted:(_,fn)=>fn,getFirestore:()=>f.m.db,getStorage:()=>({bucket:()=>store.bucket})};
 function moduleAt(file){if(cache.has(file))return cache.get(file).exports;const mod={exports:{}};cache.set(file,mod);
  const req=name=>{
   if(name==='node:crypto')return {...crypto,randomUUID:uuid||(()=> '00000000-0000-4000-8000-'+(++serial).toString(16).padStart(12,'0'))};
   if(name.startsWith('firebase-'))return SDK;
   if(name.startsWith('.')){let p=path.resolve(path.dirname(file),name);if(candidate&&name.startsWith('./bucket-'))p=path.join(release,path.basename(name));const found=[p,p+'.js',p+'.cjs'].find(p=>fs.existsSync(p));if(!found)throw Error(name);return moduleAt(found);}return require(name);
  };
  vm.runInThisContext('(function(require,module,exports,process,Date){'+fs.readFileSync(file,'utf8')+'\n})',{filename:file})(req,mod,mod.exports,{env:{GCLOUD_PROJECT:project}},FixedDate);return mod.exports;
 }
 // Keep captured relative dependencies pinned, while replacing only the reviewed module.
 const file=path.join(root,'fixtures/room-poster-cover.js');
 if(!candidate)return moduleAt(file);
 const main={exports:{}};cache.set(file,main);
 const req=name=>{
  if(name==='node:crypto')return {...crypto,randomUUID:uuid||(()=> '00000000-0000-4000-8000-'+(++serial).toString(16).padStart(12,'0'))};
  if(name.startsWith('firebase-'))return SDK;
  if(name.startsWith('./bucket-'))return moduleAt(path.join(release,name.slice(2)));
  if(name.startsWith('.'))return moduleAt(path.resolve(path.dirname(file),name)+(path.extname(name)?'':'.js'));
  return require(name);
 };
 vm.runInThisContext('(function(require,module,exports,process,Date){'+fs.readFileSync(path.join(release,'room-poster-cover.js'),'utf8')+'\n})',{filename:'candidate/room-poster-cover.js'})(req,main,main.exports,{env:{GCLOUD_PROJECT:project}},FixedDate);
 return main.exports;
}
const request=(action,uid='owner')=>({auth:{uid},data:{code,action,...(action==='savePoster'?{photo:images.photo,cover:images.cover}:{cover:images.cover})}});
async function invoke(f,s,action,candidate=true,uid='owner'){return load(candidate,f,s)._test.handleRoomPosterCover(request(action,uid),{db:f.m.db,bucket:s.bucket});}
const dump=f=>JSON.stringify([...f.m.rows]);
function assigned({bucket=true,stale=false,explicit=false}={}){
 const f=fixture(bucket),C=require('./fixtures/event-staff-core.js'),organizer={active:true,role:'player',partnerOrganizer:{organizationId:'org1',expiresAtMs:NOW+100000,status:'active'}},uid='assistant';
 f.m.put('users/organizer',organizer);f.m.put('users/'+uid,{active:true,role:'player'});
 const event={...f.top,createdBy:'organizer',createdByRole:'partner_organizer',partnerOrganizationCode:'org1'};
 let assignment=C.transition(C.makeInvitation({eventCode:code,targetUid:uid,organizerUid:'organizer',organizerProfile:organizer,tournament:event,duties:['event_assistant'],displayName:'Assistant',now:NOW}),'accept',uid,NOW);
 const ref='eventStaffAssignments/'+crypto.createHash('sha256').update(code+'|'+uid).digest('hex');f.m.put(ref,assignment);
 if(stale)f.m.remove('tournaments/'+code);
 f.m.put('tournaments/'+code,{...event,eventStaffAssignments:{[uid]:assignment}});
 if(explicit){const t=f.m.snapshot('tournaments/'+code).createTime;assignment={...assignment,sourceCreatedAt:t.seconds+':'+t.nanoseconds};f.m.put(ref,assignment);f.m.put('tournaments/'+code,{...f.m.rows.get('tournaments/'+code),eventStaffAssignments:{[uid]:assignment}});}
 return {...f,uid,assignmentRef:ref};
}

if(require.main===module)(async()=>{let checks=0;
 for(const action of ['saveCover','savePoster']){
  const a=fixture(),b=fixture(),s=storage(),t=storage();const ra=await invoke(a,s,action,false),rb=await invoke(b,t,action);assert.deepEqual(ra,rb);assert.equal(dump(a),dump(b));assert.deepEqual(s.calls,t.calls);assert.deepEqual(s.deletes,t.deletes);checks++;
  const f=fixture(true),v=storage(),data=f.top.data;assert((await invoke(f,v,action)).ok);assert.equal(f.m.rows.get('tournaments/'+code).data,data);assert.equal(f.m.writes.length,2);assert.deepEqual(f.m.rows.get('tournaments/'+code).scoreStorage,f.manifest);assert.deepEqual(f.m.rows.get('publicTournaments/'+code).scoreBucketProjection,f.pub.scoreBucketProjection);checks++;
 }
 for(const action of ['saveCover','savePoster'])for(const side of ['tournaments','publicTournaments'])for(const marker of ['bucketMigration','deletionStatus'])for(const value of [null,false,{}]){
  const f=fixture(),s=storage(),p=side+'/'+code;f.m.put(p,{...f.m.rows.get(p),[marker]:value});const before=dump(f);await assert.rejects(()=>invoke(f,s,action));assert.equal(dump(f),before);assert.equal(s.calls.length,0);checks++;
 }
 for(const action of ['saveCover','savePoster'])for(const change of ['private-reuse','public-reuse','actor-disabled','actor-role','owner','epoch','mode','migration','deleted','public-deleted']){
  const f=fixture(true),s=storage({afterSave:()=>{
   const p='tournaments/'+code,q='publicTournaments/'+code;
   if(change==='private-reuse'){const t=f.m.rows.get(p);f.m.remove(p);f.m.put(p,t);}
   if(change==='public-reuse'){const t=f.m.rows.get(q);f.m.remove(q);f.m.put(q,t);}
   if(change==='actor-disabled')f.m.put('users/owner',{active:false,role:'staff'});
   if(change==='actor-role')f.m.put('users/owner',{active:true,role:'tester'});
   if(change==='owner')f.m.put(p,{...f.m.rows.get(p),createdBy:'other'});
   if(change==='epoch'){f.m.put(p,{...f.m.rows.get(p),scoreStorage:{...f.manifest,epoch:'new'}});f.m.put(q,{...f.pub,scoreBucketProjection:{...f.pub.scoreBucketProjection,epoch:'new'}});}
   if(change==='mode'){const t={...f.top};delete t.scoreStorage;f.m.put(p,t);f.m.put(q,{publishedAt:1,visibility:'public'});}
   if(change==='migration')f.m.put(q,{...f.m.rows.get(q),bucketMigration:false});
   if(change==='deleted')f.m.remove(p);if(change==='public-deleted')f.m.remove(q);
  }});
  await assert.rejects(()=>invoke(f,s,action));assert.equal(f.m.writes.length,0);assert.equal(s.rows.size,2);assert(s.rows.has(oldPoster)&&s.rows.has(oldCover));checks++;
 }
 for(const action of ['saveCover','savePoster'])for(const failAt of action==='savePoster'?[1,2]:[1]){const f=fixture(),s=storage({failAt});const before=dump(f);await assert.rejects(()=>invoke(f,s,action));assert.equal(dump(f),before);assert.equal(s.rows.size,2);assert(!s.deletes.includes(oldPoster)&&!s.deletes.includes(oldCover));checks++;}
 {const f=fixture(true),s=storage();f.m.put('publicTournaments/'+code,{...f.pub,bucketMigration:null});const r=await load(true,f,s)._test.getPosterPermission({auth:{uid:'owner'},data:{code}},{db:f.m.db});assert.equal(r.allowed,false);assert.equal(s.calls.length,0);checks++;}
 for(const mode of ['bad-vector','wrong-root-marker','null-manifest']){const f=fixture(true),s=storage();if(mode==='bad-vector')f.m.put('publicTournaments/'+code,{...f.pub,scoreBucketProjection:{epoch:'other',versions:{}}});if(mode==='wrong-root-marker')f.m.put('publicTournaments/'+code,{...f.pub,scoreStorage:null});if(mode==='null-manifest')f.m.put('tournaments/'+code,{...f.top,scoreStorage:null});await assert.rejects(()=>invoke(f,s,'savePoster'));assert.equal(s.calls.length,0);checks++;}
 {const f=fixture(true),s=storage({afterSave:()=>f.m.put('publicTournaments/'+code,{...f.pub,scoreBucketProjection:{epoch:'epoch-1',versions:{'court-1':100,'court-2':101}}})});assert((await invoke(f,s,'savePoster')).ok);assert.equal(f.m.rows.get('publicTournaments/'+code).scoreBucketProjection.versions['court-1'],100);checks++;}
 for(const action of ['saveCover','savePoster'])for(const result of ['lost-ack','unknown','abort']){
  const f=fixture(true),s=storage(),native=f.m.db.runTransaction;let calls=0;
  f.m.db.runTransaction=async cb=>{calls++;if(calls===1){if(result==='abort')return native(async tx=>{await cb(tx);throw Error('forced abort');});await native(cb);throw Error('commit response lost');}if(result==='unknown')throw Error('read unavailable');return native(cb);};
  if(result==='lost-ack'){assert((await invoke(f,s,action)).ok);assert.equal(s.rows.has(f.m.rows.get('tournaments/'+code).coverPath),true);}
  else {await assert.rejects(()=>invoke(f,s,action));if(result==='unknown')assert(s.rows.has(f.m.rows.get('tournaments/'+code).coverPath));else assert.equal(f.m.writes.length,0);}
  if(result==='abort')assert.equal(s.rows.size,2);checks++;
 }
 // Demonstrate the captured baseline's broken-image behavior on the same lost ack.
 {const f=fixture(),s=storage(),native=f.m.db.runTransaction;f.m.db.runTransaction=async cb=>{await native(cb);throw Error('commit response lost');};await assert.rejects(()=>invoke(f,s,'saveCover',false));assert.equal(s.rows.has(f.m.rows.get('tournaments/'+code).coverPath),false);checks++;}
 {const f=fixture(true),s=storage({afterSave:()=>f.m.put('tournaments/'+code,{...f.m.rows.get('tournaments/'+code),createdBy:'new-owner'})});await assert.rejects(()=>invoke(f,s,'savePoster',true,'admin'));assert.equal(f.m.writes.length,0);assert.equal(s.rows.size,2);checks++;}
 for(const explicit of [false,true])for(const stale of [false,true]){const f=assigned({explicit,stale}),s=storage();if(stale&&!explicit){await assert.rejects(()=>invoke(f,s,'savePoster',true,f.uid));assert.equal(s.calls.length,0);}else assert((await invoke(f,s,'savePoster',true,f.uid)).ok);checks++;}
 for(const why of ['grant-revoked','embedded-revoked','parent-expired','source-mismatch']){
  const f=assigned({explicit:true}),s=storage({afterSave:()=>{
   if(why==='grant-revoked')f.m.put(f.assignmentRef,{...f.m.rows.get(f.assignmentRef),status:'revoked'});
   if(why==='embedded-revoked'||why==='source-mismatch'){const p='tournaments/'+code,r=f.m.rows.get(p);f.m.put(p,{...r,eventStaffAssignments:{[f.uid]:{...r.eventStaffAssignments[f.uid],...(why==='embedded-revoked'?{status:'revoked'}:{sourceCreatedAt:'old'})}}});}
   if(why==='parent-expired'){const p=f.m.rows.get('users/organizer');f.m.put('users/organizer',{...p,partnerOrganizer:{...p.partnerOrganizer,expiresAtMs:1}});}
  }});await assert.rejects(()=>invoke(f,s,'savePoster',true,f.uid));assert.equal(f.m.writes.length,0);assert.equal(s.rows.size,2);checks++;
 }
 for(const value of [{code,posterPath:oldPoster,coverPath:oldCover},{code:'bad',posterPath:oldPoster},{code,posterPath:'room-posters/BXH-OTHER/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.jpg'},{code,coverPath:'room-covers/'+code+'/../wrong.jpg'}]){
  const f=fixture(),s=storage(),before=dump(f);await load(true,f,s).roomPosterCoverCleanup({params:{code:value.code},data:{data:()=>value}});assert.equal(dump(f),before);if(value.code===code&&value.posterPath===oldPoster)assert.equal(s.rows.size,0);else assert.equal(s.rows.size,2);checks++;
 }
 for(const action of ['saveCover','savePoster']){
  const f=fixture(true),s=storage(),batches=[],run=f.m.db.runTransaction.bind(f.m.db);
  f.m.db.runTransaction=callback=>run(tx=>callback(new Proxy(tx,{get(target,key){
   if(key==='get')return async()=>{throw Error('image metadata used a separate point read');};
   if(key==='getAll')return async(...refs)=>{batches.push(refs.map(r=>r.path));return target.getAll(...refs);};
   const value=target[key];return typeof value==='function'?value.bind(target):value;
  }})));
  assert((await invoke(f,s,action)).ok);
  const room='tournaments/'+code,pub='publicTournaments/'+code,actor='users/owner';
  assert.deepEqual(batches,[action==='saveCover'?[room,pub,actor]:[actor,room,pub]]);
  assert.equal(f.m.rows.get(room).data,f.top.data);assert.equal(f.m.writes.length,2);checks++;
 }
 console.log(JSON.stringify({posterChecks:checks,productionWrites:0,deploymentPerformed:false}));
})().catch(e=>{console.error(e);process.exitCode=1;});
module.exports={fixture,storage,load,request,invoke,code,NOW,oldPoster,oldCover,images,assigned};
