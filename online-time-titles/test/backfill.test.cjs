'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const D=require('../domain.cjs'),{createBackfill,plan}=require('../backfill.cjs'),{createService}=require('../service.cjs');
const {MockDB}=require('../../referee-certificates/test/mock-db.cjs');
const T=Date.parse('2026-11-01T00:00:00+08:00');
const CONFIG={migrationStrategy:'C-once-v1',sourceSchema:'lastSeenAt-v1',startAt:T,
  backfillEnabled:true,backfillBatchId:'test-cutover',historyStartDate:'2026-10-29',enabled:true};
function fixture(extra={}){
  const db=new MockDB({'users/alice':{active:true},'systemSettings/onlineTimeTitles':CONFIG,
    'systemSettings/engagement':{titlesEnabled:true,automaticTitleAwardsEnabled:true},
    'playerStats/alice':{totalCheckInDays:20},
    'activityOnlineDaily/2026-10-29/players/alice':{uid:'alice',dateKey:'2026-10-29',activeMs:3*D.HOUR},
    'activityOnlineDaily/2026-10-30/players/alice':{uid:'alice',dateKey:'2026-10-30',activeMs:45*D.MINUTE},
    // The live day must never be included in the historical portion.
    'activityOnlineDaily/2026-11-01/players/alice':{uid:'alice',dateKey:'2026-11-01',activeMs:3*D.HOUR},...extra});
  const original=db.runTransaction.bind(db);
  db.runTransaction=fn=>original(tx=>fn({...tx,set(ref,value,options){tx.set(ref,options?.merge?{...(db.read(ref.path)||{}),...value}:value);}}));
  const grants=[],held=new Set();let fail=false;
  const awardTitle=async ({titleId})=>{if(fail){fail=false;throw Error('retry-award');}if(held.has(titleId))return {reason:'already-earned'};held.add(titleId);grants.push(titleId);return {awarded:true};};
  return {db,grants,awardTitle,run:createBackfill(db,{awardTitle,clock:()=>T+1000}),fail(){fail=true;}};
}
function event(from,to){const snap=t=>({exists:true,ref:{path:'onlinePresence/alice'},data:()=>({lastSeenAt:t})});return {params:{uid:'alice'},data:{before:snap(from),after:snap(to)}};}
test('C credits exact historical active time once and audits missing days without using point balances',async()=>{
  const f=fixture();const r=await f.run('alice');
  assert.equal(r.historicalMs,225*D.MINUTE);assert.equal(r.missingDays,1);
  assert.equal(f.db.read('playerStats/alice').totalCheckInDays,20);
  assert.equal(f.db.read('users/alice/titleProgress/online_time_10h').currentValue,225);
  assert.equal(f.db.read('onlineTimeTitleBackfills/alice').evidence.length,3);
  await f.run('alice');assert.equal(f.db.read('playerStats/alice').officialOnlineTimeMs,225*D.MINUTE);
  assert.deepEqual(f.grants,['online_time_1h']);
});
test('concurrent migration and live heartbeat preserve both disjoint portions exactly once',async()=>{
  const f=fixture(),live=createService(f.db,{awardTitle:f.awardTitle,clock:()=>T+1000});
  await Promise.all([f.run('alice'),f.run('alice'),live(event(T-30000,T+30000))]);
  assert.equal(f.db.read('playerStats/alice').officialOnlineTimeMs,225*D.MINUTE+30000);
  assert.equal(f.db.read('playerStats/alice').onlineTimeHistoricalMs,225*D.MINUTE);
  await live(event(T-30000,T+30000));await f.run('alice');
  assert.equal(f.db.read('playerStats/alice').officialOnlineTimeMs,225*D.MINUTE+30000);
});
test('native award failure after backfill commit retries without adding historical hours twice',async()=>{
  const f=fixture();f.fail();await assert.rejects(f.run('alice'),/retry-award/);
  await f.run('alice');await f.run('alice');
  assert.equal(f.db.read('playerStats/alice').officialOnlineTimeMs,225*D.MINUTE);assert.equal(f.grants.length,1);
});
test('changing batch or history window cannot run a second migration',async()=>{
  for(const change of [{backfillBatchId:'second'},{historyStartDate:'2026-10-28'}]){
    const f=fixture();await f.run('alice');f.db.put('systemSettings/onlineTimeTitles',{...CONFIG,...change});
    await assert.rejects(f.run('alice'),/different-plan/);
    assert.equal(f.db.read('playerStats/alice').officialOnlineTimeMs,225*D.MINUTE);
  }
});
test('invalid source, corrupt counters, marker drift and ineligible users cannot write a backfill',async()=>{
  for(const row of [{uid:'bob',dateKey:'2026-10-29',activeMs:1},{uid:'alice',dateKey:'2026-10-29',activeMs:3*D.HOUR+1},{uid:'alice',dateKey:'2026-10-29',activeMs:-1}]){
    const f=fixture({'activityOnlineDaily/2026-10-29/players/alice':row});await assert.rejects(f.run('alice'));assert.equal(f.db.commits,0);
  }
  const f=fixture({'playerStats/alice':{onlineTimeHistoricalMs:1}});await assert.rejects(f.run('alice'),/marker-without-receipt/);
  const g=fixture({'users/alice':{active:false}});assert.equal((await g.run('alice')).status,'ineligible');assert.equal(g.db.commits,0);
});
test('cutover requires an explicit reached Taipei midnight and bounded valid history dates',()=>{
  for(const change of [{startAt:T+1},{startAt:T+86400000},{historyStartDate:'2026-02-30'},{historyStartDate:'2026-11-01'},{historyStartDate:'2020-01-01'},{backfillEnabled:false},{migrationStrategy:'B'}])assert.throws(()=>plan({...CONFIG,...change},T+1000));
  assert.deepEqual(plan(CONFIG,T+1000).dates,['2026-10-29','2026-10-30','2026-10-31']);
});
