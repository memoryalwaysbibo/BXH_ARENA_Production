'use strict';
const assert=require('node:assert/strict');
if(!process.env.FIRESTORE_EMULATOR_HOST)throw Error('emulator-host-required');
const projectId=process.env.GCLOUD_PROJECT;
if(!projectId?.startsWith('demo-'))throw Error('demo-project-required');
const {initializeApp,deleteApp}=require('firebase-admin/app');
const {getFirestore,FieldValue}=require('firebase-admin/firestore');
const app=initializeApp({projectId}),db=getFirestore(app);
const {createService}=require('../service.cjs'),D=require('../domain.cjs');
const START=1800000000000;
if(!process.env.LIVE_AWARD_SOURCE)throw Error('captured-native-award-source-required');
const native=require('./native-award.cjs').fromCapturedSource(require('node:fs').readFileSync(process.env.LIVE_AWARD_SOURCE,'utf8'),db,FieldValue);
const result=[];let fail=false;
const service=createService(db,{clock:()=>START+90000000,awardTitle:async a=>{
  if(fail){fail=false;throw Error('injected-award-failure');}
  const r=await native(a);if(r.awarded)result.push(a);return r;
}});
function event(uid,a,b){const snap=t=>({exists:true,ref:db.doc('onlinePresence/'+uid),data:()=>({lastSeenAt:t})});return {params:{uid},data:{before:snap(a),after:snap(b)}};}
async function setup(uid,total=0){await db.doc('users/'+uid).set({active:true,role:'player'});await db.doc('playerStats/'+uid).set({officialOnlineTimeMs:total,totalCheckInDays:19});}
async function total(uid){return (await db.doc('playerStats/'+uid).get()).data().officialOnlineTimeMs;}
(async()=>{
  await db.doc('systemSettings/onlineTimeTitles').set({enabled:true,startAt:START,sourceSchema:'lastSeenAt-v1'});
  await db.doc('systemSettings/engagement').set({titlesEnabled:true,automaticTitleAwardsEnabled:true});
  await setup('fivehours');
  for(let i=0;i<150;i++)await service(event('fivehours',START+i*120000,START+(i+1)*120000));
  assert.equal(await total('fivehours'),5*D.HOUR);
  assert.equal((await db.doc('playerStats/fivehours').get()).data().totalCheckInDays,19);
  assert.equal((await db.doc('users/fivehours/titleProgress/online_time_10h').get()).data().currentValue,300);
  assert.equal((await db.collection('titleDefinitions').get()).size,6);
  assert.equal((await db.collection('activityPointWallets').get()).size,0);
  await setup('race');
  const e=event('race',START,START+45000);
  await Promise.all([service(e),service(e)]);
  assert.equal(await total('race'),45000);
  await setup('retry',D.HOUR-45000);fail=true;
  const f=event('retry',START,START+45000);
  await assert.rejects(service(f),/injected-award-failure/);await service(f);await service(f);
  assert.equal(await total('retry'),D.HOUR);
  assert.equal(result.filter(x=>x.uid==='retry').length,1);
  assert.equal((await db.collection('users/retry/earnedTitles').get()).size,1);
  assert.equal((await db.doc('titleDefinitions/online_time_1h').get()).data().recipientCount,2);
  await setup('midnight');const midnight=START+86400000;
  await service(event('midnight',midnight,midnight+45000));
  await service(event('midnight',midnight-45000,midnight));
  assert.equal(await total('midnight'),90000);
  const {createBackfill}=require('../backfill.cjs');
  const cutover=Date.parse('2026-11-01T00:00:00+08:00');
  await db.doc('systemSettings/onlineTimeTitles').set({enabled:true,startAt:cutover,sourceSchema:'lastSeenAt-v1',
    migrationStrategy:'C-once-v1',backfillEnabled:true,backfillBatchId:'emulator-once',historyStartDate:'2026-10-30'});
  await setup('migration');
  await db.doc('activityOnlineDaily/2026-10-30/players/migration').set({uid:'migration',dateKey:'2026-10-30',activeMs:3*D.HOUR});
  const migrate=createBackfill(db,{awardTitle:native,clock:()=>cutover+100000});
  const preview=await migrate('migration',{dryRun:true});
  assert.equal(preview.historicalMs,3*D.HOUR);
  assert.equal(await total('migration'),0);
  assert.equal((await db.doc('onlineTimeTitleBackfills/migration').get()).exists,false);
  await Promise.all([migrate('migration'),migrate('migration'),service(event('migration',cutover-30000,cutover+30000))]);
  assert.equal(await total('migration'),3*D.HOUR+30000);
  assert.equal((await db.doc('onlineTimeTitleBackfills/migration').get()).data().missingDays,1);
  await migrate('migration');
  assert.equal(await total('migration'),3*D.HOUR+30000);
  assert.equal((await db.collection('users/migration/earnedTitles').get()).size,1);
  console.log('PASS real Firestore: uncapped time, native grants, retry, cross-day and C backfill/live concurrency');
})().finally(async()=>{await db.terminate();await deleteApp(app);}).catch(e=>{console.error(e);process.exitCode=1;});
