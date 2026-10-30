'use strict';
const {createHash}=require('node:crypto');
const D=require('./domain.cjs');
const RECEIPTS='onlineTimeTitleReceipts';
// No client-supplied elapsed time or point balance is accepted by this service.
function createService(db,{awardTitle,clock=Date.now}={}){
  if(typeof awardTitle!=='function')throw Error('trusted-award-title-required');
  return async function onlineTimeTitlePresenceWritten(event){
    const uid=event.params?.uid;
    if(typeof uid!=='string'||! /^[A-Za-z0-9_-]{1,120}$/.test(uid))return {status:'ignored'};
    const change=event.data;
    if(!change?.before?.exists||!change.after?.exists)return {status:'ignored'};
    const before=change.before.data(),after=change.after.data();
    const raw=D.interval(before,after,0);
    if(!raw)return {status:'ignored'};
    const sourcePath=`onlinePresence/${uid}`;
    if(change.before.ref?.path!==sourcePath||change.after.ref?.path!==sourcePath)throw Error('presence-source-mismatch');
    const receiptId=createHash('sha256').update(`${uid}:${raw.start}:${raw.end}`).digest('hex');
    const result=await db.runTransaction(async tx=>{
      const userRef=db.doc(`users/${uid}`),statsRef=db.doc(`playerStats/${uid}`),receiptRef=db.doc(`${RECEIPTS}/${receiptId}`);
      const defRefs=D.DEFINITIONS.map(d=>db.doc(`titleDefinitions/${d.id}`));
      const [user,config,settings,stats,receipt,...defs]=await Promise.all([
        tx.get(userRef),tx.get(db.doc('systemSettings/onlineTimeTitles')),
        tx.get(db.doc('systemSettings/engagement')),tx.get(statsRef),tx.get(receiptRef),
        ...defRefs.map(ref=>tx.get(ref))
      ]);
      const cfg=config.data();
      if(!cfg||cfg.enabled!==true)return {status:'disabled'};
      // Activation must be explicit and dated. Old source events cannot silently
      // manufacture a retrospective lifetime total or erase existing history.
      if(!Number.isSafeInteger(cfg.startAt)||cfg.startAt<=0||cfg.sourceSchema!=='lastSeenAt-v1')throw Error('online-time-source-not-verified');
      if(!D.eligible(user.data()))return {status:'ineligible'};
      const credited=D.interval(before,after,cfg.startAt);
      if(!credited)return {status:'before-activation'};
      const old=stats.data()||{},oldTotal=D.integer(old.officialOnlineTimeMs??0,'stored-total');
      if(old.onlineTimeTrackedFrom!=null&&old.onlineTimeTrackedFrom!==cfg.startAt)throw Error('online-time-activation-changed');
      const total=receipt.exists?oldTotal:D.totalAfter(oldTotal,credited.deltaMs);
      for(const [i,definition] of D.DEFINITIONS.entries()){
        if(defs[i].exists&&!D.matchesDefinition(defs[i].data(),definition))throw Error('online-time-definition-conflict:'+definition.id);
      }
      const now=clock(),minutes=Math.floor(total/D.MINUTE);
      const updateProgress=!receipt.exists&&Math.floor(oldTotal/(30*D.MINUTE))!==Math.floor(total/(30*D.MINUTE));
      for(const [i,definition] of D.DEFINITIONS.entries()){
        if(!defs[i].exists){
          const row={...definition,version:1,recipientCount:0,createdAt:now,updatedAt:now,createdBy:'system'};
          tx.create(defRefs[i],row);
          tx.create(db.doc(`publicTitleCatalog/${definition.id}`),row);
        }
        if(updateProgress||!defs[i].exists){
          tx.set(db.doc(`users/${uid}/titleProgress/${definition.id}`),{
            titleId:definition.id,currentValue:minutes,targetValue:definition.targetValue,
            completed:minutes>=definition.targetValue,updatedAt:now
          },{merge:true});
        }
      }
      if(!receipt.exists){
        tx.set(statsRef,{officialOnlineTimeMs:total,onlineTimeTrackedFrom:cfg.startAt,onlineTimeUpdatedAt:now},{merge:true});
        tx.create(receiptRef,{uid,sourcePath,from:credited.start,to:credited.end,deltaMs:credited.deltaMs,createdAt:now});
      }
      const flags=settings.data()||{};
      return {status:receipt.exists?'duplicate':'counted',totalMs:total,
        confirmedTitleIds:Array.isArray(old.onlineTimeConfirmedTitleIds)?old.onlineTimeConfirmedTitleIds:[],
        awardsEnabled:flags.titlesEnabled===true&&flags.automaticTitleAwardsEnabled===true};
    });
    // Always retry awards after an already-counted interval. A failed award
    // must not be lost merely because the time transaction already committed.
    if(result.awardsEnabled){
      for(const definition of D.DEFINITIONS){
        if(result.totalMs<definition.targetValue*D.MINUTE||result.confirmedTitleIds.includes(definition.id))continue;
        const award=await awardTitle({uid,titleId:definition.id,sourceType:'online_time',
          sourceId:'online_time_v1',grantedBy:'system',grantReason:definition.description});
        if(award?.reason==='evaluation-error')throw Error('online-time-award-retry');
        if(award?.awarded===true||award?.reason==='already-earned'){
          // One acknowledgement per lifetime title avoids calling the native
          // award transaction on every subsequent heartbeat. A failed ack is
          // safe to retry: the native earned-title record remains authoritative.
          await db.runTransaction(async tx=>{
            const ref=db.doc(`playerStats/${uid}`),snap=await tx.get(ref);
            const ids=Array.isArray(snap.data()?.onlineTimeConfirmedTitleIds)?snap.data().onlineTimeConfirmedTitleIds:[];
            if(!ids.includes(definition.id))tx.set(ref,{onlineTimeConfirmedTitleIds:[...ids,definition.id]},{merge:true});
          });
        }
      }
    }
    return result;
  };
}
module.exports={createService,RECEIPTS};
