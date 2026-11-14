'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),{createRequire}=require('node:module');
const {createScoreDiagnostics}=require('./functions/score-diagnostics.cjs');
function diagnostics(options={}){
 const records=[];let tick=0,alarm,cancelled=false;
 const opts={emit:r=>records.push(r),now:()=>tick,schedule:fn=>{alarm=fn;return {unref(){}};},cancel:()=>{cancelled=true;},...options};
 return {records,opts,advance:ms=>{tick+=ms;},alarm:()=>alarm(),cancelled:()=>cancelled};
}
const request=()=>({auth:{uid:'PRIVATE_UID'},rawRequest:{headers:{'x-cloud-trace-context':'0123456789abcdef0123456789abcdef/123;o=1',authorization:'PRIVATE_TOKEN'}},data:{code:'BXH-TEST',action:'score',operationId:'diagnostic-score-operation',station:1,matchId:'m1',expectedCourtRevision:1,expectedScoreRevision:0,expectedDispatchRevision:0,playerAId:'a',playerBId:'b',side:'A',finish:'spin',privateName:'PRIVATE_NAME'}});
test('slow diagnostic reports current stage, retry count and elapsed time without private payload',()=>{
 const f=diagnostics(),d=createScoreDiagnostics(request(),f.opts);d.beginAttempt();f.advance(100);d.phase('commit');f.advance(19900);f.alarm();
 const slow=f.records.find(r=>r.event==='slow');assert.equal(slow.phase,'commit');assert.equal(slow.elapsedMs,20000);assert.equal(slow.phaseElapsedMs,19900);
 d.beginAttempt();d.complete();d.close();assert.equal(f.records.at(-1).attempt,2);assert(f.records.some(r=>r.event==='retry'));assert(f.cancelled());
 const encoded=JSON.stringify(f.records);for(const privateValue of ['PRIVATE_UID','PRIVATE_TOKEN','PRIVATE_NAME','diagnostic-score-operation'])assert(!encoded.includes(privateValue));
 assert.equal(slow.room,'BXH-TEST');assert.equal(slow['logging.googleapis.com/trace'],'projects/bxh-arena/traces/0123456789abcdef0123456789abcdef');
});
test('error messages and malformed trace headers are excluded; closed watchdog is silent',()=>{
 const f=diagnostics(),r=request();r.rawRequest.headers['x-cloud-trace-context']='SECRET';const d=createScoreDiagnostics(r,f.opts);
 d.failed(Object.assign(Error('PRIVATE_ERROR'),{code:10}));d.close();const count=f.records.length;f.alarm();assert.equal(f.records.length,count);
 assert.equal(f.records.at(-1).errorCode,10);assert(!JSON.stringify(f.records).includes('SECRET'));assert(!JSON.stringify(f.records).includes('PRIVATE_ERROR'));
});
function serviceFixture({attempts=1,failure=null,loggerFailure=false}={}){
 const f=diagnostics(loggerFailure?{emit:()=>{throw Error('logger unavailable');}}:{}),req=request(),docs=new Map(),operations=[];
 const state={id:'r',cloudCode:'BXH-TEST',startedAt:1,meta:{eventAuthority:'official',formatType:'single',stations:1,scoringMode:'standard'},players:[{id:'a',name:'A'},{id:'b',name:'B'}],matches:[{id:'m1',station:1,round:0,indexInRound:0,seq:0,bracket:'SE',a:{type:'player',playerId:'a'},b:{type:'player',playerId:'b'},scoreA:0,scoreB:0,log:[],faultActions:[],completed:false,status:'in_progress',refereeSeatScoreRevision:0}]};
 docs.set('tournaments/BXH-TEST',{createdBy:'PRIVATE_UID',eventAuthority:'official',assignedStaffUids:['PRIVATE_UID'],data:JSON.stringify(state),refereeSeatsV1:{version:1,courts:{1:{revision:1,main:{uid:'PRIVATE_UID',name:'Private'},backup1:null,backup2:null}}}});
 docs.set('publicTournaments/BXH-TEST',{bracketView:JSON.stringify({meta:{},matches:[]})});docs.set('users/PRIVATE_UID',{active:true,role:'super_admin'});docs.set('systemConfig/refereeSeatsV1',{enabled:true,perCourtScoringVerified:true});
 const ref=path=>({path,collection:name=>({doc:id=>ref(path+'/'+name+'/'+id)})});
 const db={doc:ref,async runTransaction(callback){let result;for(let i=0;i<attempts;i++){
  const writes=[];result=await callback({get:async r=>({exists:docs.has(r.path),data:()=>docs.get(r.path)}),update:(r,v)=>writes.push(['update',r.path,v]),create:(r,v)=>writes.push(['create',r.path,v]),set:(r,v)=>writes.push(['set',r.path,v])});
  if(failure)throw failure;
  if(i===attempts-1){operations.push(...writes);for(const [type,path,value] of writes)docs.set(path,type==='update'?{...docs.get(path),...value}:value);}
 }return result;}};
 const path=require.resolve('./functions/scoring-service.cjs'),localRequire=createRequire(path),context={module:{exports:{}},require:name=>name==='./score-diagnostics.cjs'?{createScoreDiagnostics:r=>createScoreDiagnostics(r,f.opts)}:localRequire(name)};
 vm.runInNewContext(fs.readFileSync(path,'utf8'),context,{filename:path});
 return {...f,req,docs,operations,handle:context.module.exports.createScoringHandler(db,{clock:()=>1000})};
}
test('real scoring handler logs commit only after transaction resolves; retried callback scores once',async()=>{
 const f=serviceFixture({attempts:2}),result=await f.handle(f.req);assert.equal(result.ok,true);assert.equal(result.state.matches[0].scoreA,1);assert.equal(result.state.matches[0].log.length,1);
 assert.equal(JSON.parse(f.docs.get('tournaments/BXH-TEST').data).matches[0].scoreA,1);assert.equal(f.operations.length,4);
 assert.equal(f.records.at(-1).event,'complete');assert.equal(f.records.at(-1).phase,'commit');assert.equal(f.records.at(-1).attempt,2);assert(f.cancelled());
 const replay=await f.handle(f.req);assert.equal(replay.state.matches[0].scoreA,1);assert.equal(f.operations.length,4);assert.equal(f.records.at(-1).phase,'commit-replay');
});
test('transaction rejection preserves original error and writes no score or successful diagnostic',async()=>{
 const error=Object.assign(Error('PRIVATE_DEPENDENCY_ERROR'),{code:4}),f=serviceFixture({failure:error});
 await assert.rejects(f.handle(f.req),e=>e===error);assert.equal(f.operations.length,0);assert(!f.records.some(r=>r.event==='complete'));assert.equal(f.records.at(-1).event,'failed');assert(f.cancelled());
});
test('broken logging does not prevent a valid score; invalid requests create no timer',async()=>{
 const f=serviceFixture({loggerFailure:true});assert.equal((await f.handle(f.req)).state.matches[0].scoreA,1);
 const g=serviceFixture();g.req.auth=null;await assert.rejects(g.handle(g.req),/unauthenticated/);assert.equal(g.records.length,0);
});
