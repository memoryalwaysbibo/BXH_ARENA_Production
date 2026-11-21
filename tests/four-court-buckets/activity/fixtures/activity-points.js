"use strict";
const {onCall,HttpsError}=require("firebase-functions/v2/https");
const {onSchedule}=require("firebase-functions/v2/scheduler");
const {onDocumentWritten}=require("firebase-functions/v2/firestore");
const {getFirestore,FieldValue}=require("firebase-admin/firestore");
const {backgroundJobsEnabled}=require("./release-controls");
const db=getFirestore(),REGION="asia-east1",DAY=86400000,OFFSET=8*3600000;
const PRODUCTION_ACTIVITY_LAUNCH_DATE="2026-09-19";
const ACTIVITY_RULESET_V2_EFFECTIVE_AT=Date.parse("2026-09-28T02:15:00+08:00");
const ONLINE_UNIT_MS=30*60*1000,ONLINE_SESSION_GAP_MS=120000,ONLINE_DAILY_UNITS=6;
const dayKey=(ms=Date.now())=>new Date(ms+OFFSET).toISOString().slice(0,10);
const dayStart=key=>Date.parse(key+"T00:00:00Z")-OFFSET;
const accountActive=p=>p&&p.active===true&&p.deleted!==true;
const isTest=p=>!!p&&(p.role==="tester"||p.isTestAccount===true);
// Production official points exclude tester/test accounts.
const active=p=>accountActive(p)&&!isTest(p);
const millis=v=>v&&typeof v.toMillis==="function"?v.toMillis():Number(v||0);
const safe=s=>String(s||"").replace(/[^A-Za-z0-9_-]/g,"_").slice(0,160);

