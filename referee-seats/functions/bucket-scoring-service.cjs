'use strict';
// Shared trusted adapter. Production access requires both runtime and room gates.
const {createHash}=require('node:crypto'),C=require('./core.cjs'),S=require('./scoring-core.cjs'),D=require('./dispatch-core.cjs'),B=require('./bucket-state.cjs');
const LOCAL=new Set(['score','fault','undo','rematch','pause','resume']);
// Resizing changes the manifest/bucket set and needs a separate lifecycle plan.
const DISPATCH=new Set([...D.ACTIONS].filter(action=>action!=='resize'));
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
   const m=B.context(room,base),dispatch=DISPATCH.has(d.action),authorizationStation=dispatch?D.authorizationStation(d):Number(d.station),bucketId=B.route(authorizationStation,m.courtCount),local=LOCAL.has(d.action);
   if(m.code!==code)throw Error('room-mismatch');
   gate.assertRoom(configSnap.data(),m);
   if(!C.eligible(room,user,uid,authority)||!S.allowed(room,user,uid,authorizationStation,authority))throw Error('station-not-assigned');
   const ids=local?[bucketId]:Array.from({length:m.bucketCount},(_,i)=>'court-'+(i+1));
   const snaps=await tx.getAll(...ids.map(id=>root.collection('matchBuckets').doc(id)));
   const buckets=snaps.map(s=>s.exists?s.data():null),state=B.materialize(base,m,buckets,local?bucketId:null);
   // Recheck current authority even for a replay; an old receipt cannot restore a revoked seat.
   if(receipt.exists){if(receipt.data().hash!==hash||receipt.data().epoch!==m.epoch)throw Error('operation-conflict');return {...receipt.data().result,replayed:true,buckets};}
   let previous;
   if(!local){const snap=await tx.get(publicRef);if(!snap.exists)throw Error('public-mirror-missing');try{previous=JSON.parse(snap.data().bracketView);}catch{throw Error('public-mirror-missing');}}
   const result=(dispatch?D.transition:local?S.transitionLocal:S.transition)({room,state,user,uid,d,now,authority});
   const encoded=B.encode(state,m,buckets),changed=encoded.filter(b=>ids.includes(b.bucketId)&&b.matches!==buckets.find(x=>x.bucketId===b.bucketId)?.matches);
   if(local){
    const outside=x=>Number(x.station)<=0||B.route(Number(x.station),m.courtCount)!==bucketId;
    const original=base.matches.filter(outside),after=state.matches.filter(outside);
    if(JSON.stringify(original)!==JSON.stringify(after))throw Error('cross-bucket-local-change');
   }
   for(const bucket of changed)tx.set(root.collection('matchBuckets').doc(bucket.bucketId),bucket);
   if(!local){
    state.updatedAt=Math.max(now,Number(room.updatedAt||0)+1,Number(state.updatedAt||0)+1);tx.update(root,{...(dispatch?{courtLifecycleWriteSeq:Number(room.courtLifecycleWriteSeq||0)+1}:{}),data:JSON.stringify(state),updatedAt:state.updatedAt});
    tx.update(publicRef,{bracketView:JSON.stringify(S.publicProjection(state,previous)),scoreBucketProjection:{epoch:m.epoch,versions:Object.fromEntries(encoded.map(b=>[b.bucketId,b.revision]))},updatedAt:state.updatedAt});
   }
   const response={ok:true,matchId:result.matchId,scoreRevision:result.scoreRevision,bucketId,structural:!local,...(dispatch?{lifecycleRevision:state.courtLifecycleEpoch}: {})};
   tx.create(receiptRef,{uid,hash,epoch:m.epoch,at:now,result:response});
   const match=state.matches.find(x=>x.id===result.matchId);
   tx.create(root.collection('bucketScoreAudit').doc(key),{uid,at:now,action:d.action,station:result.station,matchId:result.matchId,scoreRevision:result.scoreRevision,scoreA:match?.scoreA??null,scoreB:match?.scoreB??null,...(dispatch?{lifecycleRevision:state.courtLifecycleEpoch,targetStation:d.targetStation??null,targetMatchId:d.targetMatchId??null}: {})});
   if(['confirm','quick'].includes(d.action))tx.set(db.doc('staffActivityLogs/'+uid+'/matches/'+code+'_'+result.matchId),{uid,tournamentCode:code,tournamentName:state.meta.name||'',matchId:result.matchId,station:result.station,confirmedAt:now,resultMethod:d.action==='quick'?'quick_decision':'score',eventAuthority:'official'},{merge:true});
   return {...response,buckets:encoded.filter(b=>ids.includes(b.bucketId)),...(local?{}:{state})};
  });
 };
}
module.exports={createBucketScoringHandler};

