'use strict';
const A=require('./certificate.cjs'),C=require('./protocol/core.cjs'),{validateResults}=require('./protocol/results.cjs'),{createBucketRuntime}=require('./protocol/runtime.cjs'),{publicProjection}=require('./protocol/public-view.cjs'),{advance}=require('./protocol/qr-checkin-fence.cjs');
function createGeneralCompletion(db,{runtime='production',env=process.env,clock=Date.now}={}){
 return async request=>{
  const uid=request.auth?.uid,d=request.data||{},code=String(d.code||'').trim().toUpperCase();
  if(!uid)A.fail('unauthenticated');
  if(!/^BXH-[A-Z0-9]{4,16}$/.test(code)||typeof d.roomId!=='string'||!d.roomId||typeof d.epoch!=='string'||!d.epoch||JSON.stringify(d).length>2000||Object.keys(d).some(k=>!['code','roomId','epoch'].includes(k)))A.fail('invalid-request');
  const gate=createBucketRuntime(db,{runtime,env}),observed={};
  return db.runTransaction(async tx=>{
   const [root,pub,profile,config]=await Promise.all(['tournaments/'+code,'publicTournaments/'+code,'users/'+uid,'systemConfig/fourCourtScoreBuckets'].map(p=>tx.get(db.doc(p))));
   const input=await A.load({db,tx,root,pub,expected:d}),{top,publicData,state,m}=input,now=clock();
   if(observed.source&&observed.source!==input.sourceCreatedAt)A.fail('bucket-room-changed');observed.source=input.sourceCreatedAt;
   if(config.data()?.completionEnabled!==true)A.fail('bucket-completion-disabled');gate.assertRoom(config.data(),m);
   if(!C.manager(top,profile.data(),uid,{now,partnerEnabled:false})||C.partnerRoom(top))A.fail('permission-denied');
   if(top.eventAuthority!=='official'||state.meta?.eventAuthority!=='official'||top.refereeSeatsV1?.version!==1||top.testMode||state.testMode||top.systemClosed||state.systemClosed||top.eventCancelled||state.meta?.eventCancelled||top.tournamentPhase==='cancelled'||state.systemClosure&&!state.systemClosure.restoredAt||!Number.isSafeInteger(state.startedAt)||state.startedAt<=0)A.fail('bucket-room-read-only');
   if(top.ladderMode!=='general'||state.meta?.ladderMode!=='general'||state.meta?.formatType!=='single'||!['standard',undefined].includes(state.meta?.scoringMode)||!['standard',undefined].includes(state.meta?.playMode)||!['individual',undefined].includes(state.meta?.battleMode))A.fail('bucket-unsupported-room');
   // Replay remains authorized against fresh room, profile, gates and every bucket.
   const done=A.completed(input);if(done)return {ok:true,archived:true,alreadyCompleted:true,...done.receipt};
   if(A.has(top,'bucketSettlement')||top.ladderPointsAwarded===true||state.ladderPointsAwarded===true)A.fail('bucket-completion-requires-review');
   try{validateResults(state);}catch(e){A.fail(e.message);}
   Object.assign(state,{archiveStatus:'completed',settlementRoute:'no-ladder',settlementPhase:'completed',settlementCompletedAt:now,settlementError:null,settlementErrorCode:null,completedAt:now,archivedAt:now,updatedAt:now});
   let qr={};if(top.qrCheckinManaged===true){state.qrCheckinManaged=true;try{qr=advance(top,state,top.qrCheckinRevision);}catch(e){A.fail(e.message);}}
   let previous;try{previous=JSON.parse(publicData.bracketView);}catch{A.fail('bucket-public-corrupt');}if(!previous||Array.isArray(previous)||typeof previous!=='object')A.fail('bucket-public-corrupt');
   const view=publicProjection(state,previous);Object.assign(view.meta,{ladderMode:'general',eventAuthority:'official',formatType:'single'});Object.assign(view,{archiveStatus:'completed',settlementPhase:'completed',completedAt:now,archivedAt:now});if(top.qrCheckinManaged===true)view.players=state.players.map(p=>({id:p.id,name:p.name||'',checkedIn:p.checkedIn===true}));
   const receipt={version:1,status:'completed',epoch:m.epoch,versions:input.versions,completedAt:now};
   const privatePatch={...qr,data:JSON.stringify(state),archiveStatus:'completed',tournamentPhase:'done',completedAt:now,updatedAt:now,bucketCompletion:{...receipt,sourceCreatedAt:input.sourceCreatedAt,stateDigest:A.digest(state),actorUid:uid}};
   const publicPatch={...qr,ladderMode:'general',bracketView:JSON.stringify(view),archiveStatus:'completed',tournamentPhase:'done',completedAt:now,updatedAt:now,scoreBucketProjection:{epoch:m.epoch,versions:input.versions},bucketCompletion:receipt};
   if([{...top,...privatePatch},{...publicData,...publicPatch}].some(x=>Buffer.byteLength(JSON.stringify(x))>750000))A.fail('bucket-completion-size-budget');
   tx.update(root.ref,privatePatch);tx.update(pub.ref,publicPatch);
   return {ok:true,archived:true,alreadyCompleted:false,...receipt};
  });
 };
}
module.exports={createGeneralCompletion};
