'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const Q=require('../partner-quota-policy');
function records(policy='start-v1'){
 const now=Date.now(),grant={status:'active',scope:'contract',organizationId:'org',orderCode:'BXH-CO-20261027-ABCDEF123456',quotaPolicy:policy,quotaPolicyVersion:1};
 const contract={status:'active',targetUid:'owner',orderCode:grant.orderCode,organizationCode:'org',startsAt:new Date(now-86400000).toISOString(),expiresAt:new Date(now+86400000).toISOString(),includedEvents:1,usedEvents:0,quotaPolicy:policy,quotaPolicyVersion:1};
 return {grant,contract};
}
function runtime({policy='start-v1',contractPatch={},grantPatch={},missingHelper=false,network=false}={}){
 const f=records(policy);Object.assign(f.contract,contractPatch);Object.assign(f.grant,grantPatch);let commits=0;const writes=[],errors=[];
 const window={BXHPartnerQuota:missingHelper?null:Q,BXHPartnerOrganizer:{remainingRooms:()=>0},engagementService:{getPartnerContract:async()=>{if(network)throw Error('network');return f.contract;}},dispatchEvent:()=>{}};
 const ctx={window,cloudEnabled:true,generateRoomCode:()=>'BXH-POL001',currentUserUidForWrites:()=>'owner',currentUserDisplayNameForWrites:()=>'owner',isPartnerOrganizerMode:()=>true,partnerOrganizerGrant:()=>f.grant,userProfile:{role:'player',active:true},computeTournamentPhase:()=> 'waiting',buildPublicMirrorFields:data=>data,Date,Event:class{},console:{warn:(...x)=>errors.push(x)},fx:{doc:(_db,col,id)=>({col,id}),increment:n=>({increment:n}),writeBatch:()=>({set:(ref,payload)=>writes.push({kind:'set',ref,payload}),update:(ref,payload)=>writes.push({kind:'update',ref,payload}),commit:async()=>{commits++;}})},dbHandle:{}};
 const cloud=fs.readFileSync(path.join(__dirname,'../modules/cloud/cloud-runtime.js'),'utf8');const a=cloud.indexOf('    async createRoom(data){'),b=cloud.indexOf('    async joinRoom(code){',a);assert.ok(a>0&&b>a);vm.createContext(ctx);vm.runInContext('service=({'+cloud.slice(a,b)+'})',ctx);
 return {...f,writes,errors,run:data=>ctx.service.createRoom(data),get commits(){return commits;}};
}
test('new-policy room creation uses fresh contract state and never increments quota',async()=>{
 const f=runtime();assert.equal(await f.run({meta:{},startedAt:123,rosterLocked:true}),'BXH-POL001');assert.equal(f.commits,1);assert.equal(f.writes.filter(w=>w.kind==='update').length,0);
 for(const write of f.writes){assert.equal(write.payload.partnerQuotaPolicy,'start-v1');assert.equal(write.payload.partnerStartState,'draft');}
 assert.equal(JSON.parse(f.writes[0].payload.data).startedAt,null);
});
test('legacy room creation still stages the original atomic quota debit',async()=>{
 const f=runtime({policy:'creation-v1'});assert.equal(await f.run({meta:{}}),'BXH-POL001');assert.equal(f.writes.filter(w=>w.kind==='update').length,1);assert.equal(f.writes[0].payload.partnerQuotaPolicy,undefined);
});
test('missing or conflicting policy, quota data and network failures cannot fall back to legacy charging',async()=>{
 for(const options of [{missingHelper:true},{network:true},{contractPatch:{quotaPolicy:'unknown'}},{grantPatch:{quotaPolicy:'creation-v1'}},{contractPatch:{usedEvents:undefined}},{contractPatch:{usedEvents:1}}]){const f=runtime(options);assert.equal(await f.run({meta:{}}),null,JSON.stringify(options));assert.equal(f.commits,0);assert.equal(f.writes.length,0);}
});
test('protected root evidence restores canonical start state and fences browser start writes',()=>{
 const draft={partnerQuotaPolicy:'start-v1',partnerStartState:'draft'},state={startedAt:999,rdwSnapshotDigest:'fake',rosterLocked:true};Q.restoreState(state,draft);assert.equal(state.startedAt,null);assert.equal(state.rdwSnapshotDigest,undefined);Q.assertRuntimeWrite(state,draft);assert.throws(()=>Q.assertRuntimeWrite({...state,startedAt:999},draft),/server-start-required/);
 const top={partnerQuotaPolicy:'start-v1',partnerStartState:'started',partnerStartedAt:123,rdwSnapshotDigest:'a'.repeat(64),partnerQuotaDebit:{source:'server',snapshotDigest:'a'.repeat(64)}};Q.restoreState(state,top);assert.equal(state.startedAt,123);assert.equal(state.rosterLocked,true);Q.assertRuntimeWrite(state,top);assert.throws(()=>Q.restoreState({}, {...top,partnerQuotaDebit:null}),/proof-invalid/);
});
