'use strict';
// Execute the actual shipped cloud join method, self chooser and feedback state
// machine in independent JS contexts. This is NOT a real browser/Auth test.
const vm=require('node:vm'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {db,handlers,service,seed,drainAll,audit}=require('./harness.cjs');
const {createApi}=require('../backend/api.cjs');
const Feedback=require('../../modules/main-app/registration-feedback.js');
const root=path.join(__dirname,'../..'),cloud=fs.readFileSync(path.join(root,'modules/cloud/cloud-runtime.js'),'utf8'),family=fs.readFileSync(path.join(root,'family-ui.js'),'utf8');
function method(name){const start=cloud.indexOf('    async '+name+'('),end=cloud.indexOf('\n    },',start);assert(start>=0&&end>start);return cloud.slice(start,end+6).trim().replace(/,$/,'');}
const chooser=family.slice(family.indexOf('async function chooseFamilyParticipant('),family.indexOf('// v13.40.0',family.indexOf('async function chooseFamilyParticipant(')));
const helperStart=cloud.indexOf('  function runMyEventsPlayerOperation('),helperEnd=cloud.indexOf('\n  }',helperStart),helper=cloud.slice(helperStart,helperEnd+4);
const routeStart=cloud.indexOf('  async function registrationFlowV2Enabled('),routeEnd=cloud.indexOf('\n  }',routeStart);
assert(routeStart>=0&&routeEnd>routeStart);
const route=cloud.slice(routeStart,routeEnd+4);
function memory(){const data=new Map();return {get length(){return data.size;},key:i=>[...data.keys()][i],getItem:k=>data.get(k)||null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)};}
const percentile=(a,p)=>a.slice().sort((x,y)=>x-y)[Math.min(a.length-1,Math.ceil(a.length*p)-1)]||0;
const waveSizes=[50,100,150,320];
const report={scope:'Actual frontend self-registration functions + feedback controller + captured backend + local Firestore Emulator. Synthetic Auth/DOM-free VM; not browser, mobile, production networking or live Cloud Run.',results:[]};
(async()=>{
 const watchdog=setTimeout(()=>{console.error('frontend-wave-timeout');process.exit(1);},120000);
 for(const n of waveSizes){
  let accepted=0,release;const acceptedAll=new Promise(r=>{release=r;});
  const {code,ids}=await seed(n,Math.max(200,n),0),services=Array.from({length:5},()=>service()),controllers=[],storages=[],times=[],traffic={preview:0,submit:0,mine:0};let clockOffset=0;
  const start=performance.now();
  const calls=ids.map((uid,i)=>{
   const api=createApi({queue:services[i%5],family:handlers.family(db),enabled:async c=>c===code});
   const storage=memory();storages.push(storage);
   let ctx;
   const control=Feedback.create({getUid:()=>uid,storage,now:()=>Date.now()+clockOffset,read:(c,operation)=>ctx.window.engagementService.familyRegistration({action:'mine',code:c,...operation}),retry:p=>ctx.window.engagementService.familyRegistration(p)});controllers.push(control);
   ctx=vm.createContext({window:{BXHRegistrationFeedback:Feedback,BXH_REGISTRATION_FLOW_V2_ROOMS:[code]},crypto:{randomUUID:()=>crypto.randomUUID()},authReady:true,authHandle:{currentUser:{uid}},engagementSessionEpoch:1,currentAuthUid:()=>uid,rememberRegistrationV2Route:()=>{},getPlayerRegistrationFeedback:()=>control,dbHandle:db,fx:{doc:(db,collection,id)=>db.doc(collection+'/'+id),getDoc:async ref=>{const s=await ref.get();return {exists:()=>s.exists,data:()=>s.data()};}},callEngagementFunction:async(name,payload)=>{
    if(payload.action==='preview')traffic.preview++;
    if(payload.action==='mine')traffic.mine++;
    if(name!=='registrationQueueV2')throw Error('unexpected legacy service '+name);
    const r=await api({auth:{uid},data:payload});
    if(payload.action==='submit'){traffic.submit++;if(++accepted===n)release();}
    return r;
   }});
   vm.runInContext(chooser+'\n'+helper+'\n'+route+'\nwindow.engagementService={registrationFlowV2Enabled,'+method('familyRegistration')+'};api={'+method('joinTournamentAsPlayer')+'};',ctx);
   return ctx.api.joinTournamentAsPlayer(code,true,'self').then(r=>{times.push(performance.now()-start);return r;});
  });
  // Attach rejection handlers immediately, then release the independent workers
  // after all real frontend paths have made their acceptance requests.
  const resultsPromise=Promise.allSettled(calls);
  await Promise.race([acceptedAll,resultsPromise.then(r=>{throw Error('clients-finished-before-acceptance: '+r.filter(x=>x.status==='rejected').map(x=>x.reason?.message).join(', '));})]);await drainAll(services,code);clockOffset+=4000;
  await Promise.all(controllers.map(c=>c.recheck(code)));
  const results=await resultsPromise,a=await audit(code,n);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,n);assert(results.every(r=>r.value?.status==='confirmed'));
  assert.equal(traffic.preview,0);assert.equal(traffic.submit,n);assert(storages.every(s=>s.length===0));assert.equal(a.summary.jobs,n);
  controllers.forEach(c=>c.dispose());
  const row={n,workers:5,confirmed:n,failed:0,duplicateRegistrations:0,remainingJournalEntries:0,traffic,p50Ms:Math.round(percentile(times,.5)),p95Ms:Math.round(percentile(times,.95)),maxMs:Math.round(Math.max(...times)),totalMs:Math.round(performance.now()-start)};
  report.results.push(row);fs.writeFileSync(path.join(__dirname,'../evidence/frontend-waves.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(row));
 }
 clearTimeout(watchdog);assert.equal(report.results.length,waveSizes.length);await db.terminate();
})().catch(async e=>{console.error(e);await db.terminate();process.exitCode=1;});