async function grant(uid,{id,delta,source,label,occurredAt=Date.now(),daily=true,cap=null,metadata={}}){
 const entry=db.doc(`activityPointLedgers/${uid}/entries/${safe(id)}`),wallet=db.doc(`activityPointWallets/${uid}`),date=dayKey(occurredAt),dailyRef=db.doc(`activityDaily/${date}/players/${uid}`);
 return db.runTransaction(async tx=>{
  const [seen,w,d]=await Promise.all([tx.get(entry),tx.get(wallet),tx.get(dailyRef)]);if(seen.exists)return {awarded:0,duplicate:true};
  const old=w.data()||{},today=d.data()||{};let applied=Number(delta||0);
  if(applied>0&&cap!=null)applied=Math.max(0,Math.min(applied,Number(cap)-Number((today.bySource||{})[source]||0)));
  if(applied<0)applied=-Math.min(Number(old.balance||0),Math.abs(applied));
  const balance=Math.max(0,Number(old.balance||0)+applied),now=Date.now();
  tx.create(entry,{uid,source,label,delta:applied,occurredAt,createdAt:FieldValue.serverTimestamp(),dateKey:date,balanceAfter:balance,metadata});
  if(applied!==0){
   const patch={uid,balance,lifetimeEarned:Number(old.lifetimeEarned||0)+Math.max(0,applied),lifetimeDeducted:Number(old.lifetimeDeducted||0)+Math.max(0,-applied),updatedAt:now,reachedBalanceAt:now};
   tx.set(wallet,patch,{merge:true});
   if(daily){const by=Object.assign({},today.bySource||{});by[source]=Number(by[source]||0)+applied;tx.set(dailyRef,{uid,dateKey:date,net:Number(today.net||0)+applied,earned:Number(today.earned||0)+Math.max(0,applied),deducted:Number(today.deducted||0)+Math.max(0,-applied),bySource:by,reachedNetAt:now,updatedAt:now},{merge:true});}
  }
  return {awarded:applied,balance};
 });
}
async function profile(uid){const s=await db.doc(`users/${uid}`).get();if(!active(s.data()))throw new HttpsError("permission-denied","account-inactive");return s.data();}
function tournamentState(t){try{return typeof t?.data==="string"?JSON.parse(t.data):t?.data||{};}catch{return {};}}
function participantAccountUid(p){
 if(!p)return "";
 return String(p.guardianUid||p.registrationUid||p.accountUid||p.uid||"").trim();
}
function completedTournamentEligible(t,s){
 if(!t||!s||s.archiveStatus!=="completed")return false;
 if(t.testMode||s.testMode||t.eventAuthority==="test"||t.createdByRole==="tester")return false;
 if(t.systemClosed||t.eventCancelled||s.meta?.eventCancelled||t.tournamentPhase==="cancelled"||(s.systemClosure&&!s.systemClosure.restoredAt))return false;
 const players=Array.isArray(s.players)?s.players:[],ids=new Set(players.map(p=>String(p?.id||"")).filter(Boolean));
 const matches=(Array.isArray(s.matches)?s.matches:[]).filter(m=>m&&!m.isBye);
 if(players.length<2||!matches.length||matches.some(m=>!m.completed))return false;
 return matches.some(m=>{
  const a=String(m.a?.playerId||""),b=String(m.b?.playerId||""),w=String(m.winnerId||"");
  return a&&b&&a!==b&&ids.has(a)&&ids.has(b)&&(w===a||w===b)&&!m.forfeit&&!m.walkover&&!m.disqualified;
 });
}
async function processCompletedTournament(code,t){
 const s=tournamentState(t);
 if(!completedTournamentEligible(t,s))return {ok:false,reason:"ineligible"};
 const players=Array.isArray(s.players)?s.players:[],byId=new Map(players.map(p=>[String(p.id||""),p]));
 const matches=(Array.isArray(s.matches)?s.matches:[]).filter(m=>m&&!m.isBye&&m.completed);
 const profileCache=new Map();
 async function eligibleUid(uid){
  if(!uid||uid.includes("/"))return false;
  if(profileCache.has(uid))return profileCache.get(uid);
  const snap=await db.doc(`users/${uid}`).get(),ok=active(snap.data());
  profileCache.set(uid,ok);return ok;
 }
 const completedAt=millis(s.completedAt)||millis(t.completedAt)||millis(t.ladderAwardedAt)||0;
 const useV2=completedAt>=ACTIVITY_RULESET_V2_EFFECTIVE_AT;
 let matchAwards=0,tournamentAwards=0,hostAwards=0;
 if(useV2){
  const participantUids=new Set();
  for(const m of matches){
   const a=String(m.a?.playerId||""),b=String(m.b?.playerId||""),w=String(m.winnerId||"");
   if(!a||!b||a===b||(w!==a&&w!==b)||m.forfeit||m.walkover||m.disqualified)continue;
   for(const uid of [participantAccountUid(byId.get(a)),participantAccountUid(byId.get(b))])if(uid)participantUids.add(uid);
  }
  for(const uid of participantUids){
   if(!(await eligibleUid(uid)))continue;
   const r=await grant(uid,{
    id:`tournament_${code}_${uid}`,delta:10,source:"tournament_completed",label:"完成賽事",
    occurredAt:completedAt||Date.now(),metadata:{tournamentCode:code,ruleset:"v2"}
   });
   tournamentAwards+=Math.max(0,Number(r?.awarded||0));
  }
 }else{
  for(const m of matches){
   const a=String(m.a?.playerId||""),b=String(m.b?.playerId||""),w=String(m.winnerId||"");
   if(!a||!b||a===b||(w!==a&&w!==b)||m.forfeit||m.walkover||m.disqualified)continue;
   const uids=new Set([participantAccountUid(byId.get(a)),participantAccountUid(byId.get(b))].filter(Boolean));
   for(const uid of uids){
    if(!(await eligibleUid(uid)))continue;
    const r=await grant(uid,{
     id:`match_${code}_${m.id||safe(a+"_"+b)}_${uid}`,
     delta:3,source:"match_completed",label:"完成真實對戰",
     occurredAt:Number(m.completedAt||s.completedAt||Date.now()),cap:30,
     metadata:{tournamentCode:code,matchId:String(m.id||""),playerIds:[a,b],ruleset:"legacy"}
    });
    matchAwards+=Math.max(0,Number(r?.awarded||0));
   }
  }
 }
 const hostUid=String(t.createdBy||t.ownerUid||"").trim();
 if(hostUid&&await eligibleUid(hostUid)){
  const r=await grant(hostUid,{
   id:`host_${code}_${hostUid}`,delta:10,source:"host_completed",label:"我是房主",
   occurredAt:completedAt||Date.now(),cap:useV2?null:30,metadata:{tournamentCode:code,ruleset:useV2?"v2":"legacy"}
  });
  hostAwards+=Math.max(0,Number(r?.awarded||0));
 }
 return {ok:true,ruleset:useV2?"v2":"legacy",matchAwards,tournamentAwards,hostAwards};
}

