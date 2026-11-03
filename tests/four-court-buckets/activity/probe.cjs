'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const {memory}=require('./memory.cjs'),R=path.resolve(__dirname,'../../../release/buckets/activity'),A=require(R+'/certificate.cjs'),B=require(R+'/protocol/state.cjs');
const NOW=1793000000000,code='BXH-TEST01',clone=x=>JSON.parse(JSON.stringify(x));
function fixture({bucket=false,legacy=false}={}){
 const m=memory(),state={id:'room-1',cloudCode:code,meta:{stations:6,ladderMode:'general'},archiveStatus:'completed',completedAt:legacy?1720000000000:NOW,players:[{id:'a',uid:'a'},{id:'b',uid:'b'}],matches:[{id:'final',completed:true,status:'completed',station:1,dispatchRevision:0,refereeSeatScoreRevision:1,bracket:'SE',round:0,indexInRound:0,seq:1,isBye:false,a:{playerId:'a'},b:{playerId:'b'},winnerId:'a',loserId:'b',scoreA:4,scoreB:1}]};
 const top={createdBy:'host',archiveStatus:'completed',eventAuthority:'official',ladderMode:'general',data:JSON.stringify(state)},pub={archiveStatus:'completed'};
 for(const uid of ['a','b','host'])m.put('users/'+uid,{active:true,role:'player'});
 let manifest,buckets;
 if(bucket){
  Object.assign(state,{settlementPhase:'completed',settlementRoute:'no-ladder',settlementCompletedAt:NOW});
  manifest=B.makeManifest(state,'epoch-1');top.scoreStorage=manifest;buckets=B.encode(state,manifest).map(b=>({...b,revision:3}));
  pub.scoreBucketProjection={epoch:manifest.epoch,versions:Object.fromEntries(buckets.map(b=>[b.bucketId,b.revision]))};
 }
 top.data=JSON.stringify(state);m.put('tournaments/'+code,top);m.put('publicTournaments/'+code,pub);
 if(bucket){for(const b of buckets)m.put(`tournaments/${code}/matchBuckets/${b.bucketId}`,b);certify({m,state,top,pub,manifest,buckets});}
 return {m,state,top,pub,manifest,buckets};
}
function certify(f,{ranked=false}={}){
 const {m,state,top,pub,manifest,buckets}=f;const versions=Object.fromEntries(buckets.map(b=>[b.bucketId,b.revision]));
 if(ranked){state.meta.ladderMode='ranked';state.ladderPointsAwarded=true;state.ladderSeasonId='S1';state.ladderResults=[{id:'a'},{id:'b'}];Object.assign(top,{ladderMode:'ranked',ladderPointsAwarded:true,ladderSeasonId:'S1',ladderResults:state.ladderResults});delete state.settlementRoute;}
 top.data=JSON.stringify(state);const key=ranked?'bucketSettlement':'bucketCompletion';delete top.bucketCompletion;delete pub.bucketCompletion;
 top[key]={version:1,status:'completed',epoch:manifest.epoch,versions,completedAt:NOW,sourceCreatedAt:A.identity(m.snapshot('tournaments/'+code)),stateDigest:A.digest(state),actorUid:'admin'};
 pub[key]={version:1,status:'completed',epoch:manifest.epoch,versions,completedAt:NOW};
 m.put('tournaments/'+code,top);m.put('publicTournaments/'+code,pub);
}
class FixedDate extends Date{constructor(...args){super(...(args.length?args:[NOW]));}static now(){return NOW;}}
function load(f,candidate=true,{db=f.m.db,logs=[],guard=undefined}={}){
 const mod={exports:{}};const plain=(_,fn)=>fn;
 const context={
  module:mod,exports:mod.exports,console:{error:(...a)=>logs.push(a.map(String).join(' '))},Date:FixedDate,process:{env:{GCLOUD_PROJECT:'demo-bxh-bucket-activity'}},require:n=>{
   if(n==='firebase-functions/v2/https')return {onCall:plain,HttpsError:Error};
   if(n==='firebase-functions/v2/scheduler')return {onSchedule:plain};
   if(n==='firebase-functions/v2/firestore')return {onDocumentWritten:plain};
   if(n==='firebase-admin/firestore')return {getFirestore:()=>db,FieldValue:{serverTimestamp:()=>NOW}};
   if(n==='./release-controls')return {backgroundJobsEnabled:()=>false};
   if(n==='./activity-tournament-guard.cjs')return guard||require(R+'/activity-tournament-guard.cjs');
   throw Error('unexpected module '+n);
  }
 };
 const filename=candidate?R+'/activity-points.js':__dirname+'/fixtures/activity-points.js';
 vm.runInThisContext('(function(module,exports,console,Date,process,require){'+fs.readFileSync(filename,'utf8')+'\n})',{filename})(...['module','exports','console','Date','process','require'].map(k=>context[k]));
 return mod.exports;
}
const event=f=>({params:{code},data:{after:f.m.snapshot('tournaments/'+code)}});
const invoke=(f,candidate=true,ev=event(f),options={})=>load(f,candidate,options).activityTournamentCompleted(ev);
const awards=f=>[...f.m.rows].filter(([p])=>p.startsWith('activityPointLedgers/')).length;
const balance=(f,uid='a')=>f.m.rows.get('activityPointWallets/'+uid)?.balance||0;
async function main(){let checks=0;
 for(const alt of ['BXH-ABCD','BXH-ABCDEFGHIJKLMNOP']){const f=fixture();f.m.put('tournaments/'+alt,f.top);f.m.put('publicTournaments/'+alt,f.pub);await invoke(f,true,{params:{code:alt},data:{after:f.m.snapshot('tournaments/'+alt)}});assert.equal(balance(f),10);checks++;}
 for(const legacy of [false,true]){
  const a=fixture({legacy}),b=fixture({legacy});await invoke(a,false);await invoke(b);assert.deepEqual([...a.m.rows],[...b.m.rows].map(([p,v])=>{if(p.startsWith('activityPointLedgers/')){v=clone(v);delete v.metadata.roomSourceCreatedAt;delete v.metadata.bucketEpoch;delete v.metadata.completionDigest;}return[p,v];}));assert.equal(balance(b),legacy?3:10);checks++;
  const before=JSON.stringify([...b.m.rows]);await invoke(b);assert.equal(JSON.stringify([...b.m.rows]),before);checks++;
 }
 for(const kind of ['missing','replacement','cancelled','inactive']){
  for(const candidate of [false,true]){
   const f=fixture(),ev=event(f);
   if(kind==='missing')f.m.remove('tournaments/'+code);
   if(kind==='replacement'){f.m.remove('tournaments/'+code);f.m.put('tournaments/'+code,{...f.top,data:JSON.stringify({...f.state,id:'other'})});}
   if(kind==='cancelled')f.m.put('tournaments/'+code,{...f.top,eventCancelled:true});
   if(kind==='inactive'){
    const old=f.m.db.runTransaction;let first=true;f.m.db.runTransaction=async cb=>{if(first){first=false;f.m.put('users/a',{active:false});}return old(cb);};
   }
   await invoke(f,candidate,ev);assert.equal(balance(f),candidate?0:10,kind);checks++;
  }
 }
 for(const side of ['tournaments','publicTournaments'])for(const key of ['bucketMigration','deletionStatus'])for(const value of [null,false,{}]){
  const f=fixture();const p=side+'/'+code;f.m.put(p,{...f.m.rows.get(p),[key]:value});await invoke(f);assert.equal(awards(f),0);checks++;
 }
 for(const side of ['tournaments','publicTournaments'])for(const key of ['scoreStorage','scoreBucketProjection']){
  const f=fixture();const p=side+'/'+code;f.m.put(p,{...f.m.rows.get(p),[key]:null});await invoke(f);assert.equal(awards(f),0);checks++;
 }
 for(const mutate of [f=>f.m.remove('tournaments/'+code),f=>{f.m.remove('tournaments/'+code);f.m.put('tournaments/'+code,f.top);},f=>{f.m.remove('publicTournaments/'+code);f.m.put('publicTournaments/'+code,f.pub);},f=>f.m.put('tournaments/'+code,{...f.top,eventCancelled:true}),f=>f.m.put('users/a',{active:false}),f=>f.m.put('users/a',{active:true,deleted:true}),f=>f.m.put('users/a',{active:true,role:'tester'}),f=>f.m.put('users/a',{active:true,isTestAccount:true})]){
  const f=fixture();f.m.interfere=()=>mutate(f);await invoke(f);assert.equal(balance(f),0);checks++;
 }
 for(const bucket of [false,true]){
  const f=fixture({bucket});await Promise.all([invoke(f),invoke(f)]);assert.equal(balance(f),10);assert.equal(awards(f),3);const ledger=f.m.rows.get(`activityPointLedgers/a/entries/tournament_${code}_a`);assert.equal(ledger.metadata.bucketEpoch,bucket?'epoch-1':null);checks++;
 }
 for(const ranked of [false,true]){
  const f=fixture({bucket:true});if(ranked)certify(f,{ranked});await invoke(f);assert.equal(balance(f),10);assert.equal(awards(f),3);assert(!f.m.writes.some(w=>w.path.startsWith('tournaments/')||w.path.startsWith('publicTournaments/')||w.path.startsWith('ladder')));checks++;
 }
 const invalidBucket={missingCert:f=>{delete f.top.bucketCompletion;f.m.put('tournaments/'+code,f.top);},badDigest:f=>{f.top.bucketCompletion.stateDigest='bad';f.m.put('tournaments/'+code,f.top);},missingBucket:f=>f.m.remove(`tournaments/${code}/matchBuckets/court-2`),staleBucket:f=>{const p=`tournaments/${code}/matchBuckets/court-1`;f.m.put(p,{...f.buckets[0],epoch:'other'});},aheadProjection:f=>{f.pub.scoreBucketProjection.versions['court-1']=4;f.m.put('publicTournaments/'+code,f.pub);},missingPublic:f=>f.m.remove('publicTournaments/'+code),wrongBorn:f=>{f.top.bucketCompletion.sourceCreatedAt='other';f.m.put('tournaments/'+code,f.top);},stalePrivateScore:f=>{const s=JSON.parse(f.top.data);s.matches[0].scoreA=1;f.top.data=JSON.stringify(s);f.m.put('tournaments/'+code,f.top);},wrongPrivateMarker:f=>{f.top.scoreBucketProjection={};f.m.put('tournaments/'+code,f.top);}};
 for(const [name,mutate]of Object.entries(invalidBucket)){const f=fixture({bucket:true});mutate(f);await invoke(f);assert.equal(awards(f),name==='stalePrivateScore'?3:0,name);checks++;}
 for(const kind of ['epoch','vector','mode','bucketDeletion']){
  const f=fixture({bucket:true});f.m.interfere=()=>{
   if(kind==='epoch'){f.manifest.epoch='new';f.top.scoreStorage=f.manifest;f.pub.scoreBucketProjection.epoch='new';f.buckets=f.buckets.map(b=>({...b,epoch:'new'}));for(const b of f.buckets)f.m.put(`tournaments/${code}/matchBuckets/${b.bucketId}`,b);certify(f);}
   if(kind==='vector'){const p=`tournaments/${code}/matchBuckets/court-1`;f.m.put(p,{...f.buckets[0],revision:4});}
   if(kind==='mode'){delete f.top.scoreStorage;delete f.pub.scoreBucketProjection;delete f.top.bucketCompletion;delete f.pub.bucketCompletion;f.m.put('tournaments/'+code,f.top);f.m.put('publicTournaments/'+code,f.pub);}
   if(kind==='bucketDeletion')f.m.put('publicTournaments/'+code,{...f.pub,deletionStatus:null});
  };await invoke(f);assert.equal(balance(f),0,kind);checks++;
 }
 // A previously issued legacy receipt remains permanent, without being
 // rewritten with an invented source generation. New recipients can recover.
 {const f=fixture();f.m.put(`activityPointLedgers/a/entries/tournament_${code}_a`,{uid:'a',delta:10,metadata:{tournamentCode:code}});await invoke(f);assert.equal(balance(f),0);assert(!f.m.writes.some(w=>w.path===`activityPointLedgers/a/entries/tournament_${code}_a`));checks++;}
 {const f=fixture();const ev=event(f);delete ev.data.after.createTime;await invoke(f,true,ev);assert.equal(awards(f),0);checks++;}
 {const f=fixture();f.m.db.runTransaction=async()=>{throw Error('synthetic-unavailable');};await assert.rejects(()=>invoke(f),/synthetic-unavailable/);checks++;}
 {const f=fixture();let grants=0;const old=f.m.db.runTransaction;f.m.db.runTransaction=async cb=>{const r=await old(cb);if(f.m.writes.length&&++grants===1)f.m.put('tournaments/'+code,{...f.top,eventCancelled:true});return r;};await invoke(f);assert.equal(balance(f,'a'),10);assert.equal(balance(f,'b'),0);assert.equal(balance(f,'host'),0);checks++;}
 console.log(JSON.stringify({activityChecks:checks,productionWrites:0,deploymentPerformed:false,scope:'synthetic Firestore/auth boundaries; actual captured and candidate activity modules'}));
}
if(require.main===module)main().catch(e=>{console.error(e);process.exitCode=1;});
module.exports={fixture,certify,load,event,invoke,awards,balance,code,NOW,R};
