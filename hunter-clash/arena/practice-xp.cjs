'use strict';
// Half-XP units keep the 2.5 XP reward exact throughout the ledger.
const VERSION='arena-practice-xp-v1',DAILY_LIMIT=10;
const fail=()=>{throw Error('ledger-xp-invalid');};
const valid=v=>Number.isSafeInteger(v)&&v>=0;
function dayKey(now){if(!Number.isSafeInteger(now)||now<=0)fail();return new Date(now+8*3600000).toISOString().slice(0,10);}
function units(meta){const value=meta?.practiceXpUnits??0;if(!valid(value))fail();return value;}
function daily(data,uid,day){
 if(!data)return {uid,day,completedGames:0,earnedUnits:0,opponents:{}};
 if(data.uid!==uid||data.day!==day||!valid(data.completedGames)||!valid(data.earnedUnits)||!data.opponents||Object.values(data.opponents).some(v=>!valid(v)))fail();
 return structuredClone(data);
}
function award(state,opponent){
 state.completedGames++;state.opponents['u_'+opponent]=(state.opponents['u_'+opponent]||0)+1;
 const ordinal=state.opponents['u_'+opponent],u=state.completedGames>DAILY_LIMIT||ordinal>6?0:ordinal<=3?10:5;
 state.earnedUnits+=u;
 if(!valid(state.completedGames)||!valid(state.earnedUnits)||!valid(ordinal))fail();
 return {version:VERSION,day:state.day,dayOrdinal:state.completedGames,opponentOrdinal:ordinal,units:u,xp:u/2,reason:state.completedGames>DAILY_LIMIT?'daily-limit':ordinal>6?'opponent-limit':ordinal>3?'opponent-half':'full'};
}
function summary(meta,state,enabled){return {version:VERSION,enabled,totalXp:units(meta)/2,todayXp:state.earnedUnits/2,completedToday:state.completedGames,remainingGames:Math.max(0,DAILY_LIMIT-state.completedGames),day:state.day};}
module.exports={VERSION,DAILY_LIMIT,dayKey,units,daily,award,summary};
