(function(root){
'use strict';
const VERSION='arena-pk-achievements-v1';
const definitions=[['first','初次交鋒',1,'matches'],['rookie','交鋒新秀',10,'matches'],['veteran','百戰獵人',100,'matches'],['friends','廣結戰友',5,'opponents'],['first_win','初嚐勝果',1,'wins'],['wins_10','十勝獵人',10,'wins'],['streak_3','三連勝',3,'bestStreak'],['comeback','逆轉獵人',1,'comebacks']];
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
function comeback(r){
 if(r.isWin!==true||!Array.isArray(r.roundsPerspective))return false;
 let scoreFor=0,scoreAgainst=0,activated=false;
 for(const round of r.roundsPerspective){
  if(round.perspective==='for')scoreFor+=round.points;else if(round.perspective==='against')scoreAgainst+=round.points;
  if(scoreFor===0&&scoreAgainst===3)activated=true;
 }
 return activated;
}
function summarize(records,{evidence=false}={}){
 const proof={matches:[],wins:[],opponents:[],bestStreak:[],comebacks:[]};let streak=[];
 const seen=new Set(),opponents=new Set();let matches=0,wins=0,currentStreak=0,bestStreak=0,comebacks=0;
 const ordered=records.filter(r=>r.completed&&!r.tombstone&&r.sourceType==='hunter-clash'&&r.pkAchievement);
 for(const r of ordered)if(!validate(r.pkAchievement,r.confirmedAt))throw Error('ledger-achievement-invalid');
 // Daily ordinals come from the authoritative settlement transaction, independent of page order.
 ordered.sort((a,b)=>a.pkAchievement.day.localeCompare(b.pkAchievement.day)||a.pkAchievement.dayOrdinal-b.pkAchievement.dayOrdinal||a.eventCode.localeCompare(b.eventCode)||a.matchId.localeCompare(b.matchId));
 for(const r of ordered){
  const key=r.eventCode+'|'+r.matchId;if(seen.has(key))continue;seen.add(key);
  // An excluded loss still breaks a streak; incomplete round evidence cannot bridge one.
  if(!r.analyzable||r.isWin!==true){currentStreak=0;streak=[];}
  if(!r.analyzable||!r.pkAchievement.counted)continue;
  matches++;
  if(evidence){if(proof.matches.length<100)proof.matches.push(r);if(!opponents.has(r.opponent.uid)&&proof.opponents.length<5)proof.opponents.push(r);}
  opponents.add(r.opponent.uid);
  if(r.isWin===true){
   wins++;currentStreak++;
   if(evidence){if(proof.wins.length<10)proof.wins.push(r);if(streak.length<3)streak.push(r);if(currentStreak>bestStreak&&bestStreak<3)proof.bestStreak=[...streak];}
   bestStreak=Math.max(bestStreak,currentStreak);
   if(comeback(r)){comebacks++;if(evidence&&!proof.comebacks.length)proof.comebacks.push(r);}
  }
 }
 const counts={matches,wins,opponents:opponents.size,currentStreak,bestStreak,comebacks};
 return {version:VERSION,...counts,badges:definitions.map(([id,name,target,metric])=>({id,name,target,metric,current:counts[metric],unlocked:counts[metric]>=target,...(evidence?{evidence:['matches','wins'].includes(metric)?proof[metric].slice(Math.max(0,Math.min(counts[metric],target)-1),Math.min(counts[metric],target)):proof[metric]}:{})}))};
}
function presentation(records){
 const result=summarize(records,{evidence:true});
 result.badges=result.badges.map((badge,index)=>({...badge,index})).sort((a,b)=>Number(b.unlocked)-Number(a.unlocked)||(a.unlocked?0:b.current/b.target-a.current/a.target)||a.index-b.index);
 return result;
}
function newUnlocks(records,challengeId){
 const room=records.filter(r=>r.eventCode==='pk:arena-internal:'+challengeId&&r.completed&&!r.tombstone&&r.pkAchievement);
 if(!room.length)return [];
 const compare=(a,b)=>a.day.localeCompare(b.day)||a.dayOrdinal-b.dayOrdinal;
 const entries=room.map(r=>r.pkAchievement).sort(compare),first=entries[0],last=entries.at(-1);
 const before=summarize(records.filter(r=>r.pkAchievement&&compare(r.pkAchievement,first)<0));
 const after=summarize(records.filter(r=>r.pkAchievement&&compare(r.pkAchievement,last)<=0));
 const unlocked=new Set(before.badges.filter(b=>b.unlocked).map(b=>b.id));
 return after.badges.filter(b=>b.unlocked&&!unlocked.has(b.id));
}
const api=Object.freeze({VERSION,daily,award,validate,summarize,presentation,newUnlocks});
if(typeof module==='object'&&module.exports)module.exports=api;else root.BXHPKAchievements=api;
})(globalThis);
