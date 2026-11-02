'use strict';
// Shared trusted adapter. Production access requires both runtime and room gates.
const {createHash}=require('node:crypto'),C=require('./core.cjs'),S=require('./scoring-core.cjs'),D=require('./dispatch-core.cjs'),B=require('./bucket-state.cjs');
const LOCAL=new Set(['score','fault','undo','rematch','pause','resume']);
const DISPATCH=new Set(['idle-claim','claim-skipped','manual-assign','swap','force-exit','reopen','claim-detached','retirement-transfer','resize']);
function createBucketScoringHandler(db,{clock=Date.now,runtime='emulator'}={}){
 const gate=require('./bucket-runtime.cjs').createBucketRuntime(db,{runtime});
 return async request=>{
  const uid=request.auth?.uid,d=request.data||{},code=String(d.code||'').trim().toUpperCase();
  if(!uid)throw Error('unauthenticated');
  if(!/^BXH-[A-Z0-9]{4,16}$/.test(code)||!/^[-a-zA-Z0-9]{16,80}$/.test(d.operationId||'')||JSON.stringify(d).length>10000)throw Error('invalid-request');
  if(!LOCAL.has(d.action)&&!DISPATCH.has(d.action)&&!['confirm','quick'].includes(d.action))throw Error('unsupported-bucket-action');
  const root=db.doc('tournaments/'+code),publicRef=db.doc('publicTournaments/'+code);
  const key=createHash('sha256').update(uid+':'+d.operationId).digest('hex'),hash=createHash('sha256').update(JSON.stringify(d)).digest('hex'),receiptRef=root.collection('bucketScoreOperations').doc(key);
  return db.runTransaction(async tx=>{
   const now=clock(),[rootSnap,userSnap,configSnap,receipt]=await tx.getAll(root,db.doc('users/'+uid),db.doc('systemConfig/fourCourtScoreBuckets'),receiptRef);
   if(!rootSnap.exists)throw Error('not-found');
   if(configSnap.data()?.enabled!==true)throw Error('release-not-ready');
   const room=rootSnap.data(),user=userSnap.data(),authority={now,partnerEnabled:false};
   if(C.partnerRoom(room))throw Error('partner-not-supported');
   let base;try{base=JSON.parse(room.data);}catch{throw Error('corrupt-data');}
   const m=B.context(room,base),dispatch=DISPATCH.has(d.action),resize=d.action==='resize',authorizationStation=dispatch?D.authorizationStation(d):Number(d.station),bucketId=resize?null:B.route(authorizationStation,m.courtCount),local=LOCAL.has(d.action);
   if(m.code!==code)throw Error('room-mismatch');
   gate.assertRoom(configSnap.data(),m);
   if(!C.eligible(room,user,uid,authority)||!(resize?C.manager(room,user,uid,authority):S.allowed(room,user,uid,authorizationStation,authority)))throw Error('station-not-assigned');
   const ids=local?[bucketId]:Array.from({length:m.bucketCount},(_,i)=>'court-'+(i+1));
   const snaps=await tx.getAll(...ids.map(id=>root.collection('matchBuckets').doc(id)));
   const buckets=snaps.map(s=>s.exists?s.data():null),state=B.materialize(base,m,buckets,local?bucketId:null);
   // Recheck current authority even for a replay; an old receipt cannot restore a revoked seat.
   if(receipt.exists){
    const saved=receipt.data();if(saved.hash!==hash||saved.epoch!==m.epoch)throw Error('operation-conflict');
    if(dispatch){const a=saved.authorization;if(!a||!Array.isArray(a.stations)||!a.stations.length&&!a.managerOnly)throw Error('operation-authority-missing');if(a.managerOnly&&!C.manager(room,user,uid,authority)||a.stations.some(n=>!Number.isInteger(n)||n<1||n>m.courtCount||!S.allowed(room,user,uid,n,authority)))throw Error('station-not-assigned');}
    return {...saved.result,replayed:true,buckets};
   }
   let previous;
   if(!local){const snap=await tx.get(publicRef);if(!snap.exists)throw Error('public-mirror-missing');try{previous=JSON.parse(snap.data().bracketView);}catch{throw Error('public-mirror-missing');}}
   const authorization=dispatch?{managerOnly:['reopen','claim-detached','retirement-transfer','resize'].includes(d.action),stations:resize?[]:[...new Set(d.action==='swap'?[Number(d.station),Number(state.matches.find(x=>x.id===d.targetMatchId)?.station)]:d.action==='manual-assign'?[Number(d.station),Number(d.targetStation)]:[authorizationStation])]}:null;
   const result=(dispatch?D.transition:local?S.transitionLocal:S.transition)({room,state,user,uid,d,now,authority});
   const nextCount=Number(state.meta.stations);
   if(!Number.isSafeInteger(nextCount)||nextCount<1||nextCount>32||state.matches.some(x=>!x.completed&&Number(x.station)>nextCount))throw Error('bucket-court-count-invalid');
   const nextManifest=nextCount===m.courtCount?m:B.makeManifest(state,m.epoch);
   const encoded=B.encode(state,nextManifest,buckets),changed=encoded.filter(b=>!local||ids.includes(b.bucketId)).filter(b=>b.matches!==buckets.find(x=>x.bucketId===b.bucketId)?.matches);
   if(nextManifest.bucketCount>m.bucketCount){
    const additions=Array.from({length:nextManifest.bucketCount-m.bucketCount},(_,i)=>root.collection('matchBuckets').doc('court-'+(m.bucketCount+i+1)));
    const old=await tx.getAll(...additions);if(old.some(s=>s.exists))throw Error('bucket-already-exists');
   }
   if(local){
    const outside=x=>Number(x.station)<=0||Number(x.station)>m.courtCount||B.route(Number(x.station),m.courtCount)!==bucketId;
    const original=base.matches.filter(outside),after=state.matches.filter(outside);
    if(JSON.stringify(original)!==JSON.stringify(after))throw Error('cross-bucket-local-change');
   }
   for(const bucket of changed)tx.set(root.collection('matchBuckets').doc(bucket.bucketId),bucket);
   for(let i=nextManifest.bucketCount+1;i<=m.bucketCount;i++)tx.delete(root.collection('matchBuckets').doc('court-'+i));
   if(!local){
    state.updatedAt=Math.max(now,Number(room.updatedAt||0)+1,Number(state.updatedAt||0)+1);
    const projection=C.project(room.refereeSeatsV1,room.createdBy,nextCount);
    state.meta={...state.meta,refereeSeatsV1:room.refereeSeatsV1,...projection,assignedStaffUids:room.assignedStaffUids||[]};
    tx.update(root,{...(dispatch?{courtLifecycleWriteSeq:Number(room.courtLifecycleWriteSeq||0)+1}:{}),...projection,scoreStorage:nextManifest,data:JSON.stringify(state),updatedAt:state.updatedAt});
    tx.update(publicRef,{bracketView:JSON.stringify(S.publicProjection(state,previous)),scoreBucketProjection:{epoch:m.epoch,versions:Object.fromEntries(encoded.map(b=>[b.bucketId,b.revision]))},updatedAt:state.updatedAt});
   }
   const response={ok:true,matchId:result.matchId,scoreRevision:result.scoreRevision,bucketId,structural:!local,...(dispatch?{lifecycleRevision:state.courtLifecycleEpoch}: {})};
   tx.create(receiptRef,{uid,hash,epoch:m.epoch,at:now,result:response,...(dispatch?{authorization}: {})});
   const match=state.matches.find(x=>x.id===result.matchId);
   tx.create(root.collection('bucketScoreAudit').doc(key),{uid,at:now,action:d.action,station:result.station,matchId:result.matchId,scoreRevision:result.scoreRevision,scoreA:match?.scoreA??null,scoreB:match?.scoreB??null,...(dispatch?{lifecycleRevision:state.courtLifecycleEpoch,targetStation:d.targetStation??null,targetMatchId:d.targetMatchId??null}: {})});
   if(['confirm','quick'].includes(d.action))tx.set(db.doc('staffActivityLogs/'+uid+'/matches/'+code+'_'+result.matchId),{uid,tournamentCode:code,tournamentName:state.meta.name||'',matchId:result.matchId,station:result.station,confirmedAt:now,resultMethod:d.action==='quick'?'quick_decision':'score',eventAuthority:'official'},{merge:true});
   return {...response,buckets:encoded.filter(b=>local?ids.includes(b.bucketId):true),...(local?{}:{state})};
  });
 };
}
module.exports={createBucketScoringHandler};

