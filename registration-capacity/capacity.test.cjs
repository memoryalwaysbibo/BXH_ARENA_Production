'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{createHash}=require('node:crypto');
const {prepareFamilySource}=require('./prepare-family.cjs');
const fixture=path.join(__dirname,'../tests/fixtures/registration-feedback-current-source.json');
const capture=fs.existsSync(fixture)?JSON.parse(fs.readFileSync(fixture)):null;
const root=process.env.BXH_CAPACITY_SOURCE_ROOT||(!capture&&path.join(__dirname,'../registration-phase2/baseline'));
const original=root?fs.readFileSync(path.join(root,'family-registration.js'),'utf8'):capture.blobs[capture.files['family-registration.js']];
const digest=s=>createHash('sha256').update(s).digest('hex');
const candidate=prepareFamilySource(original,digest(original));
const clone=x=>x===undefined?undefined:JSON.parse(JSON.stringify(x));
function harness({players=24,confirmed=0,capacity=24,waitlist=false,quick=false,source=candidate}={}){
 const now=100000,code='BXH-TEST24',uid='capacity-user',docs=new Map();
 const people=Array.isArray(players)?players:Array.from({length:players},(_,i)=>({id:'local_'+i,name:'選手'+i}));
 const runtime={players:people,waitlistPlayers:[],matches:[],meta:{eventAuthority:quick?'community':'official'},archiveStatus:'ongoing'};
 const common={eventAuthority:quick?'community':'official',communityQuickRegistration:quick,battleMode:'individual',visibility:'public',registrationVisibility:'public',registrationEnabled:true,publishedAt:1,tournamentPhase:'waiting',confirmedCount:confirmed,waitlistCount:0,capacity,waitlistEnabled:waitlist,waitlistCapacity:10,registrationOpenAt:1,registrationCloseAt:200000,cancellationDeadline:200000};
 docs.set('users/'+uid,{active:true,realName:'報名者',phone:'',profileCompleted:true});
 docs.set('familyPlayers/'+uid,{profiles:[{id:'child-a',name:'孩子甲',guardianUid:uid},{id:'child-b',name:'孩子乙',guardianUid:uid}]});
 docs.set('tournaments/'+code,{...common,data:JSON.stringify(runtime)});
 docs.set('publicTournaments/'+code,{...common,bracketView:JSON.stringify(runtime)});
 const snapshot=r=>({id:r.id,ref:r,exists:docs.has(r.path),data:()=>clone(docs.get(r.path))});
 const reference=p=>({path:p,id:p.split('/').at(-1),get:async()=>snapshot(reference(p)),collection:n=>collection(p+'/'+n)});
 const collection=p=>({path:p,isCollection:true,doc:id=>reference(p+'/'+id)});
 let tail=Promise.resolve();
 const db={doc:reference,runTransaction:fn=>{
  const run=tail.then(async()=>{
   const writes=[];
   const get=async r=>r.isCollection?{docs:[...docs.keys()].filter(k=>k.startsWith(r.path+'/')&&k.split('/').length===r.path.split('/').length+1).map(k=>snapshot(reference(k)))}:snapshot(r);
   const result=await fn({get,getAll:async(...refs)=>Promise.all(refs.map(get)),set:(r,d)=>writes.push([r.path,d]),update:(r,d)=>writes.push([r.path,{...docs.get(r.path),...d}]),create:(r,d)=>{assert(!docs.has(r.path));writes.push([r.path,d]);},delete:r=>writes.push([r.path,undefined])});
   for(const [key,value]of writes)value===undefined?docs.delete(key):docs.set(key,clone(value));
   return result;
  });tail=run.catch(()=>{});return run;
 }};
 const cache=new Map();
 function load(file,override){
  if(cache.has(file))return cache.get(file).exports;
  const m={exports:{}};cache.set(file,m);
  const content=override||(root?fs.readFileSync(path.join(root,file),'utf8'):capture.blobs[capture.files[file]]);
  const req=name=>{
   if(name==='./_qr_checkin/admin-firestore.cjs'||name==='firebase-admin/firestore')return {FieldValue:{serverTimestamp:()=>now}};
   if(name==='./registration-admission.cjs')return {createAdmission:()=>async(_code,fn)=>fn()};
   if(!name.startsWith('.'))return require(name);
   const base=path.posix.normalize(path.posix.join(path.posix.dirname(file),name));
   const target=[base,base+'.js',base+'.cjs'].find(x=>root?fs.existsSync(path.join(root,x)):capture.files[x]);
   if(!target)throw Error('missing-test-dependency:'+base);
   return load(target);
  };
  new Function('require','module','exports',content)(req,m,m.exports);return m.exports;
 }
 const handler=load('family-registration.js',source).createFamilyRegistration(db,()=>now);
 const request=(action='join',childIds=[null],operationId='capacity_test_01')=>({auth:{uid},data:{action,code,childIds,operationId,childEligibilityConfirmed:true}});
 return {docs,handler,request,code,uid};
}
test('reproduces legacy bug: 24 imported seats still accept online registration',async()=>{
 const h=harness({source:original});assert.equal((await h.handler(h.request())).rows[0].status,'confirmed');
});
for(const action of ['preview','join'])test('24/24 imported roster rejects '+action+' without writes',async()=>{
 const h=harness(),before=clone([...h.docs]);await assert.rejects(h.handler(h.request(action)),/full/);assert.deepEqual([...h.docs],before);
});
test('already over capacity with 31 entries rejects new confirmed entries without deleting anyone',async()=>{
 const h=harness({players:31,confirmed:7}),before=clone([...h.docs]);await assert.rejects(h.handler(h.request()),/full/);assert.deepEqual([...h.docs],before);
});
test('full room uses explicit waitlist without consuming another confirmed seat',async()=>{
 const h=harness({waitlist:true});assert.equal((await h.handler(h.request())).rows[0].status,'waitlist');
 assert.equal(h.docs.get('tournaments/'+h.code).confirmedCount,0);assert.equal(h.docs.get('publicTournaments/'+h.code).waitlistCount,1);
});
test('family batch exceeding one remaining seat is rejected atomically',async()=>{
 const h=harness({players:23}),before=clone([...h.docs]);await assert.rejects(h.handler(h.request('join',['child-a','child-b'])),/full/);assert.deepEqual([...h.docs],before);
});
test('last remaining seat is admitted once across serialized transaction attempts',async()=>{
 const h=harness({players:23});const replies=await Promise.allSettled([h.handler(h.request('join',['child-a'],'capacity_test_a')),h.handler(h.request('join',['child-b'],'capacity_test_b'))]);
 assert.equal(replies.filter(x=>x.status==='fulfilled').length,1);assert.equal(replies.filter(x=>x.status==='rejected'&&/full/.test(x.reason.message)).length,1);
});
test('stale roster still reserves unprojected online registrations',async()=>{
 const h=harness({players:23,confirmed:1});await assert.rejects(h.handler(h.request()),/full/);
});
test('online players already projected are not counted twice',async()=>{
 const players=Array.from({length:23},(_,i)=>({id:'online_'+i,name:'線上'+i,source:'online',registrationId:'reg'+i}));
 const h=harness({players,confirmed:23});assert.equal((await h.handler(h.request())).rows[0].status,'confirmed');
 assert.equal(h.docs.get('tournaments/'+h.code).confirmedCount,24);
});
test('replay retains the original result without incrementing counts twice',async()=>{
 const h=harness({players:23});await h.handler(h.request());const reply=await h.handler(h.request());assert.equal(reply.replayed,true);assert.equal(h.docs.get('tournaments/'+h.code).confirmedCount,1);
});
test('capacity mismatch or malformed roster fails closed',async()=>{
 for(const malformed of ['capacity','roster']){
  const h=harness({players:0});
  if(malformed==='capacity')h.docs.get('publicTournaments/'+h.code).capacity=32;
  else h.docs.get('tournaments/'+h.code).data='{}';
  const before=clone([...h.docs]);await assert.rejects(h.handler(h.request()),/registration-state-conflict|corrupt-state/);assert.deepEqual([...h.docs],before);
 }
});
test('unlimited community registration keeps its existing behavior',async()=>{
 const h=harness({players:24,capacity:null,quick:true});assert.equal((await h.handler(h.request())).rows[0].status,'confirmed');
});
test('patch refuses unknown, repeated or already patched anchors',()=>{
 assert.throws(()=>prepareFamilySource(original,'0'.repeat(64)),/baseline-mismatch/);
 for(const source of [candidate,original+original])assert.throws(()=>prepareFamilySource(source,digest(source)),/anchor-mismatch/);
});
