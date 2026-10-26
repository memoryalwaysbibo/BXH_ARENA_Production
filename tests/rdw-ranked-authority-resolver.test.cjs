const test=require('node:test'),assert=require('node:assert/strict');
const {createRankedAuthorityResolver}=require('../scripts/lib/rdw-ranked-authority-resolver.cjs');
const code='BXH-ABC123',actor='actor',now=2000;
function fixture({role='staff',creator=actor,roomPatch={},statePatch={},userPatch={}}={}){
 const state={cloudCode:code,createdBy:creator,registrationRosterRevision:4,meta:{ladderMode:'ranked',eventAuthority:'official'},...statePatch};
 const room={code,createdBy:creator,eventAuthority:'official',createdByRole:'staff',data:JSON.stringify(state),...roomPatch};
 const user={role,active:true,...userPatch};
 const reads=[],writes=[];
 const db={doc:key=>({key}),runTransaction:async fn=>fn({get:async ref=>{
  reads.push(ref.key);return {exists:true,data:()=>ref.key.startsWith('tournaments/')?room:user};
 },create:()=>writes.push('create'),update:()=>writes.push('update')})};
 return {resolve:createRankedAuthorityResolver({db,clock:()=>now}),reads,writes,room,user};
}
const req={eventCode:code,actorUid:actor,expectedRosterRevision:4};
test('official staff creator and active admin receive trusted evidence',async()=>{
 for(const [role,creator] of [['staff',actor],['admin','owner'],['super_admin','owner']]){
  const f=fixture({role,creator});const result=await f.resolve(req);
  assert.equal(result.ok,true);assert.equal(result.evidence.source,'trusted-server');
  assert.equal(result.evidence.creatorUid,creator);assert.deepEqual(f.writes,[]);
  assert.deepEqual(f.reads,['tournaments/'+code,'users/'+actor]);
 }
});
test('normal player cannot self-declare official ranked status',async()=>{
 for(const role of ['player','tester','event_staff']){
  const f=fixture({role});assert.equal((await f.resolve(req)).ok,false);assert.deepEqual(f.writes,[]);
 }
});
test('partner grant must match organization, order, owner, active window',async()=>{
 const grant={role:'player',partnerOrganizer:{status:'active',organizationId:'organization-1',orderCode:'contract-1',startsAtMs:1000,expiresAtMs:3000}};
 const roomPatch={createdByRole:'partner_organizer',partnerOrganizationCode:'organization-1',partnerContractOrderCode:'contract-1'};
 const f=fixture({role:'player',userPatch:grant,roomPatch});assert.equal((await f.resolve(req)).ok,true);
 for(const changes of [{roomPatch:{partnerOrganizationCode:'different'}},{roomPatch:{partnerContractOrderCode:'wrong'}},{userPatch:{partnerOrganizer:{...grant.partnerOrganizer,expiresAtMs:1000}}},{userPatch:{partnerOrganizer:{...grant.partnerOrganizer,status:'revoked'}}}]){
  const x=fixture({role:'player',userPatch:{...grant,...changes.userPatch},roomPatch:{...roomPatch,...changes.roomPatch}});
  assert.equal((await x.resolve(req)).ok,false);
 }
});
test('general, community, stale roster and creator conflict fail closed',async()=>{
 for(const cfg of [{statePatch:{meta:{ladderMode:'general',eventAuthority:'official'}}},{statePatch:{meta:{ladderMode:'ranked',eventAuthority:'community'}}},{statePatch:{registrationRosterRevision:7}},{roomPatch:{createdBy:'other-owner'}}]){
  const f=fixture(cfg);assert.equal((await f.resolve(req)).ok,false);
 }
});
test('disabled, test or missing authorization never passes',async()=>{
 for(const patch of [{active:false},{isTestAccount:true},{deleted:true},{accountStatus:'frozen'}]){
  const f=fixture({userPatch:patch});assert.equal((await f.resolve(req)).ok,false);
 }
});
test('invalid inputs do not read Firestore',async()=>{
 const f=fixture();assert.equal((await f.resolve({...req,eventCode:'bad'})).ok,false);assert.equal(f.reads.length,0);
});
