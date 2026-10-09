(function(root){
'use strict';
const ENV='arena-internal',VERSION='arena-pk-4pt-v1',POINTS={extreme:3,knockout:2,burst:2,spin:1};
const id=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(v);
const time=v=>Number.isSafeInteger(v)&&v>0;
const fail=reason=>{throw Error(reason);};
// Called only on the authenticated same-project ledger response, never on uploaded JSON.
function record(row,uid){
 if(!row||row.environment!==ENV||row.schemaVersion!==1||!id(row.challengeId)||!id(uid)||row.playerUid!==uid||!Number.isSafeInteger(row.sourceRevision)||row.sourceRevision<1||!time(row.updatedAt))fail('ledger-source-invalid');
 const key='pk:'+ENV+':'+row.challengeId,game=row.game;
 if(!game||!Number.isSafeInteger(game.number)||game.number<1||game.number>100)fail('ledger-game-invalid');
 const base={sourceType:'hunter-clash',sourceEnvironment:ENV,adapterVersion:'arena-pk-hunter-v1',sourceSchemaVersion:1,eventCode:key,matchId:'game:'+game.number,sourceRevision:row.sourceRevision,updatedAt:row.updatedAt,playerId:uid,completed:row.completed===true,isBye:false};
 if(row.completed===false)return {...base,analyzable:false,tombstone:true};
 if(row.completed!==true||row.certificationSource!=='SELF'||row.rules?.version!==VERSION||row.rules.targetScore!==4||!time(row.confirmedAt)||!Array.isArray(row.participants)||row.participants.length!==2||row.participants[0]===row.participants[1]||!row.participants.every(id)||!row.participants.includes(uid)||new Set(row.confirmedBy||[]).size!==2||!row.participants.every(p=>row.confirmedBy.includes(p)))fail('ledger-completion-invalid');
 const index=row.participants.indexOf(uid),opponent=row.participants[1-index],score=game.score;
 if(!score||!Number.isSafeInteger(score.a)||!Number.isSafeInteger(score.b)||Math.min(score.a,score.b)<0||Math.max(score.a,score.b)<4||Math.min(score.a,score.b)>=4||game.winnerUid!==row.participants[score.a>score.b?0:1]||!time(game.startedAt)||!time(game.endedAt)||game.endedAt<game.startedAt||row.confirmedAt<game.endedAt)fail('ledger-score-invalid');
 const reward=row.practiceXp;
 if(reward&&(reward.version!=='arena-practice-xp-v1'||!Number.isSafeInteger(reward.units)||reward.units<0||reward.units>10||reward.xp!==reward.units/2||reward.revoked))fail('ledger-xp-invalid');
 const common={...base,...(reward?{practiceXp:reward}:{}),scoringVersion:VERSION,sourceRulesVersion:VERSION,certificationSource:'SELF',ratingStatus:'not_awarded',eventName:'獵人交鋒',eventDate:new Date(game.endedAt).toISOString().slice(0,10),round:game.number,ladderMode:'general',isWin:game.winnerUid===uid,playerName:row.names?.[uid]||'未設定名稱',opponent:{playerId:opponent,uid:opponent,name:row.names?.[opponent]||'未設定名稱'},scoreFor:score[index===0?'a':'b'],scoreAgainst:score[index===0?'b':'a'],completedAt:game.endedAt,matchStartedAt:game.startedAt,confirmedAt:row.confirmedAt,resultMethod:'round_score',corrections:game.corrections||[]};
 let reason=null,totals={a:0,b:0},seen=new Set();const events=[];
 if(!Array.isArray(game.rounds)||!game.rounds.length)reason='missing-rounds';
 else for(const [seq,r]of game.rounds.entries()){
   if(!r||!row.participants.includes(r.winnerUid)||!Object.hasOwn(POINTS,r.finish)||r.points!==POINTS[r.finish]||!Number.isSafeInteger(r.roundRevision)||r.roundRevision<1||seen.has(r.roundRevision)||Math.max(totals.a,totals.b)>=4){reason='invalid-round';break;}
   seen.add(r.roundRevision);totals[r.winnerUid===row.participants[0]?'a':'b']+=r.points;
   events.push({eventId:key+':game:'+game.number+':revision:'+r.roundRevision,seq:seq+1,type:r.finish,perspective:r.winnerUid===uid?'for':'against',points:r.points,sourceRevision:r.roundRevision});
 }
 if(!reason&&(totals.a!==score.a||totals.b!==score.b))reason='round-score-mismatch';
 return {...common,analyzable:!reason,dataTrust:reason?'round-incomplete':'complete-round',analysisExcludedReason:reason,roundsPerspective:reason?[]:events};
}
function latest(records){
 const map=new Map();
 for(const r of records){const key=r.eventCode+'|'+r.matchId,prev=map.get(key);if(!prev||r.sourceRevision>prev.sourceRevision)map.set(key,r);else if(r.sourceRevision===prev.sourceRevision&&JSON.stringify(r)!==JSON.stringify(prev))fail('ledger-revision-conflict');}
 return [...map.values()].filter(r=>r.completed===true&&!r.tombstone);
}
function adapt(rows,uid){return latest(rows.map(r=>record(r,uid)));}
const api=Object.freeze({ENV,VERSION,POINTS,record,latest,adapt});
if(typeof module==='object'&&module.exports)module.exports=api;else root.BXHArenaPKAdapter=api;
})(typeof globalThis==='object'?globalThis:this);
