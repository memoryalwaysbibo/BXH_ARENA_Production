'use strict';
const {createHash}=require('node:crypto'),B=require('./state.cjs'),{createBucketRuntime}=require('./runtime.cjs'),{publicProjection}=require('./public-view.cjs');
const {advance}=require('../_qr_checkin/qr-checkin-fence.cjs');
const has=(o,k)=>!!o&&Object.prototype.hasOwnProperty.call(o,k);
const ownership=(...docs)=>docs.some(d=>['scoreStorage','scoreBucketProjection','bucketMigration','deletionStatus'].some(k=>has(d,k)));
const playerUid=p=>!p||p.ladderEligible===false||p.familyPlayerId||['family','test'].includes(p.source)||p.participantType==='onsite_guest'?'':String(p.registrationUid||p.accountUid||p.playerUid||p.userUid||p.authUid||p.uid||'').trim();
const validProfile=p=>!!p&&p.active===true&&p.deleted!==true&&!['deleted','disabled','frozen'].includes(p.accountStatus)&&p.role!=='tester'&&p.isTestAccount!==true;
function fail(reason){throw Object.assign(Error(reason),{bucketSettlement:true});}
function stable(x){if(Array.isArray(x))return x.map(stable);if(x&&typeof x==='object')return Object.fromEntries(Object.keys(x).sort().map(k=>[k,stable(x[k])]));return x;}
const digest=x=>createHash('sha256').update(JSON.stringify(stable(x))??'<missing>').digest('hex');
function checkSeason(control,now){
 if(control.status!=='active'||control.rolloverInProgress===true)fail('season-unavailable');
 const ms=v=>v?.toMillis?v.toMillis():Number(v)||0;
 if(ms(control.startAt)&&now<ms(control.startAt))fail('season-not-started');
 if(ms(control.endAt)&&now>ms(control.endAt))fail('season-ended');
}
function identity(s){const t=s.createTime;if(!s.exists||!Number.isSafeInteger(t?.seconds)||!Number.isSafeInteger(t?.nanoseconds))fail('bucket-room-identity-missing');return t.seconds+':'+t.nanoseconds;}
function validateResults(state){
 if(!Array.isArray(state.players)||!Array.isArray(state.matches)||!state.matches.length)fail('bucket-invalid-results');
 const reserved=['__proto__','constructor','prototype'];
 const players=new Set(state.players.map(p=>p.id));if(state.players.some(p=>typeof p.id!=='string'||!p.id||reserved.includes(p.id))||players.size!==state.players.length||players.size<2)fail('bucket-invalid-results');
 const linked=state.players.map(playerUid).filter(Boolean);if(new Set(linked).size!==linked.length)fail('bucket-duplicate-account');
 if(linked.some(id=>!/^[-A-Za-z0-9_]{1,128}$/.test(id)||reserved.includes(id)))fail('bucket-player-identity');
 const matches=new Set();
 for(const m of state.matches){
  if(!m||typeof m.id!=='string'||!m.id||matches.has(m.id))fail('bucket-invalid-results');matches.add(m.id);
  if(!['SE','BZ'].includes(m.bracket)||!Number.isSafeInteger(Number(m.round))||Number(m.round)<0)fail('bucket-invalid-results');
  if(m.isBye){const sides=[m.a?.playerId,m.b?.playerId].filter(Boolean);if(sides.length>1||sides.some(id=>!players.has(id))||m.winnerId!==(sides[0]||null)||m.loserId)fail('bucket-invalid-results');continue;}
  const a=m.a?.playerId,b=m.b?.playerId;
  if(!players.has(a)||!players.has(b)||a===b)fail('bucket-invalid-results');
  if(m.completed!==true)fail('bucket-not-decided');
  if(![a,b].includes(m.winnerId)||m.loserId!==(m.winnerId===a?b:a)||![m.scoreA,m.scoreB].every(n=>Number.isSafeInteger(n)&&n>=0&&n<=6))fail('bucket-invalid-results');
 }
 const se=state.matches.filter(m=>m.bracket==='SE'),max=Math.max(...se.map(m=>Number(m.round))),finals=se.filter(m=>Number(m.round)===max);
 if(!Number.isSafeInteger(max)||max<0||max>8||finals.length!==1||finals[0].isBye)fail('bucket-invalid-results');
 for(let round=0;round<=max;round++){
  const rows=se.filter(m=>Number(m.round)===round),count=2**(max-round);
  if(rows.length!==count||new Set(rows.map(m=>m.indexInRound)).size!==count||rows.some(m=>!Number.isSafeInteger(m.indexInRound)||m.indexInRound<0||m.indexInRound>=count||m.completed!==true))fail('bucket-invalid-results');
  if(round>0)for(const m of rows){const feeders=se.filter(p=>Number(p.round)===round-1&&[m.indexInRound*2,m.indexInRound*2+1].includes(p.indexInRound));const expected=feeders.map(p=>p.winnerId||null).sort();if(digest(expected)!==digest([m.a?.playerId||null,m.b?.playerId||null].sort()))fail('bucket-invalid-results');}
 }
 state.championId=finals[0].winnerId;state.runnerUpId=finals[0].loserId;
 const bronzeRows=state.matches.filter(m=>m.bracket==='BZ');
 if(state.meta.bronzeMatch){
  const bronze=state.matches.find(m=>m.id===state.bronzeMatchId),semis=se.filter(m=>Number(m.round)===max-1);
  if(bronzeRows.length!==1||!bronze||bronze.bracket!=='BZ'||semis.length!==2||new Set(semis.map(m=>m.loserId)).size!==2||![bronze.a.playerId,bronze.b.playerId].every(id=>semis.some(m=>m.loserId===id)))fail('bucket-invalid-results');
  state.thirdId=bronze.winnerId;state.fourthId=bronze.loserId;
 }else {if(bronzeRows.length)fail('bucket-invalid-results');state.thirdId=null;state.fourthId=null;}
 return state;
}
async function load({tx,db,root,pub,observed={},runtime='production',env=process.env}){
 const top=root.data()||{},publicData=pub.data()||{},kind=ownership(top,publicData)?'bucket':'legacy';
 if(observed.kind&&observed.kind!==kind)fail('bucket-mode-changed');observed.kind=kind;
 if(kind==='legacy')return {bucket:false,top};
 if([top,publicData].some(d=>has(d,'bucketMigration')||has(d,'deletionStatus')))fail('bucket-settlement-fenced');
 if(!has(top,'scoreStorage')||!pub.exists)fail('bucket-context');
 if(top.systemClosed||top.eventCancelled||top.testMode||top.createdByRole==='partner_organizer')fail('bucket-room-read-only');
 if((top.qrCheckinManaged===true)!==(publicData.qrCheckinManaged===true)||top.qrCheckinManaged===true&&(!Number.isSafeInteger(top.qrCheckinRevision)||top.qrCheckinRevision<1||publicData.qrCheckinRevision!==top.qrCheckinRevision))fail('bucket-qr-mirror-stale');
 let base;try{base=JSON.parse(top.data);}catch{fail('bucket-corrupt');}
 if(top.eventAuthority!=='official'||base.meta?.eventAuthority!=='official'||base.meta?.formatType!=='single'||!['standard',undefined].includes(base.meta?.scoringMode)||!['standard',undefined].includes(base.meta?.playMode)||!['individual',undefined].includes(base.meta?.battleMode)||top.refereeSeatsV1?.version!==1)fail('bucket-unsupported-room');
 if(top.ladderMode!=='ranked'||base.meta.ladderMode!=='ranked')fail('bucket-not-ranked');
 let m,gate;try{m=B.context(top,base);gate=createBucketRuntime(db,{runtime,env});}catch(e){fail(e.message);}
 if(m.courtCount>32||m.code!==root.id||base.cloudCode!==root.id)fail('bucket-context');
 const sourceCreatedAt=identity(root),binding=digest({epoch:m.epoch,sourceCreatedAt});
 if(observed.binding&&observed.binding!==binding)fail('bucket-room-changed');observed.binding=binding;
 const config=await tx.get(db.doc('systemConfig/fourCourtScoreBuckets'));
 if(config.data()?.settlementEnabled!==true)fail('bucket-settlement-disabled');
 try{gate.assertRoom(config.data(),m);}catch(e){fail(e.message);}
 const refs=Array.from({length:m.bucketCount},(_,i)=>root.ref.collection('matchBuckets').doc('court-'+(i+1))),snaps=await Promise.all(refs.map(r=>tx.get(r)));
 const rootTime=root.createTime;
 if(snaps.some(s=>s.exists&&(!s.createTime||s.createTime.seconds<rootTime.seconds||s.createTime.seconds===rootTime.seconds&&s.createTime.nanoseconds<rootTime.nanoseconds)))fail('bucket-room-changed');
 if(Buffer.byteLength(JSON.stringify([top,publicData,...snaps.map(s=>s.data())]))>5000000)fail('bucket-read-size-budget');
 let state;try{state=B.materialize(base,m,snaps.map(s=>s.exists?s.data():null));}catch(e){fail(e.message);}
 for(const match of state.matches){const old=base.matches.find(x=>x.id===match.id);if(!old||['bracket','round','indexInRound','seq'].some(k=>old[k]!==match[k])||!!old.isBye!==!!match.isBye)fail('bucket-structure-stale');}
 const versions=Object.fromEntries(snaps.map((s,i)=>[refs[i].id,s.data().revision]));
 const oldVector=publicData.scoreBucketProjection;
 if(!oldVector||oldVector.epoch!==m.epoch||!oldVector.versions||Object.keys(oldVector.versions).length!==m.bucketCount||Object.entries(versions).some(([k,v])=>!Number.isSafeInteger(oldVector.versions[k])||oldVector.versions[k]<0||oldVector.versions[k]>v))fail('bucket-public-context');
 validateResults(state);
 const fingerprint=digest(state),receipt=top.bucketSettlement;
 if(has(top,'bucketSettlement')||top.ladderPointsAwarded===true||state.ladderPointsAwarded===true){
  if(receipt?.version!==1||receipt.status!=='completed'||receipt.sourceCreatedAt!==sourceCreatedAt||receipt.epoch!==m.epoch||digest(receipt.versions)!==digest(versions)||receipt.stateDigest!==fingerprint||top.ladderPointsAwarded!==true||state.ladderPointsAwarded!==true||top.archiveStatus!=='completed'||state.archiveStatus!=='completed'||top.ladderSeasonId!==state.ladderSeasonId||!Array.isArray(top.ladderResults)||top.ladderResults.length<2||digest(top.ladderResults)!==digest(state.ladderResults)||!Array.isArray(top.ladderSkippedPlayers)||digest(top.ladderSkippedPlayers)!==digest(state.ladderSkippedPlayers))fail('bucket-settlement-requires-review');
 }
 return {bucket:true,top,state,m,versions,sourceCreatedAt,fingerprint,previous:publicData.bracketView,publicDocument:publicData,alreadyAwarded:!!receipt};
}
function finalPatches(input,state,{now,seasonId,results,skipped,actorUid}){
 const completed=JSON.parse(JSON.stringify(state));
 Object.assign(completed,{archiveStatus:'completed',settlementRoute:'official-ranked',settlementPhase:'completed',settlementCompletedAt:now,settlementError:null,settlementErrorCode:null,completedAt:completed.completedAt||now,archivedAt:completed.archivedAt||now,ladderPointsAwarded:true,ladderSeasonId:seasonId,ladderAwardedAt:now,ladderResults:results,ladderSkippedPlayers:skipped,updatedAt:now});
 // Predict the exact existing QR proxy transform before sealing the digest.
 // Its second application uses the same original revision and is idempotent.
 let qr={};if(input.top.qrCheckinManaged===true){completed.qrCheckinManaged=true;try{qr=advance(input.top,completed,input.top.qrCheckinRevision);}catch(e){fail(e.message);}}
 let previous;try{previous=JSON.parse(input.previous);}catch{fail('bucket-public-corrupt');}
 if(!previous||typeof previous!=='object'||Array.isArray(previous))fail('bucket-public-corrupt');
 const view=publicProjection(completed,previous);Object.assign(view,{archiveStatus:'completed',completedAt:completed.completedAt,archivedAt:completed.archivedAt,ladderPointsAwarded:true,settlementPhase:'completed'});
 if(input.top.qrCheckinManaged===true)view.players=completed.players.map(p=>({id:p.id,name:p.name||'',checkedIn:p.checkedIn===true}));
 const certificate={version:1,status:'completed',epoch:input.m.epoch,versions:input.versions,sourceCreatedAt:input.sourceCreatedAt,stateDigest:digest(completed),completedAt:now,actorUid};
 const privatePatch={...qr,data:JSON.stringify(completed),archiveStatus:'completed',tournamentPhase:'done',updatedAt:now,bucketSettlement:certificate};
 const publicPatch={...qr,bracketView:JSON.stringify(view),archiveStatus:'completed',tournamentPhase:'done',updatedAt:now,scoreBucketProjection:{epoch:input.m.epoch,versions:input.versions},bucketSettlement:{version:1,status:'completed',epoch:input.m.epoch,versions:input.versions,completedAt:now}};
 if([{...input.top,...privatePatch,ladderResults:results,ladderSkippedPlayers:skipped},{...input.publicDocument,...publicPatch}].some(x=>Buffer.byteLength(JSON.stringify(x))>750000))fail('bucket-settlement-size-budget');
 return {privatePatch,publicPatch};
}
module.exports={ownership,load,finalPatches,identity,digest,validateResults,fail,playerUid,validProfile,checkSeason};
