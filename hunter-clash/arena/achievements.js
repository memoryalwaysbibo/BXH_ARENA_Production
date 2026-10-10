(function(root){
'use strict';
const VERSION='arena-pk-achievements-v1';
const definitions=[['first','初次交鋒',1,'matches'],['rookie','交鋒新秀',10,'matches'],['veteran','百戰獵人',100,'matches'],['friends','廣結戰友',5,'opponents']];
const valid=n=>Number.isSafeInteger(n)&&n>=0;
function daily(data,uid,day){
 if(!data)return {version:VERSION,uid,day,total:0,opponents:{}};
 if(data.version!==VERSION||data.uid!==uid||data.day!==day||!valid(data.total)||!data.opponents||Array.isArray(data.opponents)||Object.entries(data.opponents).some(([k,n])=>!k.startsWith('u_')||!valid(n))||Object.values(data.opponents).reduce((a,n)=>a+n,0)!==data.total)throw Error('ledger-achievement-invalid');
 return JSON.parse(JSON.stringify(data));
}
function award(state,opponent){
 const k='u_'+opponent;state.total++;state.opponents[k]=(state.opponents[k]||0)+1;
 const entry={version:VERSION,day:state.day,dayOrdinal:state.total,opponentOrdinal:state.opponents[k]};
 entry.counted=entry.dayOrdinal<=10&&entry.opponentOrdinal<=6;
 if(!valid(entry.dayOrdinal)||!valid(entry.opponentOrdinal))throw Error('ledger-achievement-invalid');
 return entry;
}
function validate(entry,confirmedAt){
 if(!entry)return true;
 return entry.version===VERSION&&typeof entry.counted==='boolean'&&valid(entry.dayOrdinal)&&entry.dayOrdinal>0&&valid(entry.opponentOrdinal)&&entry.opponentOrdinal>0&&entry.opponentOrdinal<=entry.dayOrdinal&&entry.counted===(entry.dayOrdinal<=10&&entry.opponentOrdinal<=6)&&entry.day===new Date(confirmedAt+8*3600000).toISOString().slice(0,10);
}
function summarize(records){
 const seen=new Set(),opponents=new Set();let matches=0;
 for(const r of records){
  if(!r.completed||r.tombstone||r.sourceType!=='hunter-clash'||!r.analyzable)continue;
  const e=r.pkAchievement;if(!validate(e,r.confirmedAt))throw Error('ledger-achievement-invalid');
  if(!e?.counted)continue;
  const key=r.eventCode+'|'+r.matchId;if(seen.has(key))continue;seen.add(key);
  matches++;opponents.add(r.opponent.uid);
 }
 const counts={matches,opponents:opponents.size};
 return {version:VERSION,...counts,badges:definitions.map(([id,name,target,metric])=>({id,name,target,metric,current:counts[metric],unlocked:counts[metric]>=target}))};
}
const api=Object.freeze({VERSION,daily,award,validate,summarize});
if(typeof module==='object'&&module.exports)module.exports=api;else root.BXHPKAchievements=api;
})(globalThis);
