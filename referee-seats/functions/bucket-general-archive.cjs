'use strict';
// General rooms have no ladder transaction. Close them in the same trusted
// transaction as their last confirmation, without a legacy whole-room upload.
function archiveGeneral(room,state,now){
 if(room.eventAuthority!=='official'||state.meta?.eventAuthority!=='official'||room.ladderMode!=='general'||state.meta.ladderMode!=='general'||state.meta.formatType!=='single')return null;
 if(!state.championId||!state.runnerUpId||state.championId===state.runnerUpId||!Array.isArray(state.matches)||!state.matches.length||state.matches.some(m=>!m.isBye&&m.completed!==true))return null;
 const se=state.matches.filter(m=>m.bracket==='SE'),max=Math.max(...se.map(m=>Number(m.round))),finals=se.filter(m=>m.round===max);
 if(finals.length!==1||finals[0].isBye||finals[0].winnerId!==state.championId||finals[0].loserId!==state.runnerUpId)return null;
 const players=new Set((state.players||[]).map(p=>p.id));
 if(!players.has(state.championId)||!players.has(state.runnerUpId))return null;
 if(state.meta.bronzeMatch){
  const required=players.size>=4?[state.championId,state.runnerUpId,state.thirdId,state.fourthId]:players.size>=3?[state.championId,state.runnerUpId,state.thirdId]:[state.championId,state.runnerUpId];
  if(required.some(id=>!players.has(id))||new Set(required).size!==required.length)return null;
 }
 const runtime={archiveStatus:'completed',completedAt:state.completedAt||now,archivedAt:state.archivedAt||now,settlementPhase:'completed',settlementRoute:'no-ladder',settlementCompletedAt:now,settlementError:null,settlementErrorCode:null,ladderPointsAwarded:false};
 Object.assign(state,runtime);
 return {runtime,document:{archiveStatus:'completed',tournamentPhase:'done',registrationStatus:'closed'}};
}
module.exports={archiveGeneral};
