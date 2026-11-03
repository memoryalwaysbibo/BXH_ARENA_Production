'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const path=require('node:path');
const runtime=fs.readFileSync(path.resolve(__dirname,'../../../modules/cloud/cloud-runtime.js'),'utf8');
const start=runtime.indexOf('    async deleteTournament(code){');
const end=runtime.indexOf('    async cleanupMyExpiredTestRooms()',start);
assert(start>=0&&end>start);
const method=runtime.slice(start,end).trim();
function fixture(){
 const rows=new Map(),calls=[];let uid='admin',result={ok:true,deleted:true},exists=false,error,readError,afterCall,afterRead,failStorage=false;
 const storage={getItem(k){if(failStorage)throw Error('blocked');return rows.get(k)??null;},setItem(k,v){if(failStorage)throw Error('blocked');rows.set(k,v);},removeItem(k){rows.delete(k);}};
 let sequence=0;
 const context={cloudEnabled:true,window:{localStorage:storage,engagementService:{async deleteTournamentSafely(p){calls.push(p);if(afterCall)await afterCall();if(error)throw error;return result;}}},currentUserUidForWrites:()=>uid,crypto:{randomUUID:()=>`operation-number-${++sequence}`},Date,dbHandle:{},fx:{doc:(_db,c,code)=>({c,code}),async getDoc(){if(afterRead)afterRead();if(readError)throw readError;return {exists:()=>exists};}}};
 const api=vm.runInNewContext('({'+method+'})',context);
 return {rows,calls,api,key:'bxh:delete-tournament:v1:admin:BXH-TEST01',get intent(){return JSON.parse(rows.get(this.key));},set uid(x){uid=x;},set result(x){result=x;},set exists(x){exists=x;},set error(x){error=x;},set readError(x){readError=x;},set afterCall(x){afterCall=x;},set afterRead(x){afterRead=x;},set failStorage(x){failStorage=x;}};
}
(async()=>{let checks=0;
 {const m=fixture();m.afterCall=()=>assert.equal(m.intent.operationId,m.calls[0].operationId);assert(await m.api.deleteTournament(' bxh-test01 '));assert(!m.rows.has(m.key));checks++;}
 {const m=fixture();m.error=Error('lost-response');await assert.rejects(m.api.deleteTournament('BXH-TEST01'),/lost-response/);const id=m.intent.operationId;m.error=null;assert(await m.api.deleteTournament('BXH-TEST01'));assert.equal(m.calls[1].operationId,id);checks++;}
 {const a=fixture();a.error=Error('offline');await assert.rejects(a.api.deleteTournament('BXH-TEST01'));const b=fixture();b.rows.set(b.key,a.rows.get(a.key));assert(await b.api.deleteTournament('BXH-TEST01'));assert.equal(b.calls[0].operationId,a.calls[0].operationId);checks++;}
 {const m=fixture();m.exists=true;await assert.rejects(m.api.deleteTournament('BXH-TEST01'),/delete-not-confirmed/);assert(m.rows.has(m.key));checks++;}
 {const m=fixture();m.readError=Error('read-offline');await assert.rejects(m.api.deleteTournament('BXH-TEST01'),/read-offline/);assert(m.rows.has(m.key));checks++;}
 {const m=fixture();m.failStorage=true;await assert.rejects(m.api.deleteTournament('BXH-TEST01'),/storage-unavailable/);assert.equal(m.calls.length,0);checks++;}
 {const m=fixture();m.rows.set(m.key,'invalid JSON');await assert.rejects(m.api.deleteTournament('BXH-TEST01'),/storage-unavailable/);assert.equal(m.calls.length,0);checks++;}
 {const m=fixture();m.rows.set(m.key,JSON.stringify({version:1,uid:'other',code:'BXH-TEST01',operationId:'operation-other',createdAt:1}));await assert.rejects(m.api.deleteTournament('BXH-TEST01'),/storage-unavailable/);assert.equal(m.calls.length,0);checks++;}
 {const m=fixture();m.afterCall=()=>{m.uid='other';};await assert.rejects(m.api.deleteTournament('BXH-TEST01'),/account-changed/);assert(m.rows.has(m.key));checks++;}
 {const m=fixture();m.afterRead=()=>{m.uid='other';};await assert.rejects(m.api.deleteTournament('BXH-TEST01'),/account-changed/);assert(m.rows.has(m.key));checks++;}
 {const m=fixture();m.result={ok:false,deleted:false,pending:true,operationId:'canonical-operation-001'};await assert.rejects(m.api.deleteTournament('BXH-TEST01'),/deletion-in-progress/);assert.equal(m.intent.operationId,'canonical-operation-001');assert.equal(m.calls.length,1);m.result={ok:true,deleted:true};assert(await m.api.deleteTournament('BXH-TEST01'));assert.equal(m.calls[1].operationId,'canonical-operation-001');checks++;}
 {const m=fixture();m.result={pending:true,operationId:'bad/id'};await assert.rejects(m.api.deleteTournament('BXH-TEST01'),/response-invalid/);assert(m.rows.has(m.key));checks++;}
 {const m=fixture();m.error=Error('deletion-operation-outdated');await assert.rejects(m.api.deleteTournament('BXH-TEST01'),/outdated/);assert(!m.rows.has(m.key));assert.equal(m.calls.length,1);checks++;}
 {const m=fixture();m.afterRead=()=>m.rows.set(m.key,'another-tab-intent');assert(await m.api.deleteTournament('BXH-TEST01'));assert.equal(m.rows.get(m.key),'another-tab-intent');checks++;}
 {const m=fixture();m.uid='';await assert.rejects(m.api.deleteTournament('BXH-TEST01'),/auth-required/);assert.equal(m.calls.length,0);checks++;}
 {const m=fixture();await assert.rejects(m.api.deleteTournament('not-a-room'),/invalid-code/);assert.equal(m.calls.length,0);checks++;}
 console.log(JSON.stringify({clientChecks:checks,productionWrites:0,deployed:false}));
})().catch(e=>{console.error(e);process.exitCode=1;});
