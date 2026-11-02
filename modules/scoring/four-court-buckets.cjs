'use strict';
const crypto=require('node:crypto');
const WIDTH=4,ROOM=/^BXH-[A-Z0-9]{4,16}$/;
function validCount(n){return Number.isSafeInteger(n)&&n>0;}
function validScore(n){return Number.isSafeInteger(n)&&n>=0;}
function bucketForCourt(station){
 if(!validCount(station))throw Error('invalid-station');
 const index=Math.floor((station-1)/WIDTH);
 return {id:'court-'+(index+1),index,from:index*WIDTH+1,to:(index+1)*WIDTH};
}
function manifest(code,roomId,courtCount){
 if(!ROOM.test(code)||typeof roomId!=='string'||!roomId||!validCount(courtCount))throw Error('invalid-manifest');
 return {schema:'bxh-score-buckets-v1',code,roomId,width:WIDTH,courtCount,bucketCount:Math.ceil(courtCount/WIDTH)};
}
function route(m,station){
 if(m?.schema!=='bxh-score-buckets-v1'||!ROOM.test(m.code)||typeof m.roomId!=='string'||!m.roomId||!validCount(m.courtCount)||m.width!==WIDTH||m.bucketCount!==Math.ceil(m.courtCount/WIDTH)||!validCount(station)||station>m.courtCount)throw Error('invalid-route');
 return bucketForCourt(station);
}
function operationKey(uid,operationId){
 if(!uid||!/^[-a-zA-Z0-9]{16,80}$/.test(operationId))throw Error('invalid-operation');
 return crypto.createHash('sha256').update(uid+':'+operationId).digest('hex');
}
function initialBucket(m,bucket,matches){
 if(bucket.index<0||bucket.index>=m.bucketCount)throw Error('invalid-route');
 const entries={};
 for(const match of matches){
  if(!match||typeof match.id!=='string'||!match.id||!validCount(match.station))throw Error('invalid-match');
  if(route(m,match.station).id!==bucket.id)continue;
  if(Object.hasOwn(entries,match.id))throw Error('duplicate-match');
  if(!validScore(match.scoreA??0)||!validScore(match.scoreB??0))throw Error('invalid-score');
  entries[match.id]={station:match.station,scoreA:Number(match.scoreA||0),scoreB:Number(match.scoreB||0),revision:0,events:[]};
 }
 return {schema:m.schema,code:m.code,roomId:m.roomId,bucketId:bucket.id,from:bucket.from,to:Math.min(bucket.to,m.courtCount),matches:entries};
}
function applyScore(bucket,command){
 if(!bucket||bucket.schema!=='bxh-score-buckets-v1'||command?.bucketId!==bucket.bucketId)throw Error('bucket-mismatch');
 const match=bucket.matches?.[command.matchId];
 if(!match||match.station!==command.station||command.station<bucket.from||command.station>bucket.to)throw Error('match-mismatch');
 if(!validScore(match.scoreA)||!validScore(match.scoreB)||!validScore(match.revision)||!Array.isArray(match.events)||match.events.length!==match.revision)throw Error('bucket-corrupt');
 if(!Number.isSafeInteger(command.expectedRevision)||command.expectedRevision!==match.revision)throw Error('score-stale');
 if(!['A','B'].includes(command.side)||!Number.isSafeInteger(command.points)||command.points<1||command.points>3||!/^[-a-zA-Z0-9]{16,80}$/.test(command.operationId||''))throw Error('invalid-score');
 const next=structuredClone(bucket),target=next.matches[command.matchId];
 target[command.side==='A'?'scoreA':'scoreB']+=command.points;
 target.revision++;
 target.events.push({id:command.operationId,side:command.side,points:command.points});
 return {bucket:next,result:{ok:true,bucketId:bucket.bucketId,matchId:command.matchId,revision:target.revision,scoreA:target.scoreA,scoreB:target.scoreB}};
}
function compose(base,m,buckets){
 if(base?.id!==m.roomId||base.cloudCode!==m.code||!Array.isArray(base.matches)||buckets.length!==m.bucketCount)throw Error('projection-context');
 const seen=new Set(),byMatch=new Map();
 for(const b of buckets){
  if(b?.schema!==m.schema||b.code!==m.code||b.roomId!==m.roomId||seen.has(b.bucketId))throw Error('projection-bucket');
  const expected=bucketForCourt(b.from);
  if(expected.id!==b.bucketId||b.to!==Math.min(expected.to,m.courtCount))throw Error('projection-route');
  seen.add(b.bucketId);
  for(const [id,entry] of Object.entries(b.matches||{})){
   if(byMatch.has(id)||route(m,entry.station).id!==b.bucketId)throw Error('projection-match');
   if(!validScore(entry.scoreA)||!validScore(entry.scoreB)||!validScore(entry.revision)||!Array.isArray(entry.events)||entry.events.length!==entry.revision)throw Error('projection-corrupt');
   byMatch.set(id,entry);
  }
 }
 if(seen.size!==m.bucketCount)throw Error('projection-missing-bucket');
 const out=structuredClone(base);
 for(const match of out.matches){
  const entry=byMatch.get(match.id);
  if(!entry||entry.station!==match.station)throw Error('projection-match');
  match.scoreA=entry.scoreA;match.scoreB=entry.scoreB;match.scoreBucketRevision=entry.revision;
 }
 if(byMatch.size!==out.matches.length)throw Error('projection-extra-match');
 return out;
}
module.exports={WIDTH,bucketForCourt,manifest,route,operationKey,initialBucket,applyScore,compose};
