'use strict';
const {fixture}=require('./trusted-fixture.cjs');
function roomFixture(code,count){const f=fixture(code,count,false);for(const m of f.state.matches)if(m.station!==1)m.status='pending';f.state.courtAssignments=Object.fromEntries(f.state.matches.map(m=>['court'+m.station,{currentMatchId:m.id,nextMatchId:null,status:'in_progress'}]));f.room.data=JSON.stringify(f.state);return f;}
function command({room,state},action,matchId,operationId,extra={}){
 const m=state.matches.find(m=>m.id===matchId),other=state.matches.find(m=>m.id===(extra.targetMatchId||state.courtAssignments?.['court'+extra.targetStation]?.currentMatchId));
 return {code:state.cloudCode,operationId,action,matchId:matchId||null,station:m?.station||extra.station||0,expectedCourtRevisions:Object.fromEntries(Object.entries(room.refereeSeatsV1.courts).map(([n,c])=>[n,c.revision])),expectedScoreRevision:m?.refereeSeatScoreRevision||0,expectedDispatchRevision:m?.dispatchRevision||0,playerAId:m?.a?.playerId||null,playerBId:m?.b?.playerId||null,expectedTargetCurrentMatchId:state.courtAssignments?.['court'+extra.targetStation]?.currentMatchId||null,expectedTargetScoreRevision:other?.refereeSeatScoreRevision||0,expectedTargetDispatchRevision:other?.dispatchRevision||0,targetPlayerAId:other?.a?.playerId||null,targetPlayerBId:other?.b?.playerId||null,...extra};
}
module.exports={roomFixture,command};
