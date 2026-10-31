'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const PROJECT='demo-bxh-scoring-contention',HOST='127.0.0.1:8187';
// Fail closed before importing Firebase or constructing any client.
assert.equal(process.env.FIRESTORE_EMULATOR_HOST,HOST,'exact local Emulator required');
assert.equal(process.env.GCLOUD_PROJECT,PROJECT,'exact demo project required');
const {initializeApp,deleteApp}=require('firebase/app');
const F=require('firebase/firestore');
const clone=x=>JSON.parse(JSON.stringify(x));
const sourceRoot=process.env.BXH_LAB_SOURCE_ROOT;
assert(sourceRoot&&path.isAbsolute(sourceRoot),'explicit absolute source checkout required');
const cloud=fs.readFileSync(path.join(sourceRoot,'modules/cloud/cloud-runtime.js'),'utf8');
const core=fs.readFileSync(path.join(sourceRoot,'modules/main-app/core.js'),'utf8');
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
const gitBlob=x=>crypto.createHash('sha1').update('blob '+Buffer.byteLength(x)+'\0').update(x).digest('hex');
assert.equal(gitBlob(cloud),'e3c67f658a65c2c66dd187d636bd55784ba4c45b');
assert.equal(gitBlob(core),'c974fe3c20d7d4a45763085426a48b01cddbda4c');
const methodStart=cloud.indexOf('    async mutateMatchTransaction('),methodEnd=cloud.indexOf('\n    },',methodStart);
assert(methodStart>=0&&methodEnd>methodStart);
const method=cloud.slice(methodStart,methodEnd+7);
const addStart=core.indexOf('function addScore('),addEnd=core.indexOf('\n}',addStart)+2;
const addSource=core.slice(addStart,addEnd);
assert(addSource.includes('persistRefereeMatchMutation(matchId,'),'baseline score caller changed');
const persistStart=core.indexOf('function persistRefereeMatchMutation(');
assert(persistStart>=0,'baseline persistence caller missing');
const persistEnd=core.indexOf('\n}',persistStart)+2,persistSource=core.slice(persistStart,persistEnd);
assert(persistSource.includes('enqueueStationMatchMutation(')||persistSource.includes('enqueueStationMutation(')||persistSource.includes('mutateMatchTransaction('),'inspect persistence route before running');
const output=path.resolve('test-results/scoring-contention');fs.mkdirSync(output,{recursive:true});
const report={kind:'real-firestore-emulator-original-transaction',sourceRef:'c125c750aed6e1e44d2347310ac06d02322242e3',incidentDeploymentVerified:false,incidentCauseConfirmed:false,productionWrites:0,project:PROJECT,host:HOST,sdkVersion:require('firebase/package.json').version,source:{cloudBlob:gitBlob(cloud),coreBlob:gitBlob(core),methodSha256:hash(method),addScoreSha256:hash(addSource),persistSha256:hash(persistSource)},limitations:['synthetic mutation callback, no UI execution','minimal lab Rules; no production Rules certification','propagation/public projection/onsite and lifecycle helpers stubbed','no confirmation, advancement, three-seat handler, reconnect or production network tests','forced-read barrier cases are synthetic adverse timing','callback retries do not equal raw backend ABORTED counts'],cases:[]};
function save(){fs.writeFileSync(path.join(output,'results.json'),JSON.stringify(report,null,2)+'\n');}
const deadline=setTimeout(()=>{report.error='lab absolute deadline exceeded';save();process.exit(2);},240000);
const clients=[];
function makeClient(uid){
 const app=initializeApp({projectId:PROJECT,apiKey:'emulator-only'},uid);
 const db=F.getFirestore(app);F.connectFirestoreEmulator(db,'127.0.0.1',8187,{mockUserToken:{sub:uid}});
 const client={app,db,uid};clients.push(client);return client;
}
function fixture(code){return {id:code,cloudCode:code,meta:{stations:6,name:'Synthetic contention lab',eventAuthority:'official'},updatedAt:1,players:[],matches:Array.from({length:8},(_,i)=>({id:'m'+(i+1),station:i<6?i+1:0,scoreA:0,scoreB:0,log:[],dispatchRevision:0,completed:false,a:{playerId:'a'+i},b:{playerId:'b'+i}}))};}
function firstReadBarrier(size){
 let arrived=0,resolve,reject;
 const promise=new Promise((a,b)=>{resolve=a;reject=b;});
 const timer=setTimeout(()=>reject(Error('first-read barrier timed out')),20000);
 return {async wait(){if(++arrived===size){clearTimeout(timer);resolve();}await promise;},cancel(){clearTimeout(timer);resolve();}};
}
async function executeCase(seed,refs,config,repetition){
 const {name,count,mode,independent=false}=config;
 const codes=Array.from({length:count},(_,i)=>'BXH-LAB'+name.replace(/[^a-z]/gi,'').toUpperCase()+repetition+(independent?i:0));
 const unique=[...new Set(codes)];
 for(const code of unique){const state=fixture(code);await F.setDoc(F.doc(seed.db,'tournaments',code),{createdBy:'lab-host',data:JSON.stringify(state),updatedAt:1,refereeStationRestrictionEnabled:true,refereeStationAssignments:Object.fromEntries(refs.map((c,i)=>[String(i+1),[c.uid]]))});await F.setDoc(F.doc(seed.db,'publicTournaments',code),{bracketView:JSON.stringify(state),updatedAt:1});}
 const barrier=mode==='barrier'?firstReadBarrier(count):null;
 const metrics=refs.slice(0,count).map((c,i)=>({court:i+1,attempts:0,reads:0,stagedWrites:0,sdkErrorCode:null,sdkErrorMessage:null,elapsedMs:null,ok:false,reason:null}));
 async function send(i){
  const client=refs[i],metric=metrics[i],started=performance.now();
  const context={cloudEnabled:true,dbHandle:client.db,USERS_COLLECTION:'users',authHandle:{currentUser:{uid:client.uid}},
   rebuildPropagationForState:()=>{},advanceOnsiteWriteFence:()=>({}),courtLifecycleWritePatch:()=>({}),buildPublicMirrorFields:s=>clone(s),computeTournamentPhase:()=> 'live',
   fx:{doc:F.doc,runTransaction:async(db,fn)=>{
    try{return await F.runTransaction(db,async tx=>{
     metric.attempts++;const first=metric.attempts===1;
     return await fn({get:async ref=>{const snapshot=await tx.get(ref);metric.reads++;if(barrier&&first&&ref.path.startsWith('tournaments/'))await barrier.wait();return snapshot;},set:(...args)=>{metric.stagedWrites++;return tx.set(...args);}});
    });}catch(e){metric.sdkErrorCode=e.code||null;metric.sdkErrorMessage=e.message;throw e;}
   }}};
  vm.createContext(context);vm.runInContext('api={'+method+'}',context);
  const op='case-'+name+'-'+repetition+'-court-'+(i+1);
  const result=await context.api.mutateMatchTransaction(codes[i],'m'+(i+1),i+1,(state,m)=>{m.scoreA++;m.log.push({id:op,side:'A',type:'spin',points:1,synthetic:true});return {ok:true,state};},client.uid,{expectedRevision:0});
  metric.elapsedMs=Math.round(performance.now()-started);metric.ok=result.ok;metric.reason=result.reason||null;
 }
 try{
  if(mode==='sequential'){for(let i=0;i<count;i++)await send(i);}else await Promise.all(metrics.map((_,i)=>send(i)));
 }finally{barrier?.cancel();}
 for(const code of unique){
  const privateSnap=await F.getDocFromServer(F.doc(seed.db,'tournaments',code)),publicSnap=await F.getDocFromServer(F.doc(seed.db,'publicTournaments',code));
  const state=JSON.parse(privateSnap.data().data),mirror=JSON.parse(publicSnap.data().bracketView);
  assert.deepEqual(mirror,state,'private/public diverged');
  const original=fixture(code);
  for(let j=0;j<state.matches.length;j++){
   const idx=codes.findIndex((c,i)=>c===code&&i===j),expected=idx>=0&&metrics[idx].ok?1:0;
   const m=state.matches[j];assert.equal(m.scoreA,expected,'acknowledged score missing or failed score leaked');assert.equal(m.scoreB,0);assert.equal(m.log.length,expected,'duplicate/missing operation');
   if(expected)assert.equal(m.log[0].id,'case-'+name+'-'+repetition+'-court-'+(j+1));
   assert.deepEqual({...m,scoreA:0,log:[]},original.matches[j],'unrelated match fields changed');
  }
 }
 const result={name,repetition,mode,independentDocumentControl:independent,operations:count,successes:metrics.filter(m=>m.ok).length,failures:metrics.filter(m=>!m.ok).length,callbackRetries:metrics.reduce((s,m)=>s+Math.max(0,m.attempts-1),0),metrics};
 report.cases.push(result);save();
 console.log(JSON.stringify(result));
 // Infrastructure/validation failures are not evidence for contention.
 for(const m of metrics.filter(m=>!m.ok))assert.equal(m.sdkErrorCode,'aborted','non-contention failure requires investigation');
 if(mode==='sequential'||independent)assert.equal(result.failures,0,'control must succeed');
}
(async()=>{
 try{
  const seed=makeClient('lab-seed'),refs=Array.from({length:6},(_,i)=>makeClient('lab-ref'+(i+1)));
  for(const c of refs)await F.setDoc(F.doc(seed.db,'users',c.uid),{role:'staff',active:true});
  const configs=[{name:'single',count:1,mode:'sequential'},{name:'sixstaggered',count:6,mode:'sequential'},{name:'sixnatural',count:6,mode:'natural'},{name:'sixbarrier',count:6,mode:'barrier'},{name:'sixindependent',count:6,mode:'barrier',independent:true}];
  for(const config of configs)for(let repetition=1;repetition<=3;repetition++)await executeCase(seed,refs,config,repetition);
  report.status='diagnostic-complete';console.log('DIAGNOSTIC COMPLETE: this is not incident attribution or a production capacity certification.');
 }catch(e){report.status='failed';report.error={message:e.message,stack:e.stack};process.exitCode=1;console.error(e);}
 finally{save();clearTimeout(deadline);await Promise.allSettled(clients.map(async c=>{await F.terminate(c.db);await deleteApp(c.app);}));}
})();
