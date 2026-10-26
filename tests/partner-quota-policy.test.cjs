'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const Q=require('../partner-quota-policy');
function records(policy='start-v1'){
 const now=Date.now(),grant={status:'active',scope:'contract',rankedMode:true,organizationId:'org',orderCode:'BXH-CO-20261027-ABCDEF123456',quotaPolicy:policy,quotaPolicyVersion:1};
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
 const f=runtime();assert.equal(await f.run({meta:{ladderMode:'ranked'},startedAt:123,rosterLocked:true}),'BXH-POL001');assert.equal(f.commits,1);assert.equal(f.writes.filter(w=>w.kind==='update').length,0);
 for(const write of f.writes){assert.equal(write.payload.partnerQuotaPolicy,'start-v1');assert.equal(write.payload.partnerStartState,'draft');}
 assert.equal(JSON.parse(f.writes[0].payload.data).startedAt,null);
});
test('legacy room creation still stages the original atomic quota debit',async()=>{
 const f=runtime({policy:'creation-v1'});assert.equal(await f.run({meta:{}}),'BXH-POL001');assert.equal(f.writes.filter(w=>w.kind==='update').length,1);assert.equal(f.writes[0].payload.partnerQuotaPolicy,undefined);
});
test('missing or conflicting policy, quota data and network failures cannot fall back to legacy charging',async()=>{
 for(const options of [{missingHelper:true},{network:true},{contractPatch:{quotaPolicy:'unknown'}},{grantPatch:{quotaPolicy:'creation-v1'}},{contractPatch:{usedEvents:undefined}},{contractPatch:{usedEvents:1}}]){const f=runtime(options);assert.equal(await f.run({meta:{ladderMode:'ranked'}}),null,JSON.stringify(options));assert.equal(f.commits,0);assert.equal(f.writes.length,0);}
});
test('protected root evidence restores canonical start state and fences browser start writes',()=>{
 const draft={partnerQuotaPolicy:'start-v1',partnerStartState:'draft'},state={startedAt:999,rdwSnapshotDigest:'fake',rosterLocked:true};Q.restoreState(state,draft);assert.equal(state.startedAt,null);assert.equal(state.rdwSnapshotDigest,undefined);Q.assertRuntimeWrite(state,draft);assert.throws(()=>Q.assertRuntimeWrite({...state,startedAt:999},draft),/server-start-required/);
 const top={partnerQuotaPolicy:'start-v1',partnerStartState:'started',partnerStartedAt:123,rdwSnapshotDigest:'a'.repeat(64),partnerQuotaDebit:{source:'server',snapshotDigest:'a'.repeat(64)}};Q.restoreState(state,top);assert.equal(state.startedAt,123);assert.equal(state.rosterLocked,true);Q.assertRuntimeWrite(state,top);assert.throws(()=>Q.restoreState({}, {...top,partnerQuotaDebit:null}),/proof-invalid/);
});

test('start-policy contracts cannot create a general or test tournament',async()=>{for(const data of [{meta:{ladderMode:'general'}},{meta:{ladderMode:'ranked'},testMode:true}]){const f=runtime();assert.equal(await f.run(data),null);assert.equal(f.commits,0);}});

test('creation errors explain policy and quota without exposing internal codes',()=>{assert.match(Q.creationErrorMessage('partner-room-quota-exhausted',{quotaPolicy:'start-v1'}),/可開賽場次/);assert.match(Q.creationErrorMessage('partner-ranked-room-required'),/積分賽/);assert.match(Q.creationErrorMessage('partner-quota-reconciliation-required'),/核對/);});

const core=fs.readFileSync(path.join(__dirname,'../modules/main-app/core.js'),'utf8');
function adminContext(policies=['creation-v1']){
 const stored=new Map(),calls=[],toasts=[];const fields={'.partner-contract-plan':'P1','.partner-contract-name':'Synthetic partner','.partner-contract-amount':'300','.partner-contract-start':'2026-10-27','.partner-contract-end':'2026-10-28','.partner-contract-terms':'Synthetic terms','.partner-contract-quota-policy':policies.includes('start-v1')?'start-v1':'creation-v1'};
 const ctx={partnerPlansState:{plans:[{planCode:'P1',active:true,rankedMode:true}],quotaPolicies:policies},isSuperAdmin:()=>true,currentAuthUid:()=>'admin',accountMgmtUsers:[{uid:'buyer',role:'player'}],managedAccountControl:selector=>({value:fields[selector]}),target:{getAttribute:()=>'buyer'},action:'partner-create-contract',showToast:(...v)=>toasts.push(v),render:()=>{},partnerDraftOrders:new Map(),sessionStorage:{getItem:k=>stored.get(k)||null,setItem:(k,v)=>stored.set(k,v),removeItem:k=>stored.delete(k)},crypto:{randomUUID:()=>'synthetic-operation'},window:{engagementService:{listPartnerPlans:async()=>({plans:[],quotaPolicies:policies}),createPartnerContractDraft:async data=>{calls.push(data);return {orderCode:'BXH-CO-20261027-ABCDEF123456'};}}},esc:s=>s,partnerOrderFor:()=>null,legacyPartnerRevocationPatch:()=>null,Date,JSON};
 vm.createContext(ctx);return {ctx,calls,toasts,fields};
}
test('actual admin loader and contract card offer start debit only when server advertises readiness',async()=>{
 for(const policies of [['creation-v1'],['creation-v1','start-v1']]){
  const {ctx}=adminContext(policies);ctx.partnerPlansState.plans=null;
  vm.runInContext(core.slice(core.indexOf('async function loadPartnerPlans('),core.indexOf('\nlet superAdminManagementPage',core.indexOf('async function loadPartnerPlans('))),ctx);await ctx.loadPartnerPlans();
  const a=core.indexOf('function renderPartnerContractCard('),b=core.indexOf('\nfunction renderAccountManagementScreen(',a);vm.runInContext(core.slice(a,b),ctx);
  const html=ctx.renderPartnerContractCard({uid:'buyer'});assert.equal(html.includes('value="start-v1" selected'),policies.includes('start-v1'));assert.ok(html.includes('建房時扣場'));
 }
});
test('actual draft handler submits explicit ready policy and rejects a forged choice',async()=>{
 const a=core.indexOf("  if(action==='partner-create-contract'){"),b=core.indexOf("  if(action==='partner-refresh-contract'",a);assert.ok(a>0&&b>a);
 for(const policies of [['creation-v1'],['creation-v1','start-v1']]){
  const {ctx,calls}=adminContext(policies);vm.runInContext('handle=async()=>{'+core.slice(a,b)+'}',ctx);await ctx.handle();await new Promise(resolve=>setImmediate(resolve));assert.equal(calls.length,1);assert.equal(calls[0].quotaPolicy,policies.includes('start-v1')?'start-v1':undefined);
 }
 const f=adminContext();f.fields['.partner-contract-quota-policy']='start-v1';vm.runInContext('handle=async()=>{'+core.slice(a,b)+'}',f.ctx);await f.ctx.handle();assert.equal(f.calls.length,0);assert.match(f.toasts[0][0],/尚未開放/);
});
