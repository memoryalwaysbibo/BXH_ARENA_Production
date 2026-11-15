(function(root,factory){
 if(typeof module==='object'&&module.exports)module.exports=factory(require('../../referee-seats/functions/bucket-state.cjs'));
 else root.BXHFourCourtArchive=factory(root.BXHMatchBuckets);
})(typeof globalThis!=='undefined'?globalThis:this,function(B){
 'use strict';
 const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
 function verify({code,expected,room,publicDocument}){
  if(!expected?.roomId||!expected.epoch||!room||!publicDocument)throw Error('bucket-archive-unconfirmed');
  let state,mirror;try{state=JSON.parse(room.data);mirror=JSON.parse(publicDocument.bracketView);}catch{throw Error('bucket-archive-unconfirmed');}
  const m=B.context(room,state),v=publicDocument.scoreBucketProjection;
  if(m.code!==code||m.roomId!==expected.roomId||m.epoch!==expected.epoch||room.archiveStatus!=='completed'||publicDocument.archiveStatus!=='completed'||room.tournamentPhase!=='done'||publicDocument.tournamentPhase!=='done'||state.archiveStatus!=='completed'||mirror.archiveStatus!=='completed'||state.settlementPhase!=='completed'||!Number.isSafeInteger(state.archivedAt)||state.archivedAt<=0||!state.championId||!state.runnerUpId||state.matches.some(x=>!x.isBye&&!x.completed))throw Error('bucket-archive-unconfirmed');
  const ids=Array.from({length:m.bucketCount},(_,i)=>'court-'+(i+1));
  if(v?.epoch!==m.epoch||!v.versions||Object.keys(v.versions).length!==ids.length||ids.some(id=>!Number.isSafeInteger(v.versions[id])||v.versions[id]<0))throw Error('bucket-archive-unconfirmed');
  const score=s=>s.matches.map(x=>[x.id,x.winnerId||null,x.loserId||null,!!x.completed,x.scoreA??null,x.scoreB??null]);
  if(!equal(score(state),score(mirror))||state.championId!==mirror.championId||state.runnerUpId!==mirror.runnerUpId||state.archivedAt!==mirror.archivedAt)throw Error('bucket-archive-unconfirmed');
  if(room.ladderMode==='ranked'||state.meta.ladderMode==='ranked'){
   const a=room.bucketSettlement,b=publicDocument.bucketSettlement;
   if(room.ladderMode!=='ranked'||state.meta.ladderMode!=='ranked'||room.ladderPointsAwarded!==true||state.ladderPointsAwarded!==true||a?.version!==1||a.status!=='completed'||a.epoch!==m.epoch||!equal(a.versions,v.versions)||b?.status!=='completed'||b.epoch!==m.epoch||!equal(b.versions,v.versions)||a.completedAt!==b.completedAt)throw Error('bucket-archive-unconfirmed');
  }else if(room.ladderMode!=='general'||state.meta.ladderMode!=='general'||state.ladderPointsAwarded===true)throw Error('bucket-archive-unconfirmed');
  return {...state,scoreStorage:{...m},createdBy:room.createdBy||state.createdBy,ownerUid:room.ownerUid||state.ownerUid,createdByRole:room.createdByRole||state.createdByRole};
 }
 return {verify};
});
