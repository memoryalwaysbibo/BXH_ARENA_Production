(function(root,factory){
  const api=factory();
  if(typeof module!=="undefined"&&module.exports)module.exports=api;
  if(root)root.BXHDoubleElim=Object.assign(root.BXHDoubleElim||{},api);
})(typeof window!=="undefined"?window:globalThis,function(){
  "use strict";

  function player(id){return id?{status:"player",playerId:String(id)}:{status:"unknown"};}
  function dead(){return {status:"dead"};}
  function pending(){return {status:"pending"};}
  function unknown(){return {status:"unknown"};}

  function sourceEdges(match){
    const src=match&&match.lbSrc;
    if(!src)return null;
    if(src.type==="first")return [
      {matchId:src.srcAId,kind:"loser"},
      {matchId:src.srcBId,kind:"loser"}
    ];
    if(src.type==="merge")return [
      {matchId:src.survivorMatchId,kind:"winner"},
      {matchId:src.dropperMatchId,kind:"loser"}
    ];
    if(src.type==="combine")return [
      {matchId:src.srcAMatchId,kind:"winner"},
      {matchId:src.srcBMatchId,kind:"winner"}
    ];
    return null;
  }

  function resolver(matches){
    const byId=new Map((matches||[]).filter(m=>m&&m.id).map(m=>[String(m.id),m]));
    const memo=new Map(),visiting=new Set();
    function output(matchId,kind){
      if(!matchId)return dead();
      const key=String(matchId)+"|"+kind;
      if(memo.has(key))return memo.get(key);
      if(visiting.has(key))return unknown();
      const match=byId.get(String(matchId));
      if(!match)return dead();
      visiting.add(key);
      let result;
      if(match.completed===true){
        const id=kind==="winner"?match.winnerId:match.loserId;
        result=id?player(id):(match.isBye===true||match.structuralVoid===true?dead():unknown());
      }else if(match.bracket==="LB"){
        const edges=sourceEdges(match);
        if(!edges)result=unknown();
        else{
          const sides=edges.map(edge=>output(edge.matchId,edge.kind));
          if(sides.some(side=>side.status==="unknown"))result=unknown();
          else if(sides.some(side=>side.status==="pending"))result=pending();
          else{
            const players=sides.filter(side=>side.status==="player");
            if(players.length===2)result=pending();
            else if(players.length===1)result=kind==="winner"?player(players[0].playerId):dead();
            else result=dead();
          }
        }
      }else result=pending();
      visiting.delete(key);memo.set(key,result);return result;
    }
    return output;
  }

  function sourceInputs(matches,match){
    const edges=sourceEdges(match);
    if(!edges)return [unknown(),unknown()];
    const output=resolver(matches);
    return edges.map(edge=>output(edge.matchId,edge.kind));
  }

  function classifyInputs(inputs){
    const sides=Array.isArray(inputs)?inputs:[];
    if(sides.length!==2||sides.some(side=>!side||side.status==="unknown"))return "unknown";
    if(sides.some(side=>side.status==="pending"))return "waiting";
    const count=sides.filter(side=>side.status==="player").length;
    if(count===2)return "play";
    if(count===1&&sides.some(side=>side.status==="dead"))return "bye";
    if(sides.every(side=>side.status==="dead"))return "void";
    return "waiting";
  }

  function schedulePhase(match,matches){
    if(!match)return Number.MAX_SAFE_INTEGER;
    if(match.bracket==="WB")return match.round===0?0:3*Number(match.round)-1;
    if(match.bracket==="LB"){
      const round=Number(match.round)||0;
      return round===0?1:round+Math.floor((round+1)/2)+1;
    }
    const base=(matches||[]).filter(m=>m&&["WB","LB"].includes(m.bracket))
      .reduce((max,m)=>Math.max(max,schedulePhase(m,[])),-1)+1;
    if(match.bracket==="GF")return base;
    if(match.bracket==="GFR")return base+1;
    return Number.MAX_SAFE_INTEGER;
  }

  function resequence(matches){
    const ordered=(matches||[]).slice().sort((a,b)=>{
      const phaseDiff=schedulePhase(a,matches)-schedulePhase(b,matches);
      if(phaseDiff)return phaseDiff;
      return (Number(a.indexInRound)||0)-(Number(b.indexInRound)||0);
    });
    ordered.forEach((match,index)=>{match.seq=index;});
    return ordered;
  }

  function isPhaseOpen(matches,match){
    if(!match||!["WB","LB","GF","GFR"].includes(match.bracket))return true;
    const open=(matches||[]).filter(m=>m&&["WB","LB","GF","GFR"].includes(m.bracket)&&m.completed!==true&&m.isBye!==true);
    if(!open.length)return true;
    const earliest=Math.min(...open.map(m=>schedulePhase(m,matches)));
    return schedulePhase(match,matches)===earliest;
  }

  function placements(matches,gfMatchId){
    const byId=new Map((matches||[]).filter(m=>m&&m.id).map(m=>[String(m.id),m]));
    const gf=gfMatchId?byId.get(String(gfMatchId)):null;
    const lbFinal=gf&&gf.gfSrc&&gf.gfSrc.lbFinalId?byId.get(String(gf.gfSrc.lbFinalId)):null;
    if(!lbFinal||lbFinal.completed!==true||!lbFinal.loserId)return {thirdId:null,fourthId:null};
    let fourthId=null;
    const src=lbFinal.lbSrc;
    if(src&&src.type==="merge"){
      const previous=src.survivorMatchId?byId.get(String(src.survivorMatchId)):null;
      if(previous&&previous.completed===true&&!previous.isBye&&previous.loserId)fourthId=String(previous.loserId);
    }else if(src&&src.type==="combine"){
      const candidates=[src.srcAMatchId,src.srcBMatchId].map(id=>id?byId.get(String(id)):null)
        .filter(m=>m&&m.completed===true&&!m.isBye&&m.loserId)
        .sort((a,b)=>(Number(b.seq)||0)-(Number(a.seq)||0));
      if(candidates[0])fourthId=String(candidates[0].loserId);
    }
    return {thirdId:String(lbFinal.loserId),fourthId};
  }

  return {sourceEdges,sourceInputs,classifyInputs,schedulePhase,resequence,isPhaseOpen,placements};
});
