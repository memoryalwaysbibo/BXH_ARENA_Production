'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {CALLABLE_PATH,projectOnsiteSummary,syncOnsiteCommunitySummary}=require('./e2e/community-summary-fixture.cjs');
const clone=value=>JSON.parse(JSON.stringify(value));

function fixture(){
  const user={active:true,role:'player'};
  const state={id:'room-a',ownerUid:'host',createdBy:'host',meta:{eventAuthority:'community',communityQuickRegistration:true,registrationEnabled:false},
    players:[{id:'host',name:'Host',source:'host',uid:'host',playerUid:'host',accountUid:'host',checkedIn:true},
      ...['a','b','c'].map(id=>({id,name:id,source:'onsite',checkedIn:true}))],waitlistPlayers:[],matches:[],courtAssignments:{},communityParticipantCount:1};
  const mirror={meta:{eventAuthority:'community'},players:state.players.map(({id,name,checkedIn})=>({id,name,checkedIn})),matches:[],courtAssignments:{}};
  const common={eventAuthority:'community',communityQuickRegistration:true,ownerUid:'host',battleMode:'individual',registrationEnabled:false,
    registrationOpenAt:null,registrationCloseAt:null,cancellationDeadline:null,capacity:null,confirmedCount:0,waitlistCount:0,communityParticipantCount:1,tournamentPhase:'waiting'};
  return {user,state,mirror,tournament:{...common,createdBy:'host'},pub:{...common},registrations:[]};
}
function project(f){return projectOnsiteSummary('host',f.user,{...f.tournament,data:JSON.stringify(f.state)},{...f.pub,bracketView:JSON.stringify(f.mirror)},f.registrations);}

test('on-site summary derives authoritative count and safe public fields without changing private players',()=>{
  const f=fixture();f.state.players[0].email='private@example.test';f.state.players[0].phone='0900000000';
  const before=clone(f.state.players),result=project(f);
  assert.equal(result.count,4);assert.equal(result.state.registrationRosterRevision,1);assert.equal(result.mirror.registrationRosterRevision,1);
  assert.deepEqual(result.state.players,before);assert.deepEqual(Object.keys(result.mirror.players[0]),['id','name','checkedIn']);
  f.state=result.state;f.mirror=result.mirror;f.tournament.communityParticipantCount=4;f.pub.communityParticipantCount=4;
  assert.equal(project(f).changed,false,'a completed repair is idempotent');
});

test('generated pending draw, byes and idle/ready courts survive summary unchanged',()=>{
  const f=fixture();const matches=[{id:'m1',a:{playerId:'host'},b:{playerId:'a'},status:'ready',scoreA:0,scoreB:0},
    {id:'bye',isBye:true,completed:true,winnerId:'b',status:'completed'}];
  for(const value of [f.state,f.mirror])Object.assign(value,{drawnAt:10,bracketSize:4,matches:clone(matches),courtAssignments:{court1:{currentMatchId:'m1',status:'ready'},court2:{status:'idle'}}});
  const result=project(f);assert.deepEqual(result.state.matches,matches);assert.deepEqual(result.mirror.matches,matches);assert.deepEqual(result.state.courtAssignments,f.state.courtAssignments);
});

for(const [label,change] of [
  ['inactive account',f=>f.user.active=false],['disabled account',f=>f.user.accountStatus='disabled'],['other owner',f=>f.tournament.ownerUid='other'],
  ['creator mismatch',f=>f.tournament.createdBy='other'],['public owner mismatch',f=>f.pub.ownerUid='other'],['official event',f=>f.tournament.eventAuthority='official'],
  ['legacy room',f=>delete f.pub.communityQuickRegistration],['team event',f=>f.tournament.battleMode='team'],
  ['enabled online registration',f=>f.pub.registrationEnabled=true],['registration record',f=>f.registrations.push({status:'cancelled'})],
  ['nonzero counter',f=>f.pub.confirmedCount=1],['stale online player',f=>f.state.players.push({id:'online',source:'online'})],
  ['registration identity',f=>f.state.players[0].registrationId='reg'],['online waitlist',f=>f.state.waitlistPlayers.push({id:'wait',registrationId:'r'})],
  ['duplicate account alias',f=>f.state.players[1].accountUid='host'],['counterpart capacity mismatch',f=>f.pub.capacity=10],
  ['schedule mismatch',f=>f.pub.registrationOpenAt=10],['started room',f=>f.state.startedAt=10],['cancelled mirror',f=>f.pub.eventCancelled=true],
  ['scored match',f=>f.state.matches=[{id:'m',scoreA:1}]],['completed result',f=>f.mirror.matches=[{id:'m',completed:true}]],
  ['locked court',f=>f.state.courtAssignments={court1:{lockedBy:'ref'}}],['confirmed result',f=>f.state.matches=[{id:'m',confirmedAt:10}]],
  ['results ledger',f=>f.mirror.results=[{winner:'a'}]],['revision overflow',f=>f.state.registrationRosterRevision=Number.MAX_SAFE_INTEGER]
])test('fixture fails closed for '+label,()=>{const f=fixture();change(f);assert.throws(()=>project(f));});