async function reconcile(uid,p){
 const now=Date.now(),today=dayKey(now),wallet=db.doc(`activityPointWallets/${uid}`);
 await wallet.set({uid,playerId:String(p.playerId||p.gameId||""),displayName:String(p.nickname||p.displayName||p.realName||"玩家").slice(0,40),testAccount:isTest(p),isTestData:isTest(p),updatedAt:now},{merge:true});
 if(!active(p))return;
 const ladder=await db.doc(`ladderPlayers/${uid}`).get(),career=Math.max(0,Number(ladder.data()?.careerPoints||0));
 if(career)await grant(uid,{id:"ladder_migration_v1",delta:career,source:"ladder_migration",label:"既有天梯積分補發",daily:false,metadata:{ratio:"1:1",careerPoints:career}});
 if((await db.doc(`users/${uid}/dailyCheckIns/${today}`).get()).exists){
  await grant(uid,{id:`checkin_${today}`,delta:15,source:"daily_checkin",label:"每日簽到",cap:15});
  await grant(uid,{id:`cumulative_checkin_${today}`,delta:5,source:"cumulative_checkin",label:"累積簽到",cap:5});
 }
 const start=dayStart(today),messages=await db.collection("moodStationMessages").where("createdAt",">=",start).get();
 const own=messages.docs.filter(x=>x.data().ownerUid===uid).sort((a,b)=>Number(a.data().createdAt)-Number(b.data().createdAt)).slice(0,3);
 for(const m of own)await grant(uid,{id:`mood_${m.id}`,delta:5,source:"mood_message",label:"心情小棧留言",occurredAt:Number(m.data().createdAt||now),cap:15,metadata:{messageId:m.id}});
}
async function snapshot(uid){
 const [w,e]=await Promise.all([db.doc(`activityPointWallets/${uid}`).get(),db.collection(`activityPointLedgers/${uid}/entries`).orderBy("occurredAt","desc").limit(100).get()]);
 const today=dayKey(),d=await db.doc(`activityDaily/${today}/players/${uid}`).get(),v=w.data()||{},dv=d.data()||{};
 return {wallet:v,today:{net:Number(dv.net||0),bySource:dv.bySource||{}},records:e.docs.map(x=>Object.assign({id:x.id},x.data()))};
}
exports.activityPoints=onCall({region:REGION,cors:true,maxInstances:5},async req=>{
 if(process.env.GCLOUD_PROJECT!=="bxh-arena")throw new HttpsError("failed-precondition","production-only");
 const uid=req.auth?.uid;if(!uid)throw new HttpsError("unauthenticated","login-required");const p=await profile(uid),action=req.data?.action||"snapshot";
 if(action==="snapshot"){await reconcile(uid,p);return Object.assign({ok:true},await snapshot(uid));}
 if(action==="leaderboard"){
  const mode=req.data?.mode==="daily"?"daily":"cumulative",today=dayKey();let docs;
  if(mode==="daily")docs=(await db.collection(`activityDaily/${today}/players`).limit(500).get()).docs.map(x=>x.data()).filter(x=>Number(x.net||0)>0).map(x=>({uid:x.uid,points:Number(x.net||0),reachedAt:Number(x.reachedNetAt||0)}));
  else docs=(await db.collection("activityPointWallets").limit(500).get()).docs.map(x=>x.data()).filter(x=>!x.testAccount&&x.isTestData!==true&&Number(x.balance||0)>0).map(x=>({uid:x.uid,playerId:x.playerId||"",name:x.displayName||"玩家",points:Number(x.balance||0),reachedAt:Number(x.reachedBalanceAt||0)}));
  docs.sort((a,b)=>b.points-a.points||a.reachedAt-b.reachedAt||String(a.playerId||a.uid).localeCompare(String(b.playerId||b.uid)));
  if(mode==="daily")for(const row of docs.slice(0,100)){const w=(await db.doc(`activityPointWallets/${row.uid}`).get()).data()||{};row.playerId=w.playerId||"";row.name=w.displayName||"玩家";}
  return {ok:true,mode,dateKey:today,rows:docs.slice(0,100)};
 }
 throw new HttpsError("invalid-argument","invalid-action");
});

exports.activityInactivityPenalty=onSchedule({schedule:"10 0 * * *",timeZone:"Asia/Taipei",region:REGION},async()=>{
 if(process.env.GCLOUD_PROJECT!=="bxh-arena"||!(await backgroundJobsEnabled()))return;
 const today=dayKey(),wallets=await db.collection("activityPointWallets").where("balance",">",0).limit(500).get();
 for(const doc of wallets.docs){
  const uid=doc.id,p=await db.doc(`users/${uid}`).get(),profileData=p.data();if(!active(profileData))continue;
  const stats=(await db.doc(`playerStats/${uid}`).get()).data()||{};
  const createdMs=millis(profileData.createdAt),createdKey=createdMs>0?dayKey(createdMs):PRODUCTION_ACTIVITY_LAUNCH_DATE;
  const baseline=createdKey>PRODUCTION_ACTIVITY_LAUNCH_DATE?createdKey:PRODUCTION_ACTIVITY_LAUNCH_DATE;
  const last=String(stats.lastCheckInDate||baseline);
  const missed=Math.max(0,Math.floor((dayStart(today)-dayStart(last))/DAY));if(missed<3)continue;
  const amount=missed<=7?5:missed<=14?10:missed<=21?20:missed<=28?30:50;
  await grant(uid,{id:`inactivity_${today}`,delta:-amount,source:"inactivity_penalty",label:`連續未簽到第${missed}天`,occurredAt:Date.now(),daily:true,metadata:{missedDays:missed}});
 }
});



