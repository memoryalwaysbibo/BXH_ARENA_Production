'use strict';
const {HttpsError}=require('firebase-functions/v2/https'),B=require('./bucket-state.cjs');
const has=(o,k)=>!!o&&Object.prototype.hasOwnProperty.call(o,k);
const reasons=new Set(['room-write-locked','room-generation-unavailable','bucket-poster-context','room-write-generation-changed']);
function fail(reason){throw new HttpsError('failed-precondition',reason);}
function born(snapshot){const t=snapshot?.createTime;if(!snapshot?.exists||!Number.isSafeInteger(t?.seconds)||!Number.isSafeInteger(t?.nanoseconds))fail('room-generation-unavailable');return t.seconds+':'+t.nanoseconds;}
function binding(root,publicRoot,code){
 const room=root.data()||{},pub=publicRoot.data()||{};
 if([room,pub].some(d=>has(d,'bucketMigration')||has(d,'deletionStatus')))fail('room-write-locked');
 const value={privateBirth:born(root),publicBirth:born(publicRoot),owner:room.createdBy||null,mode:'legacy'};
 if([room,pub].some(d=>has(d,'scoreStorage')||has(d,'scoreBucketProjection'))){
  if(has(room,'scoreBucketProjection')||has(pub,'scoreStorage'))fail('bucket-poster-context');
  let state,m;try{state=JSON.parse(room.data);m=B.context(room,state);}catch{fail('bucket-poster-context');}
  const vector=pub.scoreBucketProjection;
  if(m.code!==code||m.courtCount>32||typeof m.roomId!=='string'||!m.roomId||vector?.epoch!==m.epoch||Object.keys(vector.versions||{}).length!==m.bucketCount||Array.from({length:m.bucketCount},(_,i)=>vector.versions?.['court-'+(i+1)]).some(n=>!Number.isSafeInteger(n)||n<0))fail('bucket-poster-context');
  value.mode='bucket';value.manifest={schema:m.schema,status:m.status,code:m.code,roomId:m.roomId,epoch:m.epoch,courtCount:m.courtCount,bucketCount:m.bucketCount};
 }
 return JSON.stringify(value);
}
function same(before,after){if(!before||before!==after)fail('room-write-generation-changed');}
const known=e=>e?.code==='failed-precondition'&&reasons.has(e.message);
function assignmentCurrent(root,assignment,embedded){
 const data=assignment?.data()||{},birth=born(root);
 if(has(data,'sourceCreatedAt')||has(embedded,'sourceCreatedAt'))return data.sourceCreatedAt===birth&&embedded.sourceCreatedAt===birth;
 const a=assignment?.createTime,r=root.createTime;
 return !!assignment?.exists&&Number.isSafeInteger(a?.seconds)&&Number.isSafeInteger(a?.nanoseconds)&&(a.seconds>r.seconds||a.seconds===r.seconds&&a.nanoseconds>=r.nanoseconds);
}
module.exports={binding,same,known,assignmentCurrent};

// Metadata and Storage cannot share a transaction. Resolve an ambiguous commit
// before deleting our unique new objects; an unavailable/partial read is unknown.
async function outcome(db,privateRef,publicRef,code,before,owned){
 try{return await db.runTransaction(async tx=>{
  const [root,pub]=await Promise.all([tx.get(privateRef),tx.get(publicRef)]);
  if(!root.exists||!pub.exists||binding(root,pub,code)!==before)return 'unknown';
  const privateData=root.data(),publicData=pub.data(),urls=Object.entries(owned).filter(([key])=>key.endsWith('Url'));
  if(Object.entries(owned).every(([k,v])=>privateData[k]===v)&&urls.every(([k,v])=>publicData[k]===v))return 'confirmed';
  const referenced=Object.values(owned).some(value=>[privateData.posterPath,privateData.coverPath,privateData.posterUrl,privateData.coverUrl,publicData.posterUrl,publicData.coverUrl].includes(value));
  return referenced?'unknown':'unreferenced';
 });}catch{return 'unknown';}
}
module.exports.outcome=outcome;
