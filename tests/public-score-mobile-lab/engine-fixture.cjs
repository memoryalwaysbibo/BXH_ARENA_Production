'use strict';
const S=require('../../referee-seats/functions/scoring-core.cjs'),{createEngine}=require('../../referee-seats/functions/engine/index.cjs');
const {validate}=require('./public-schema.cjs');
function fixture(){
 const state={id:'demo-engine96',cloudCode:'BXH-DEMO96',meta:{eventAuthority:'official',formatType:'single',stations:6,scoringMode:'standard',ladderMode:'ranked'},players:Array.from({length:96},(_,i)=>({id:'demo-p'+i,name:'Demo '+i})),matches:[],courtAssignments:{},startedAt:null};
 const engine=createEngine(state,{uid:'demo-ref',name:'Demo referee'},1000,'demo-draw','demo-seed96');if(!engine.generateSingleElim())throw Error('draw-failed');state.startedAt=1001;engine.rebuildPropagationForState(state);
 const room={createdBy:'demo-host',eventAuthority:'official',assignedStaffUids:['demo-ref'],refereeSeatsV1:{version:1,courts:Object.fromEntries(Array.from({length:6},(_,i)=>[i+1,{revision:1,main:{uid:'demo-ref'}}]))}};
 let seq=0;const user={active:true,role:'staff',realName:'Demo referee'};
 const projection=()=>validate(S.publicProjection(state,{meta:{stations:6},players:state.players}));
 function request(action,id,extra={}){const m=state.matches.find(x=>x.id===id);if(!m)throw Error('missing-match');return {action,matchId:id,station:m.station,operationId:'demo-op-'+(++seq),expectedCourtRevision:room.refereeSeatsV1.courts[m.station].revision,expectedScoreRevision:m.refereeSeatScoreRevision||0,expectedDispatchRevision:m.dispatchRevision||0,playerAId:m.a?.playerId,playerBId:m.b?.playerId,...extra};}
 function run(action,id,extra={}){const out=S.transition({room,state,user,uid:'demo-ref',d:request(action,id,extra),now:2000+seq});state.updatedAt=2000+seq;return out;}
 const current=()=>Object.values(state.courtAssignments).map(c=>state.matches.find(m=>m.id===c.currentMatchId)).filter(m=>m&&!m.completed&&m.a?.playerId&&m.b?.playerId);
 return {state,room,user,projection,request,run,current};
}
module.exports={fixture};
