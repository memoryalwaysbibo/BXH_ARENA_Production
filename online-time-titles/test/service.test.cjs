'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const D=require('../domain.cjs'),{createService}=require('../service.cjs');
const {MockDB}=require('../../referee-certificates/test/mock-db.cjs');
const START=1800000000000;
function fixture(extra={}){
  const db=new MockDB({'users/alice':{active:true,role:'player'},
    'systemSettings/onlineTimeTitles':{enabled:true,startAt:START,sourceSchema:'lastSeenAt-v1'},
    'systemSettings/engagement':{titlesEnabled:true,automaticTitleAwardsEnabled:true},
    'playerStats/alice':{totalCheckInDays:20},...extra});
  // Extend the shared MVCC fixture with Firestore's top-level merge semantics.
  const original=db.runTransaction.bind(db);
  db.runTransaction=fn=>original(tx=>fn({...tx,set(ref,value,options){
    tx.set(ref,options?.merge?{...(db.read(ref.path)||{}),...value}:value);
  }}));
  const awards=[],held=new Set();let fail=false;
  const service=createService(db,{clock:()=>START+10000000,awardTitle:async input=>{
    if(fail){fail=false;throw Error('temporary-award-failure');}
    if(held.has(input.titleId))return {awarded:false,reason:'already-earned'};
    held.add(input.titleId);awards.push(input);return {awarded:true};
  }});
  return {db,awards,held,service,failNextAward(){fail=true;}};
}
function event(from,to,id='event'){
  const snapshot=time=>({exists:time!=null,ref:{path:'onlinePresence/alice'},data:()=>({lastSeenAt:time})});
  return {id,params:{uid:'alice'},data:{before:snapshot(from),after:snapshot(to)}};
}
test('six approved names, thresholds and independent classification fields',()=>{
  assert.deepEqual(D.DEFINITIONS.map(d=>[d.name,d.targetValue/60,d.rarityTier]),[
    ['微光初現',1,'common'],['星光漸明',10,'common'],['流光刻痕',50,'rare'],
    ['百時星軌',100,'rare'],['歲月銘刻',500,'epic'],['千載流光',1000,'legendary']]);
  for(const d of D.DEFINITIONS){assert.equal(d.isPermanent,true);assert.equal(d.isLimited,false);assert.equal(d.limitedType,'none');assert.equal(d.artwork,d.id==='online_time_1h'?'assets/title-common-online-time-1h-v1.webp':'');}
});
test('one account can accumulate five hours in one day without a point-wallet write',async()=>{
  const f=fixture();
  for(let i=0;i<150;i++)await f.service(event(START+i*120000,START+(i+1)*120000));
  assert.equal(f.db.read('playerStats/alice').officialOnlineTimeMs,5*D.HOUR);
  assert.equal(f.db.read('playerStats/alice').totalCheckInDays,20);
  assert.deepEqual(f.awards.map(a=>a.titleId),['online_time_1h']);
  assert.equal(f.db.read('users/alice/titleProgress/online_time_10h').currentValue,300);
  assert(![...f.db.rows.keys()].some(p=>/activity(Point|Daily)/.test(p)));
});
test('same interval with different event IDs and simultaneous delivery counts once',async()=>{
  const f=fixture();
  await Promise.all([f.service(event(START,START+45000,'a')),f.service(event(START,START+45000,'b'))]);
  assert.equal(f.db.read('playerStats/alice').officialOnlineTimeMs,45000);
  assert.equal(f.db.list('onlineTimeTitleReceipts').length,1);
});
test('out-of-order source intervals retain all time, including across midnight',async()=>{
  const f=fixture(),midnight=START+86400000;
  await f.service(event(midnight,midnight+45000));
  await f.service(event(midnight-45000,midnight));
  assert.equal(f.db.read('playerStats/alice').officialOnlineTimeMs,90000);
});
test('creation, deletion, unchanged/reversed and long offline gaps never count',async()=>{
  const f=fixture();
  for(const e of [event(null,START),event(START,null),event(START,START),event(START+1,START),event(START,START+120001)]){
    assert.equal((await f.service(e)).status,'ignored');
  }
  assert.equal(f.db.commits,0);
});
test('activation clips a crossing interval and ignores earlier history',async()=>{
  const f=fixture();
  assert.equal((await f.service(event(START-90000,START-45000))).status,'before-activation');
  await f.service(event(START-30000,START+15000));
  assert.equal(f.db.read('playerStats/alice').officialOnlineTimeMs,15000);
});
test('disabled feature, missing source attestation and ineligible profiles never write',async()=>{
  for(const p of [{active:false},{active:true,isTestAccount:true},{active:true,role:'tester'},
    {active:true,deleted:true},{active:true,accountStatus:'frozen'},{active:true,accountStatus:'disabled'}]){
    const f=fixture({'users/alice':p});await f.service(event(START,START+45000));assert.equal(f.db.commits,0);
  }
  const f=fixture({'systemSettings/onlineTimeTitles':{enabled:false}});
  assert.equal((await f.service(event(START,START+45000))).status,'disabled');assert.equal(f.db.commits,0);
  const g=fixture({'systemSettings/onlineTimeTitles':{enabled:true}});
  await assert.rejects(g.service(event(START,START+45000)),/source-not-verified/);assert.equal(g.db.commits,0);
});
test('thresholds award at exact boundaries and never below them',async()=>{
  for(const d of D.DEFINITIONS){
    const threshold=d.targetValue*D.MINUTE;
    const f=fixture({'playerStats/alice':{officialOnlineTimeMs:threshold-45001}});
    await f.service(event(START,START+45000));assert(!f.held.has(d.id));
    await f.service(event(START+45000,START+45001));assert(f.held.has(d.id));
  }
});
test('failed post-commit award retries without double-counting or duplicate grants',async()=>{
  const f=fixture({'playerStats/alice':{officialOnlineTimeMs:D.HOUR-45000}}),e=event(START,START+45000);
  f.failNextAward();await assert.rejects(f.service(e),/temporary-award-failure/);
  assert.equal(f.db.read('playerStats/alice').officialOnlineTimeMs,D.HOUR);
  await f.service(e);await f.service(e);
  assert.equal(f.db.read('playerStats/alice').officialOnlineTimeMs,D.HOUR);assert.equal(f.awards.length,1);
});
test('feature flags pause awards while time keeps accumulating',async()=>{
  const f=fixture({'systemSettings/engagement':{titlesEnabled:true,automaticTitleAwardsEnabled:false},
    'playerStats/alice':{officialOnlineTimeMs:D.HOUR-45000}}),e=event(START,START+45000);
  await f.service(e);assert.equal(f.awards.length,0);
  f.db.put('systemSettings/engagement',{titlesEnabled:true,automaticTitleAwardsEnabled:true});
  await f.service(e);assert.equal(f.awards.length,1);
});
test('definition drift, corrupt totals and mismatched sources fail before writes',async()=>{
  const d=D.DEFINITIONS[0];
  const f=fixture({['titleDefinitions/'+d.id]:{...d,targetValue:1}});
  await assert.rejects(f.service(event(START,START+45000)),/definition-conflict/);assert.equal(f.db.commits,0);
  for(const value of [NaN,-1,Infinity,Number.MAX_SAFE_INTEGER]){
    const g=fixture({'playerStats/alice':{officialOnlineTimeMs:value}});
    await assert.rejects(g.service(event(START,START+45000)),/invalid-/);assert.equal(g.db.commits,0);
  }
  const g=fixture(),e=event(START,START+45000);e.data.after.ref.path='users/alice';
  await assert.rejects(g.service(e),/source-mismatch/);
});
test('the catalog is text-only and preserves existing earned records',async()=>{
  const f=fixture({'users/alice/earnedTitles/online_time_1h':{status:'revoked',earnedAt:123}});
  f.held.add('online_time_1h');
  await f.service(event(START,START+45000));
  assert.deepEqual(f.db.read('users/alice/earnedTitles/online_time_1h'),{status:'revoked',earnedAt:123});
  assert.equal(f.db.list('titleDefinitions').length,6);assert.equal(f.db.list('publicTitleCatalog').length,6);
});
test('changing activation date cannot silently relabel already-counted history',async()=>{
  const f=fixture();await f.service(event(START,START+45000));
  f.db.put('systemSettings/onlineTimeTitles',{enabled:true,startAt:START+1,sourceSchema:'lastSeenAt-v1'});
  await assert.rejects(f.service(event(START+45000,START+90000)),/activation-changed/);
  assert.equal(f.db.read('playerStats/alice').officialOnlineTimeMs,45000);
});
