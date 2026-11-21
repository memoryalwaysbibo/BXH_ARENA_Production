'use strict';
const assert=require('node:assert/strict'),P=require('./probe.cjs');
const run=(f,candidate=true,options={})=>P.load(f,candidate,{project:'bxh-arena',...options}).activityCompletedTournamentBackfill();
function scanRace(f,mutate){const collection=f.m.db.collection;let done=false;f.m.db.collection=p=>{const q=collection(p);if(p==='tournaments'){const get=q.get;q.get=async()=>{const result=await get();if(!done){done=true;mutate();}return result;};}return q;};}
(async()=>{let checks=0;
 for(const options of [{},{legacy:true},{bucket:true}]){const f=P.fixture(options);await run(f);assert.equal(P.balance(f),options.legacy?3:10);assert.equal(P.awards(f),3);const before=JSON.stringify([...f.m.rows]);await run(f);assert.equal(JSON.stringify([...f.m.rows]),before);checks+=2;}
 for(const kind of ['missing','replacement','cancelled','publicReuse','migration']){
  const f=P.fixture();scanRace(f,()=>{
   const root='tournaments/'+P.code,pub='publicTournaments/'+P.code;
   if(kind==='missing')f.m.remove(root);
   if(kind==='replacement'){f.m.remove(root);f.m.put(root,f.top);}
   if(kind==='cancelled')f.m.put(root,{...f.top,eventCancelled:true});
   // A mirror re-created before the initial capture is safe when the current
   // parent is unchanged. It becomes the bound mirror for each award.
   if(kind==='publicReuse'){f.m.remove(pub);f.m.put(pub,f.pub);}
   if(kind==='migration')f.m.put(pub,{...f.pub,bucketMigration:null});
  });await run(f);assert.equal(P.awards(f),kind==='publicReuse'?3:0,kind);checks++;
 }
 for(const bucket of [false,true])for(const kind of ['inactive','deleted','tester','rootReuse','publicReuse','cancelled']){
  const f=P.fixture({bucket});f.m.interfere=()=>{const root='tournaments/'+P.code,pub='publicTournaments/'+P.code;
   if(kind==='inactive')f.m.put('users/a',{active:false});
   if(kind==='deleted')f.m.put('users/a',{active:true,deleted:true});
   if(kind==='tester')f.m.put('users/a',{active:true,role:'tester'});
   if(kind==='rootReuse'){f.m.remove(root);f.m.put(root,f.top);}
   if(kind==='publicReuse'){f.m.remove(pub);f.m.put(pub,f.pub);}
   if(kind==='cancelled')f.m.put(root,{...f.top,eventCancelled:true});
  };await run(f);assert.equal(P.balance(f),0,kind);checks++;
 }
 {const f=P.fixture(),logs=[];const original=f.m.db.runTransaction;let fail=true;f.m.db.runTransaction=async cb=>{if(fail){fail=false;throw Error('synthetic-source-read-failure');}return original(cb);};await run(f,true,{logs});assert.equal(P.awards(f),0);assert(logs.some(x=>x.includes('synthetic-source-read-failure')));await run(f);assert.equal(P.awards(f),3);checks++;}
 {const f=P.fixture(),original=f.m.db.runTransaction;let n=0;f.m.db.runTransaction=async cb=>{const r=await original(cb);if(++n===2)throw Error('synthetic-response-lost');return r;};await run(f);assert.equal(P.awards(f),1);await run(f);assert.equal(P.balance(f),10);assert.equal(P.awards(f),3);checks++;}
 {const f=P.fixture();await Promise.all([run(f),run(f)]);assert.equal(P.awards(f),3);assert.equal(P.balance(f),10);checks++;}
 {const f=P.fixture();f.m.db.collection=()=>{throw Error('must-not-query');};await run(f,true,{project:'demo-bxh-bucket-activity'});assert.equal(P.awards(f),0);checks++;}
 console.log(JSON.stringify({backfillChecks:checks,productionWrites:0,scope:'independently captured scheduler through synthetic Firestore, project and account boundaries'}));
})().catch(e=>{console.error(e);process.exitCode=1;});
