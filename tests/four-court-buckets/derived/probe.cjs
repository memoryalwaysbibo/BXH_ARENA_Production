'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {countOfficialMatches}=require('./official-match-titles-core.cjs');
const candidate=path.resolve(__dirname,'../../../release/buckets/derived/candidate/index.js');
const state={archiveStatus:'completed',players:[{id:'p1',accountUid:'u1'},{id:'p2',accountUid:'u2'}],matches:[{id:'m1',a:{playerId:'p1'},b:{playerId:'p2'},winnerId:'p1',completed:true}]};
const log={type:'event',playerUid:'u1',eventCode:'BXH-TEST',bucketEpoch:'epoch-1',sourceCreatedAt:'123:456'};
function subject(root,file=candidate,event=log){
 const source=fs.readFileSync(file,'utf8');
 const start=source.indexOf('async function processOfficialEventLog('),end=source.indexOf('const OCT_CARD_CAMPAIGN',start);
 assert.ok(start>0&&end>start);
 let counted=null,reads=[];
 const db={doc(p){return {async get(){reads.push(p);if(p==='tournaments/BXH-TEST')return {exists:true,data:()=>root,createTime:{seconds:123,nanoseconds:456}};if(p==='tournaments/BXH-TEST/registrations/u1')return {exists:true,data:()=>({uid:'u1',playerId:'p1'})};if(p==='users/u1')return {exists:true,data:()=>({active:true})};if(p.startsWith('playerEventResults/'))return {exists:false};throw Error('unexpected-read '+p);}}}};
 const context={db,tournamentState:t=>JSON.parse(t.data),validDocumentId:()=>true,isTestProfile:()=>false,safeId:x=>x,countOfficialMatches:input=>{counted=input;return countOfficialMatches(input)}};
 vm.runInNewContext(source.slice(start,end)+'; globalThis.subject=processOfficialEventLog;',context);
 return {run:()=>context.subject(event,'log-1','official_tournament',true),counted:()=>counted,reads};
}
const base={eventAuthority:'official',ladderMode:'ranked',ladderPointsAwarded:true,data:JSON.stringify(state)};
test('captured deployed source fails before official result handling',async()=>{await assert.rejects(subject(base,path.join(__dirname,'deployed-index.js')).run(),/state is not defined/)});
test('legacy official event reaches verified match count',async()=>{const s=subject(base),out=await s.run();assert.equal(out.status,'eligible');assert.equal(countOfficialMatches(s.counted()),1)});
test('bucket event uses committed canonical root state',async()=>{const s=subject({...base,scoreStorage:{},bucketSettlement:{version:1,status:'completed',epoch:'epoch-1'}}),out=await s.run();assert.equal(out.status,'eligible');assert.equal(countOfficialMatches(s.counted()),1)});
test('bucket generation mismatch stops before registration and reward reads',async()=>{const s=subject({...base,scoreStorage:{},bucketSettlement:{version:1,status:'completed',epoch:'other'}}),out=await s.run();assert.equal(out.reason,'bucket-settlement-source-mismatch');assert.deepEqual(s.reads,['tournaments/BXH-TEST'])});
test('bucket recreated under same code cannot reuse an old log',async()=>{const s=subject({...base,scoreStorage:{},bucketSettlement:{version:1,status:'completed',epoch:'epoch-1'}},candidate,{...log,sourceCreatedAt:'122:456'}),out=await s.run();assert.equal(out.reason,'bucket-settlement-source-mismatch');assert.deepEqual(s.reads,['tournaments/BXH-TEST'])});
test('incomplete bucket archive cannot award a derived result',async()=>{const s=subject({...base,data:JSON.stringify({...state,archiveStatus:'settling'}),scoreStorage:{},bucketSettlement:{version:1,status:'completed',epoch:'epoch-1'}}),out=await s.run();assert.equal(out.reason,'bucket-settlement-source-mismatch');assert.deepEqual(s.reads,['tournaments/BXH-TEST'])});
