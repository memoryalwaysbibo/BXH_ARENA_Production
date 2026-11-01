'use strict';
// Candidate adapter, not exported as a Firebase callable. Never accepts production DBs.
const {createHash}=require('node:crypto'),C=require('./core.cjs'),S=require('./scoring-core.cjs'),B=require('./bucket-state.cjs');
const LOCAL=new Set(['score','fault','undo','rematch','pause','resume']);
function createBucketScoringHandler(db,{clock=Date.now}={}){
 if(db.projectId!=='demo-bxh-four-court-buckets'||process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8188')throw Error('emulator-only');
 return async request=>{
  const uid=request.auth?.uid,d=request.data||{},code=String(d.code||'').trim().toUpperCase();
  if(!uid)throw Error('unauthenticated');
  if(!/^BXH-[A-Z0-9]{4,16}$/.test(code)||!/^[-a-zA-Z0-9]{16,80}$/.test(d.operationId||'')||JSON.stringify(d).length>10000)throw Error('invalid-request');
  if(!LOCAL.has(d.action)&&!['confirm','quick'].includes(d.action))throw Error('unsupported-bucket-action');
  const root=db.doc('tournaments/'+code),publicRef=db.doc('publicTournaments/'+code);
  const key=createHash('sha256').update(uid+':'+d.operationId).digest('hex'),hash=createHash('sha256').update(JSON.stringify(d)).digest('hex'),receiptRef=root.collection('bucketScoreOperations').doc(key);
  return db.runTransaction(async tx=>{
   const now=clock(),[rootSnap,userSnap,configSnap,receipt]=await Promise.all([tx.get(root),tx.get(db.doc('users/'+uid)),tx.get(db.doc('systemConfig/fourCourtScoreBuckets')),tx.get(receiptRef)]);
   if(!rootSnap.exists)throw Error('not-found');
   if(configSnap.data()?.enabled!==true)throw Error('release-not-ready');
   const room=rootSnap.data(),user=userSnap.data(),authority={now,partnerEnabled:false};
   if(C.partnerRoom(room))throw Error('partner-not-supported');
   let base;try{base=JSON.parse(room.data);}catch{throw Error('corrupt-data');}
   const m=B.context(room,base),bucketId=B.route(Number(d.station),m.courtCount),local=LOCAL.has(d.action);
   if(m.code!==code)throw Error('room-mismatch');
   if(!C.eligible(room,user,uid,authority)||!S.allowed(room,user,uid,Number(d.station),authority))throw Error('station-not-assigned');
   const ids=local?[bucketId]:Array.from({length:m.bucketCount},(_,i)=>'court-'+(i+1));
   const snaps=await Promise.all(ids.map(id=>tx.get(root.collection('matchBuckets').doc(id))));
   const buckets=snaps.map(s=>s.exists?s.data():null),state=B.materialize(base,m,buckets,local?bucketId:null);
   // Recheck current authority even for a replay; an old receipt cannot restore a revoked seat.
   if(receipt.exists){if(receipt.data().hash!==hash||receipt.data().epoch!==m.epoch)throw Error('operation-conflict');return {...receipt.data().result,replayed:true,buckets};}
   let previous;
   if(!local){const snap=await tx.get(publicRef);if(!snap.exists)throw Error('public-mirror-missing');try{previous=JSON.parse(snap.data().bracketView);}catch{throw Error('public-mirror-missing');}}
   const result=(local?S.transitionLocal:S.transition)({room,state,user,uid,d,now,authority});
   const encoded=B.encode(state,m,buckets),changed=encoded.filter(b=>ids.includes(b.bucketId)&&b.matches!==buckets.find(x=>x.bucketId===b.bucketId)?.matches);
   if(local){
    const outside=x=>Number(x.station)<=0||B.route(Number(x.station),m.courtCount)!==bucketId;
    const original=base.matches.filter(outside),after=state.matches.filter(outside);
    if(JSON.stringify(original)!==JSON.stringify(after))throw Error('cross-bucket-local-change');
   }
   for(const bucket of changed)tx.set(root.collection('matchBuckets').doc(bucket.bucketId),bucket);
   if(!local){
    state.updatedAt=Math.max(now,Number(room.updatedAt||0)+1);tx.update(root,{data:JSON.stringify(state),updatedAt:state.updatedAt});
    tx.update(publicRef,{bracketView:JSON.stringify(S.publicProjection(state,previous)),updatedAt:state.updatedAt});
   }
   const response={ok:true,matchId:result.matchId,scoreRevision:result.scoreRevision,bucketId,structural:!local};
   tx.create(receiptRef,{uid,hash,epoch:m.epoch,at:now,result:response});
   const match=state.matches.find(x=>x.id===result.matchId);
   tx.create(root.collection('bucketScoreAudit').doc(key),{uid,at:now,action:d.action,station:result.station,matchId:result.matchId,scoreRevision:result.scoreRevision,scoreA:match?.scoreA??null,scoreB:match?.scoreB??null});
   if(!local)tx.set(db.doc('staffActivityLogs/'+uid+'/matches/'+code+'_'+result.matchId),{uid,tournamentCode:code,tournamentName:state.meta.name||'',matchId:result.matchId,station:result.station,confirmedAt:now,resultMethod:d.action==='quick'?'quick_decision':'score',eventAuthority:'official'},{merge:true});
   return {...response,buckets:encoded.filter(b=>ids.includes(b.bucketId)),...(local?{}:{state})};
  });
 };
}
module.exports={createBucketScoringHandler};