function encode(value){
  if(value===null)return {nullValue:null};
  if(typeof value==='boolean')return {booleanValue:value};
  if(typeof value==='number')return {integerValue:String(value)};
  if(typeof value==='string')return {stringValue:value};
  if(Array.isArray(value))return {arrayValue:{values:value.map(encode)}};
  return {mapValue:{fields:Object.fromEntries(Object.entries(value).map(([key,val])=>[key,encode(val)]))}};
}
function transport(f=fixture()){
  const calls=[];
  const docs={'users/host':f.user,'tournaments/BXH-ABCDEF':{...f.tournament,data:JSON.stringify(f.state)},
    'publicTournaments/BXH-ABCDEF':{...f.pub,bracketView:JSON.stringify(f.mirror)}};
  return {calls,fetch:async(url,options={})=>{
    calls.push({url,options,body:options.body?JSON.parse(options.body):null});
    let data;
    if(url.startsWith('http://127.0.0.1:9099/'))data={users:[{localId:'host'}]};
    else if(url.endsWith(':beginTransaction'))data={transaction:'local-transaction'};
    else if(url.endsWith(':commit')||url.endsWith(':rollback'))data={};
    else if(url.endsWith(':runQuery'))data=f.registrations.length?f.registrations.map(row=>({document:{fields:encode(row).mapValue.fields}})):[{readTime:'2026-10-07T00:00:00Z'}];
    else if(url.endsWith(':batchGet'))data=JSON.parse(options.body).documents.map(name=>{const relative=name.split('/documents/')[1];assert(docs[relative],relative);return {found:{name,fields:encode(docs[relative]).mapValue.fields}};});
    else throw Error('unexpected-url');
    return {ok:true,json:async()=>data};
  }};
}
const request=()=>({method:'POST',url:CALLABLE_PATH,authorization:'Bearer emulator-id-token',body:{data:{action:'syncSummary',code:'BXH-ABCDEF',operationId:'fixture-operation-1'}}});

test('callable authenticates against loopback then atomically projects the two demo documents',async()=>{
  const io=transport();const result=await syncOnsiteCommunitySummary(request(),io.fetch);
  assert.deepEqual(result,{ok:true,communityParticipantCount:4});
  assert(io.calls.every(call=>new URL(call.url).hostname==='127.0.0.1'&&call.options.redirect==='error'));
  assert(io.calls.slice(1).every(call=>call.url.includes('/projects/demo-bxh-arena-e2e/')));
  assert.equal(io.calls[0].body.idToken,'emulator-id-token');
  const commit=io.calls.find(call=>call.url.endsWith(':commit')).body;
  assert.equal(commit.transaction,'local-transaction');assert.equal(commit.writes.length,2);
  assert(commit.writes.every(write=>write.name===undefined&&write.update.name.startsWith('projects/demo-bxh-arena-e2e/databases/(default)/documents/')));
  const publicWrite=commit.writes[1];assert.deepEqual(publicWrite.updateMask.fieldPaths,['communityParticipantCount','updatedAt','bracketView']);
  assert.deepEqual(Object.keys(JSON.parse(publicWrite.update.fields.bracketView.stringValue).players[0]),['id','name','checkedIn']);
});

for(const [label,change] of [
  ['wrong method',r=>r.method='GET'],['production path',r=>r.url='/bxh-arena/asia-east1/familyRegistration'],
  ['unknown callable',r=>r.url=CALLABLE_PATH.replace('familyRegistration','other')],['missing auth',r=>delete r.authorization],
  ['join action',r=>r.body.data.action='join'],['cancel action',r=>r.body.data.action='cancel'],
  ['extra payload',r=>r.body.data.players=[]],['path injection',r=>r.body.data.code='BXH-A/../../users'],['missing operation id',r=>delete r.body.data.operationId]
])test('unsupported request makes no emulator calls: '+label,async()=>{
  const input=request();change(input);const io=transport();await assert.rejects(syncOnsiteCommunitySummary(input,io.fetch));assert.equal(io.calls.length,0);
});

test('unsupported registrations roll back without any commit or mutation',async()=>{
  const f=fixture();f.registrations=[{status:'cancelled'}];const io=transport(f);
  await assert.rejects(syncOnsiteCommunitySummary(request(),io.fetch),/unsupported-online-registration/);
  assert(io.calls.some(call=>call.url.endsWith(':rollback')));assert(!io.calls.some(call=>call.url.endsWith(':commit')));
});

test('actual cloud summary wrapper rejects the former stub and accepts the fixture response',async()=>{
  const source=fs.readFileSync(path.join(__dirname,'../modules/cloud/cloud-runtime.js'),'utf8');
  const begin=source.indexOf('    async syncCommunityRegistrationSummary(code){'),end=source.indexOf('\n    async pushUpdate(',begin);
  assert(begin>=0&&end>begin);const method=source.slice(begin,end).trim().replace(/,$/,'');
  const ctx=vm.createContext({window:{engagementService:{familyRegistration:async()=>({ok:false,error:'e2e-function-stub'})}},crypto:{randomUUID:()=> 'fixture-operation-1'}});
  vm.runInContext('globalThis.cloud={'+method+'}',ctx);
  await assert.rejects(ctx.cloud.syncCommunityRegistrationSummary('BXH-ABCDEF'),/invalid-summary-result/);
  const io=transport();ctx.window.engagementService.familyRegistration=data=>syncOnsiteCommunitySummary({...request(),body:{data}},io.fetch);
  assert.equal((await ctx.cloud.syncCommunityRegistrationSummary('BXH-ABCDEF')).communityParticipantCount,4);
});
