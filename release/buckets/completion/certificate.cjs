'use strict';
const {createHash}=require('node:crypto'),B=require('./protocol/state.cjs');
const has=(o,k)=>!!o&&Object.prototype.hasOwnProperty.call(o,k);
const marked=(...docs)=>docs.some(d=>['scoreStorage','scoreBucketProjection','bucketMigration','deletionStatus'].some(k=>has(d,k)));
function fail(reason){throw Object.assign(Error(reason),{completionCode:reason});}
const stable=x=>Array.isArray(x)?x.map(stable):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,stable(x[k])])):x;
const digest=x=>createHash('sha256').update(JSON.stringify(stable(x))??'<missing>').digest('hex');
const equal=(a,b)=>digest(a)===digest(b);
function identity(s){if(!s.exists||!Number.isSafeInteger(s.createTime?.seconds)||!Number.isSafeInteger(s.createTime?.nanoseconds))fail('bucket-room-identity-missing');return s.createTime.seconds+':'+s.createTime.nanoseconds;}
async function load({db,tx,root,pub,expected}){
 if(!root.exists||!pub.exists)fail('bucket-room-missing');
 const top=root.data(),publicData=pub.data();
 if([top,publicData].some(d=>has(d,'bucketMigration')||has(d,'deletionStatus')))fail('bucket-completion-fenced');
 let base,m;try{base=JSON.parse(top.data);m=B.context(top,base);}catch{fail('bucket-context');}
 if(m.code!==root.id||base.cloudCode!==root.id||m.courtCount>32||expected&&(expected.roomId!==m.roomId||expected.epoch!==m.epoch))fail('bucket-room-changed');
 const born=identity(root),snaps=await Promise.all(Array.from({length:m.bucketCount},(_,i)=>tx.get(root.ref.collection('matchBuckets').doc('court-'+(i+1)))));
 if(snaps.some(s=>!s.exists||s.createTime.seconds<root.createTime.seconds||s.createTime.seconds===root.createTime.seconds&&s.createTime.nanoseconds<root.createTime.nanoseconds))fail('bucket-room-changed');
 const docs=snaps.map(s=>s.data());if(Buffer.byteLength(JSON.stringify([top,publicData,...docs]))>5000000)fail('bucket-read-size-budget');
 let state;try{state=B.materialize(base,m,docs);}catch(e){fail(e.message);}
 for(const match of state.matches){const original=base.matches.find(x=>x.id===match.id);if(!original||['bracket','round','indexInRound','seq'].some(k=>original[k]!==match[k])||!!original.isBye!==!!match.isBye)fail('bucket-structure-stale');}
 const versions=Object.fromEntries(docs.map(b=>[b.bucketId,b.revision]));
 const vector=publicData.scoreBucketProjection;
 if(vector?.epoch!==m.epoch||Object.keys(vector.versions||{}).length!==m.bucketCount||Object.entries(versions).some(([k,v])=>!Number.isSafeInteger(vector.versions[k])||vector.versions[k]<0||vector.versions[k]>v))fail('bucket-public-context');
 if((top.qrCheckinManaged===true)!==(publicData.qrCheckinManaged===true)||top.qrCheckinManaged===true&&(!Number.isSafeInteger(top.qrCheckinRevision)||top.qrCheckinRevision<1||publicData.qrCheckinRevision!==top.qrCheckinRevision))fail('bucket-qr-mirror-stale');
 return {top,publicData,state,m,versions,sourceCreatedAt:born};
}
function completed(input,{required=false}={}){
 const {top,publicData:pub,state,m,versions,sourceCreatedAt}=input;
 const ranked=has(top,'bucketSettlement'),general=has(top,'bucketCompletion');
 if(ranked&&general)fail('bucket-completion-requires-review');
 if(!ranked&&!general){if(required||has(pub,'bucketCompletion')||has(pub,'bucketSettlement')||pub.archiveStatus==='completed'||pub.ladderPointsAwarded===true||top.archiveStatus==='completed'||state.archiveStatus==='completed'||top.ladderPointsAwarded===true||state.ladderPointsAwarded===true)fail('bucket-completion-requires-review');return false;}
 const key=ranked?'bucketSettlement':'bucketCompletion',c=top[key],receipt={version:1,status:'completed',epoch:m.epoch,versions,completedAt:c?.completedAt};
 if(c?.version!==1||c.status!=='completed'||c.epoch!==m.epoch||c.sourceCreatedAt!==sourceCreatedAt||!equal(c.versions,versions)||c.stateDigest!==digest(state)||!Number.isSafeInteger(c.completedAt)||c.completedAt<=0||state.settlementCompletedAt!==c.completedAt||top.archiveStatus!=='completed'||pub.archiveStatus!=='completed'||state.archiveStatus!=='completed'||state.settlementPhase!=='completed'||!equal(pub[key],receipt)||!equal(pub.scoreBucketProjection,{epoch:m.epoch,versions}))fail('bucket-completion-requires-review');
 if(ranked&&(top.ladderMode!=='ranked'||state.meta?.ladderMode!=='ranked'||top.ladderPointsAwarded!==true||state.ladderPointsAwarded!==true||top.ladderSeasonId!==state.ladderSeasonId||!Array.isArray(top.ladderResults)||top.ladderResults.length<2||!equal(top.ladderResults,state.ladderResults)||!equal(top.ladderSkippedPlayers,state.ladderSkippedPlayers)))fail('bucket-completion-requires-review');
 if(general&&(top.ladderMode!=='general'||state.meta?.ladderMode!=='general'||top.ladderPointsAwarded===true||state.ladderPointsAwarded===true||state.settlementRoute!=='no-ladder'))fail('bucket-completion-requires-review');
 return {key,receipt};
}
module.exports={has,marked,load,completed,digest,equal,fail,identity};
