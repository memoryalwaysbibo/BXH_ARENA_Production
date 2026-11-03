(function(root,factory){
 if(typeof module==='object'&&module.exports)module.exports=factory(require('../../referee-seats/functions/bucket-state.cjs'));
 else root.BXHFourCourtSettlement=factory(root.BXHMatchBuckets);
})(typeof globalThis!=='undefined'?globalThis:this,function(B){
 'use strict';
 const has=(o,k)=>!!o&&Object.prototype.hasOwnProperty.call(o,k);
 const clone=x=>JSON.parse(JSON.stringify(x));
 const stable=x=>Array.isArray(x)?x.map(stable):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,stable(x[k])])):x;
 const equal=(a,b)=>JSON.stringify(stable(a))===JSON.stringify(stable(b));
 const fail=reason=>{throw Error(reason);};
 const marked=(...docs)=>docs.some(d=>['scoreStorage','scoreBucketProjection','bucketMigration','deletionStatus'].some(k=>has(d,k)));
 function context(top,pub,expected){
  if([top,pub].some(d=>has(d,'bucketMigration')||has(d,'deletionStatus')))fail('bucket-settlement-fenced');
  const base=JSON.parse(top.data),m=B.context(top,base);
  if(m.code!==expected.code||m.roomId!==expected.id||m.epoch!==expected.epoch||m.courtCount>32||top.systemClosed||top.eventCancelled)fail('bucket-room-changed');
  return {base,m};
 }
 async function validate({top,pub,buckets,expected,hash}){
  const {base,m}=context(top,pub,expected),state=B.materialize(base,m,buckets),c=top.bucketSettlement;
  if(!c)return null;
  const versions=Object.fromEntries(buckets.map(b=>[b.bucketId,b.revision]));
  if(c.version!==1||c.status!=='completed'||c.epoch!==m.epoch||!equal(c.versions,versions)||!Number.isSafeInteger(c.completedAt)||c.completedAt<=0||!/^\d+:\d+$/.test(c.sourceCreatedAt||''))fail('bucket-settlement-requires-review');
  const receipt={version:1,status:'completed',epoch:m.epoch,versions,completedAt:c.completedAt};
  if(!equal(pub.bucketSettlement,receipt)||!equal(pub.scoreBucketProjection,{epoch:m.epoch,versions})||top.archiveStatus!=='completed'||pub.archiveStatus!=='completed'||state.archiveStatus!=='completed'||state.settlementPhase!=='completed'||state.settlementCompletedAt!==c.completedAt||top.ladderPointsAwarded!==true||state.ladderPointsAwarded!==true||!Array.isArray(state.ladderResults)||state.ladderResults.length<2||!equal(top.ladderResults,state.ladderResults)||top.ladderSeasonId!==state.ladderSeasonId||!equal(top.ladderSkippedPlayers,state.ladderSkippedPlayers))fail('bucket-settlement-requires-review');
  const digest=await hash(JSON.stringify(stable(state)));
  if(digest!==c.stateDigest)fail('bucket-settlement-requires-review');
  return {...clone(state),scoreStorage:clone(m),bucketSettlement:clone(receipt)};
 }
 // read() must use a server transaction over the two roots and every active bucket.
 // No client write, browser timestamp or callable response can acknowledge completion.
 async function settle({expected,getUid,read,call,hash}){
  const uid=getUid();if(!uid)return {ok:false,reason:'auth-required'};
  const current=()=>getUid()===uid;
  const inspect=async()=>{const docs=await read(expected);if(!current())fail('auth-changed');const data=await validate({...docs,expected,hash});if(!current())fail('auth-changed');return data;};
  try{
   let data=await inspect();if(data)return {ok:true,data,archived:true,alreadyAwarded:true};
   if(!current())fail('auth-changed');
   let response;try{response=await call(expected.code);}catch(e){ /* A lost response still requires authoritative readback. */ }
   if(!current())fail('auth-changed');
   data=await inspect();
   if(data)return {ok:true,data,archived:true,alreadyAwarded:!!response?.alreadyAwarded};
   return {ok:false,reason:response?.reason||'bucket-settlement-pending',pending:true};
  }catch(e){return {ok:false,reason:['auth-changed','auth-required','bucket-room-changed','bucket-settlement-fenced','bucket-settlement-requires-review'].includes(e.message)?e.message:'bucket-settlement-pending',pending:true};}
 }
 return {marked,context,validate,settle};
});
