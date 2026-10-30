'use strict';
const {createHash}=require('node:crypto');
const D=require('./domain.cjs');
const {grantEligible}=require('./service.cjs');
const DAY=86400000,OFFSET=8*D.HOUR,MAX_DAYS=366;
const RECEIPTS='onlineTimeTitleBackfills';
function dateMs(value){
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))throw Error('invalid-history-date');
  const n=Date.parse(value+'T00:00:00+08:00');
  if(!Number.isSafeInteger(n)||new Date(n+OFFSET).toISOString().slice(0,10)!==value)throw Error('invalid-history-date');
  return n;
}
function plan(config,now,{dryRun=false}={}){
  if(!config||(!dryRun&&config.backfillEnabled!==true))throw Error('historical-backfill-disabled');
  if(config.migrationStrategy!=='C-once-v1'||config.sourceSchema!=='lastSeenAt-v1')throw Error('invalid-migration-strategy');
  if(typeof config.backfillBatchId!=='string'||! /^[A-Za-z0-9_-]{1,80}$/.test(config.backfillBatchId))throw Error('invalid-backfill-batch');
  const liveStartAt=D.integer(config.startAt,'live-start');
  const cutover=D.integer(config.historyCutoffAt??config.startAt,'cutover');
  if(liveStartAt<cutover)throw Error('live-start-before-history-cutoff');
  if(cutover<=0||(!dryRun&&cutover>now))throw Error('cutover-not-reached');
  const start=dateMs(config.historyStartDate),count=Math.ceil((cutover-start)/DAY);
  if(!Number.isInteger(count)||count<1||count>MAX_DAYS)throw Error('invalid-history-window');
  const partial=(cutover+OFFSET)%DAY!==0;
  // A day's current tracker is mutable after 23:00. Never use it as evidence
  // for the partial day; require an immutable server-side cutoff checkpoint.
  if(partial&&config.cutoverEvidenceSchema!=='frozen-daily-v1')throw Error('partial-day-checkpoint-required');
  return {cutover,liveStartAt,partial,batchId:config.backfillBatchId,dates:Array.from({length:count},(_,i)=>new Date(start+i*DAY+OFFSET).toISOString().slice(0,10))};
}
// Internal Admin SDK operation only. No HTTP/callable export, no client hours,
// no total point conversion. Enumerate every configured day, including gaps.
function createBackfill(db,{awardTitle,clock=Date.now}={}){
  if(typeof awardTitle!=='function')throw Error('trusted-award-title-required');
  return async function backfill(uid,{dryRun=false}={}){
    if(typeof dryRun!=='boolean')throw Error('invalid-dry-run');
    if(typeof uid!=='string'||! /^[A-Za-z0-9_-]{1,120}$/.test(uid))throw Error('invalid-backfill-uid');
    const result=await db.runTransaction(async tx=>{
      const config=await tx.get(db.doc('systemSettings/onlineTimeTitles'));
      const p=plan(config.data(),clock(),{dryRun});
      const statsRef=db.doc(`playerStats/${uid}`),receiptRef=db.doc(`${RECEIPTS}/${uid}`);
      const defRefs=D.DEFINITIONS.map(d=>db.doc(`titleDefinitions/${d.id}`));
      const [user,stats,receipt,settings,...defs]=await Promise.all([
        tx.get(db.doc(`users/${uid}`)),tx.get(statsRef),tx.get(receiptRef),
        tx.get(db.doc('systemSettings/engagement')),...defRefs.map(ref=>tx.get(ref))
      ]);
      if(!D.eligible(user.data()))return {status:'ineligible'};
      const old=stats.data()||{},oldTotal=D.integer(old.officialOnlineTimeMs??0,'stored-total');
      if(old.onlineTimeTrackedFrom!=null&&old.onlineTimeTrackedFrom!==p.liveStartAt)throw Error('online-time-activation-changed');
      const flags=settings.data()||{},base={confirmedTitleIds:old.onlineTimeConfirmedTitleIds||[],
        awardsEnabled:flags.titlesEnabled===true&&flags.automaticTitleAwardsEnabled===true};
      if(receipt.exists){
        const saved=receipt.data();
        if(saved.batchId!==p.batchId||saved.cutoverAt!==p.cutover||(saved.liveStartAt??saved.cutoverAt)!==p.liveStartAt||saved.historyStartDate!==config.data().historyStartDate)throw Error('backfill-already-completed-with-different-plan');
        return {...base,status:'already-completed',totalMs:oldTotal,historicalMs:saved.historicalMs};
      }
      if(old.onlineTimeHistoricalMs!=null||old.onlineTimeBackfillBatchId!=null)throw Error('historical-marker-without-receipt');
      const days=await Promise.all(p.dates.map((date,i)=>tx.get(db.doc(
        p.partial&&i===p.dates.length-1
          ?`onlineTimeTitleCutovers/${p.batchId}/players/${uid}`
          :`activityOnlineDaily/${date}/players/${uid}`))));
      let historicalMs=0,presentDays=0;
      const evidence=p.dates.map((date,i)=>{
        if(p.partial&&i===p.dates.length-1&&!days[i].exists)throw Error('cutover-checkpoint-missing');
        if(!days[i].exists)return {date,missing:true};
        const row=days[i].data();
        const isCheckpoint=p.partial&&i===p.dates.length-1;
        if(row.uid!==uid||row.dateKey!==date||
           (isCheckpoint&&(row.cutoverAt!==p.cutover||row.sourceSchema!=='frozen-daily-v1')))
          throw Error('historical-source-mismatch');
        const activeMs=D.integer(row.activeMs,'historical-active-ms');
        if(activeMs>3*D.HOUR)throw Error('historical-daily-cap-exceeded');
        historicalMs=D.totalAfter(historicalMs,activeMs);presentDays++;
        return {date,activeMs,...(isCheckpoint?{checkpoint:true}:{} )};
      });
      const total=D.totalAfter(oldTotal,historicalMs),now=clock(),minutes=Math.floor(total/D.MINUTE);
      for(const [i,definition] of D.DEFINITIONS.entries()){
        if(defs[i].exists&&!D.matchesDefinition(defs[i].data(),definition))throw Error('online-time-definition-conflict:'+definition.id);
      }
      if(dryRun)return {status:'dry-run',uid,batchId:p.batchId,cutoverAt:p.cutover,liveStartAt:p.liveStartAt,
        historicalMs,totalMs:total,presentDays,missingDays:p.dates.length-presentDays,evidence,
        qualifyingTitleIds:D.DEFINITIONS.filter(d=>total>=d.targetValue*D.MINUTE).map(d=>d.id)};
      for(const [i,definition] of D.DEFINITIONS.entries()){
        if(!defs[i].exists){
          const row={...definition,version:1,recipientCount:0,createdAt:now,updatedAt:now,createdBy:'system'};
          tx.create(defRefs[i],row);tx.create(db.doc(`publicTitleCatalog/${definition.id}`),row);
        }
        tx.set(db.doc(`users/${uid}/titleProgress/${definition.id}`),{
          titleId:definition.id,currentValue:minutes,targetValue:definition.targetValue,
          completed:minutes>=definition.targetValue,updatedAt:now
        },{merge:true});
      }
      tx.set(statsRef,{officialOnlineTimeMs:total,onlineTimeHistoricalMs:historicalMs,
        onlineTimeBackfillBatchId:p.batchId,onlineTimeTrackedFrom:p.liveStartAt,onlineTimeUpdatedAt:now},{merge:true});
      tx.create(receiptRef,{uid,batchId:p.batchId,strategy:'C-once-v1',cutoverAt:p.cutover,liveStartAt:p.liveStartAt,
        historyStartDate:config.data().historyStartDate,historicalMs,presentDays,missingDays:p.dates.length-presentDays,
        source:'activityOnlineDaily.activeMs',evidence,
        evidenceSha256:createHash('sha256').update(JSON.stringify(evidence)).digest('hex'),completedAt:now});
      return {...base,status:'completed',historicalMs,totalMs:total,presentDays,missingDays:p.dates.length-presentDays};
    });
    if(!dryRun)await grantEligible(db,awardTitle,uid,result);
    return result;
  };
}
module.exports={createBackfill,plan,RECEIPTS};