async function processOnlinePresence(uid,seenAt){
 if(!uid||!Number.isFinite(seenAt)||seenAt<=0)return {ok:false,reason:"invalid-presence"};
 const user=(await db.doc(`users/${uid}`).get()).data();
 if(!active(user))return {ok:false,reason:"ineligible"};
 const date=dayKey(seenAt),tracker=db.doc(`activityOnlineDaily/${date}/players/${uid}`);
 const progress=await db.runTransaction(async tx=>{
  const snap=await tx.get(tracker),old=snap.data()||{},last=Number(old.lastSeenAt||0);
  if(seenAt<=last)return {activeMs:Number(old.activeMs||0),targetUnits:Number(old.targetUnits||0),awardedUnits:Number(old.awardedUnits||0),stale:true};
  const gap=last>0&&dayKey(last)===date?seenAt-last:0;
  const delta=gap>0&&gap<=ONLINE_SESSION_GAP_MS?gap:0;
  const activeMs=Math.min(ONLINE_UNIT_MS*ONLINE_DAILY_UNITS,Math.max(0,Number(old.activeMs||0))+delta);
  const targetUnits=Math.min(ONLINE_DAILY_UNITS,Math.floor(activeMs/ONLINE_UNIT_MS));
  const awardedUnits=Math.min(ONLINE_DAILY_UNITS,Math.max(0,Number(old.awardedUnits||0)));
  tx.set(tracker,{uid,dateKey:date,lastSeenAt:seenAt,activeMs,targetUnits,awardedUnits,updatedAt:Date.now()},{merge:true});
  return {activeMs,targetUnits,awardedUnits,stale:false};
 });
 if(progress.targetUnits<=progress.awardedUnits)return {ok:true,...progress};
 let confirmed=progress.awardedUnits;
 for(let unit=progress.awardedUnits+1;unit<=progress.targetUnits;unit++){
  await grant(uid,{
   id:`online_${date}_${unit}`,delta:5,source:"online_time",label:"在線時間",
   occurredAt:seenAt,cap:30,metadata:{dateKey:date,unit,minutes:unit*30}
  });
  confirmed=unit;
 }
 if(confirmed>progress.awardedUnits)await db.runTransaction(async tx=>{
  const snap=await tx.get(tracker),current=Math.max(0,Number(snap.data()?.awardedUnits||0));
  if(confirmed>current)tx.set(tracker,{awardedUnits:confirmed,updatedAt:Date.now()},{merge:true});
 });
 return {ok:true,...progress,awardedUnits:confirmed};
}

exports.activityOnlinePresenceWritten=onDocumentWritten(
 {document:"onlinePresence/{uid}",region:REGION},
 async event=>{
  const after=event.data?.after;
  if(!after?.exists)return;
  const seenAt=Number(after.data()?.lastSeenAt||0);
  try{await processOnlinePresence(event.params.uid,seenAt);}
  catch(e){console.error("activity-online-time-award-failed",event.params.uid,e);throw e;}
 }
);

exports.activityTournamentCompleted=onDocumentWritten(
 {document:"tournaments/{code}",region:REGION,retry:true},
 async event=>{
  const after=event.data?.after;
  if(!after?.exists)return;
  const t=after.data(),s=tournamentState(t);
  if(s.archiveStatus!=="completed"&&t.archiveStatus!=="completed")return;
  try{await processCompletedTournament(event.params.code,t);}catch(e){console.error("activity-tournament-award-failed",event.params.code,e);}
 }
);

// Self-healing backfill for completed events that finished before this trigger
// was deployed. Ledger IDs make repeated scans idempotent.
exports.activityCompletedTournamentBackfill=onSchedule(
 {schedule:"every 60 minutes",timeZone:"Asia/Taipei",region:REGION,timeoutSeconds:540,maxInstances:1},
 async()=>{
  if(process.env.GCLOUD_PROJECT!=="bxh-arena")return;
  const snap=await db.collection("tournaments").where("archiveStatus","==","completed").limit(500).get();
  for(const doc of snap.docs){
   try{await processCompletedTournament(doc.id,doc.data());}
   catch(e){console.error("activity-backfill-failed",doc.id,e);}
  }
 }
);

exports._activityTest={dayKey,dayStart,active,accountActive,isTest,tournamentState,participantAccountUid,completedTournamentEligible,processOnlinePresence,ACTIVITY_RULESET_V2_EFFECTIVE_AT};
