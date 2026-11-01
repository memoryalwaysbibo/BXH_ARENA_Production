'use strict';
const B=require('../../referee-seats/functions/bucket-state.cjs');
function fixture(code='BXH-TRUST1',count=6,bracket=true){
 const match=(id,station,index,a,b,round=0)=>({id,station,round,indexInRound:index,seq:index+round*2,bracket:'SE',a:a?{type:'player',playerId:a}:null,b:b?{type:'player',playerId:b}:null,scoreA:0,scoreB:0,log:[],faultActions:[],completed:false,status:round?'pending':'in_progress',refereeSeatScoreRevision:0});
 const matches=bracket?[match('m1',1,0,'a','b'),match('m2',5,1,'c','d'),match('final',5,0,null,null,1)]:Array.from({length:count},(_,i)=>match('m'+(i+1),i+1,i,'a'+i,'b'+i));
 const players=bracket?['a','b','c','d']:matches.flatMap(m=>[m.a.playerId,m.b.playerId]);
 const state={id:'room-'+code,cloudCode:code,meta:{eventAuthority:'official',formatType:'single',stations:count,scoringMode:'standard'},bracketSize:bracket?4:2**Math.ceil(Math.log2(count*2)),startedAt:1,players:players.map(id=>({id,name:id})),matches,courtAssignments:{court1:{currentMatchId:'m1',nextMatchId:null,status:'in_progress'},court5:{currentMatchId:'m2',nextMatchId:'final',status:'in_progress'}}};
 const room={createdBy:'host',eventAuthority:'official',data:JSON.stringify(state),updatedAt:1,assignedStaffUids:Array.from({length:count},(_,i)=>'ref'+(i+1)),refereeSeatsV1:{version:1,courts:Object.fromEntries(Array.from({length:count},(_,i)=>[String(i+1),{revision:1,main:{uid:'ref'+(i+1)},backup1:null,backup2:null}]))}};
 room.scoreStorage=B.makeManifest(state,'lab-epoch-1');
 return {state,room,user:{active:true,role:'staff',realName:'測試裁判'}};
}
function request(state,room,id,action,operationId,extra={}){
 const m=state.matches.find(x=>x.id===id);
 return {code:state.cloudCode,action,matchId:id,station:m.station,operationId,expectedCourtRevision:room.refereeSeatsV1.courts[m.station].revision,expectedScoreRevision:m.refereeSeatScoreRevision||0,expectedDispatchRevision:m.dispatchRevision||0,playerAId:m.a?.playerId,playerBId:m.b?.playerId,...extra};
}
module.exports={fixture,request};
