'use strict';
const clone=x=>JSON.parse(JSON.stringify(x));
const schema='bxh-match-buckets-v1';
function route(station,count){
 if(!Number.isSafeInteger(station)||station<1||station>count)throw Error('invalid-station');
 return 'court-'+Math.ceil(station/4);
}
function context(room,state){
 const m=room.scoreStorage,count=Number(state.meta?.stations);
 if(m?.schema!==schema||m.status!=='active'||typeof m.epoch!=='string'||!m.epoch||m.roomId!==state.id||m.code!==state.cloudCode||!Number.isSafeInteger(count)||count<1||m.courtCount!==count||m.bucketCount!==Math.ceil(count/4))throw Error('bucket-not-ready');
 return m;
}
function makeManifest(state,epoch){return {schema,status:'active',epoch,roomId:state.id,code:state.cloudCode,courtCount:state.meta.stations,bucketCount:Math.ceil(state.meta.stations/4)};}
function encode(state,m,previous=[]){
 const old=new Map(previous.map(b=>[b.bucketId,b]));
 return Array.from({length:m.bucketCount},(_,i)=>{
  const bucketId='court-'+(i+1),matches=JSON.stringify(state.matches.filter(x=>Number(x.station)>0&&route(Number(x.station),m.courtCount)===bucketId));
  const before=old.get(bucketId),revision=before?before.revision+(before.matches===matches?0:1):0;
  return {schema,code:m.code,roomId:m.roomId,epoch:m.epoch,bucketId,revision,matches};
 });
}
function materialize(base,m,buckets,partialId=null){
 const expected=partialId?[partialId]:Array.from({length:m.bucketCount},(_,i)=>'court-'+(i+1));
 if(buckets.length!==expected.length)throw Error('bucket-missing');
 const state=clone(base),seen=new Set(),replacements=new Map();
 for(const bucket of buckets){
  if(!bucket||bucket.schema!==schema||bucket.code!==m.code||bucket.roomId!==m.roomId||bucket.epoch!==m.epoch||!expected.includes(bucket.bucketId)||seen.has(bucket.bucketId)||!Number.isSafeInteger(bucket.revision)||bucket.revision<0)throw Error('bucket-context');
  seen.add(bucket.bucketId);let rows;try{rows=JSON.parse(bucket.matches);}catch{throw Error('bucket-corrupt');}
  if(!Array.isArray(rows))throw Error('bucket-corrupt');
  const originals=state.matches.filter(x=>Number(x.station)>0&&route(Number(x.station),m.courtCount)===bucket.bucketId);
  if(rows.length!==originals.length)throw Error('bucket-match-set');
  for(const match of rows){
   const original=originals.find(x=>x.id===match.id);
   if(!original||replacements.has(match.id)||original.station!==match.station||route(Number(match.station),m.courtCount)!==bucket.bucketId||!Number.isSafeInteger(Number(match.refereeSeatScoreRevision||0))||Number(match.refereeSeatScoreRevision||0)<0)throw Error('bucket-match-set');
   if((original.a?.playerId||null)!==(match.a?.playerId||null)||(original.b?.playerId||null)!==(match.b?.playerId||null)||Number(original.dispatchRevision||0)!==Number(match.dispatchRevision||0)||!!original.completed!==!!match.completed)throw Error('bucket-structure-stale');
   replacements.set(match.id,match);
  }
 }
 state.matches=state.matches.map(x=>replacements.get(x.id)||x);
 for(const court of Object.values(state.courtAssignments||{})){
  const current=state.matches.find(x=>x.id===court.currentMatchId);
  if(current&&!current.completed)court.status=current.status||'pending';
 }
 return state;
}
module.exports={schema,route,context,makeManifest,encode,materialize};
