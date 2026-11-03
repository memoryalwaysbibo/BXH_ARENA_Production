'use strict';
const {createHash}=require('node:crypto');
const Court=require('./court-call-core');
const Life=require('./team-life-core');
const Progress=require('./team-progression-core');
const fingerprint=d=>createHash('sha256').update(JSON.stringify(d)).digest('hex');

function createTeamScoringService(db,clock=Date.now){return async req=>{
  const uid=req.auth?.uid,d=req.data||{},code=String(d.code||'').toUpperCase();
  if(!uid)throw Error('auth-required');
  if(!/^BXH-[A-Z0-9]{4,16}$/.test(code))throw Error('invalid-code');
  if(!['view','score'].includes(d.action)||typeof d.matchId!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(d.matchId))throw Error('invalid-action');
  if(d.action==='score'&&!/^[A-Za-z0-9_-]{8,100}$/.test(d.operationId||''))throw Error('invalid-operation');
  const room=db.doc('tournaments/'+code),publicRoom=db.doc('publicTournaments/'+code),matchState=room.collection('teamMatchStates').doc(d.matchId),
    lineup=room.collection('teamLineups').doc(d.matchId),
    op=d.action==='score'?matchState.collection('operations').doc(fingerprint(uid+':'+d.operationId)):null;
  return db.runTransaction(async tx=>{
    const refs=[db.doc('users/'+uid),room,lineup,matchState,publicRoom,...(op?[op]:[])];
    const snaps=await Promise.all(refs.map(ref=>tx.get(ref)));
    const user=snaps[0].data(),t=snaps[1].data(),orders=snaps[2].data(),prior=snaps[3].data();
    if(!Court.active(user))throw Error('account-inactive');
    if(!t)throw Error('event-not-found');
    let state;try{state=typeof t.data==='string'?JSON.parse(t.data):t.data;}catch{throw Error('invalid-tournament');}
    if(state?.meta?.battleMode!=='team')throw Error('team-mode-required');
    if(Court.tester(user)&&!Court.testerSandbox(state,uid))throw Error('permission-denied');
    const match=(state.matches||[]).find(m=>m.id===d.matchId);
    if(!match||match.isBye||!Array.isArray(match.teamIds)||match.teamIds.length!==2||new Set(match.teamIds).size!==2)throw Error('invalid-match');
    const referee=Court.canReferee(user,uid,t,state,match.station);
    if(d.action==='score'&&!referee)throw Error('referee-required');
    const requestHash=fingerprint({winnerSide:d.winnerSide,finish:d.finish,matchId:d.matchId});
    if(d.action==='score'&&snaps[5].exists){
      const storedOperation=snaps[5].data();
      if(storedOperation.requestHash!==requestHash)throw Error('operation-conflict');
      let storedResult=storedOperation.result;
      if(typeof storedOperation.resultJson==='string'){
        try{storedResult=JSON.parse(storedOperation.resultJson);}catch{throw Error('invalid-operation-state');}
      }
      if(!storedResult||typeof storedResult!=='object')throw Error('invalid-operation-state');
      return {...storedResult,replayed:true};
    }
    if(match.completed)throw Error('match-completed');
    if(!orders?.lineupsRevealed||!match.teamIds.every(id=>Array.isArray(orders.lineups?.[id])))throw Error('lineups-incomplete');
    if(!state.startedAt||t.systemClosed||state.archiveStatus==='completed')throw Error('event-not-live');
    if(prior&&JSON.stringify(prior.teamIds)!==JSON.stringify(match.teamIds))throw Error('stale-match');
    let storedGame=prior?.game;
    if(typeof prior?.gameJson==='string'){
      try{storedGame=JSON.parse(prior.gameJson);}catch{throw Error('invalid-game-state');}
    }
    const initial=storedGame||Life.startTeamMatch(match.teamIds.map(id=>orders.lineups[id]));
    if(d.action==='view')return {ok:true,teamIds:match.teamIds,game:initial,isReferee:referee};
    const game=Life.applyRound(initial,d.winnerSide,d.finish);
    const result={ok:true,teamIds:match.teamIds,game,matchCompleted:game.winner!==null};
    const pub=snaps[4].data();
    if(!pub||typeof pub.bracketView!=='string')throw Error('public-mirror-missing');
    const priorLiveGames=pub.teamLiveGames&&typeof pub.teamLiveGames==='object'?pub.teamLiveGames:{};
    const publicPatch={teamLiveGames:{...priorLiveGames,[d.matchId]:JSON.stringify(game)},updatedAt:clock()};
    if(game.winner!==null){
      let mirror;try{mirror=JSON.parse(pub.bracketView);}catch{throw Error('public-mirror-invalid');}
      if(!mirror||!Array.isArray(mirror.matches))throw Error('public-mirror-invalid');
      const updated=Progress.finishMatch(state,d.matchId,game.winner,clock(),game);
      const publicMatch=mirror.matches.find(m=>m.id===d.matchId);
      if(!publicMatch||publicMatch.completed)throw Error('public-mirror-stale');
      mirror.matches=updated.matches.map(m=>{
        const old=mirror.matches.find(x=>x.id===m.id);
        if(!old&&m.id!==updated.gfResetMatchId)throw Error('public-mirror-stale');
        return {...(old||{id:m.id,seq:m.seq,bracket:m.bracket,round:m.round,indexInRound:m.indexInRound,station:m.station,isBye:false}),
          teamIds:m.teamIds.slice(),winnerId:m.winnerId||null,loserId:m.loserId||null,
          scoreA:m.scoreA||0,scoreB:m.scoreB||0,completed:!!m.completed,status:m.status||'pending',completedAt:m.completedAt||null};
      });
      mirror.championId=updated.championId||null;mirror.runnerUpId=updated.runnerUpId||null;
      mirror.currentMatchId=updated.currentMatchId;
      mirror.teamResultRevision=updated.teamResultRevision;
      mirror.teamStandings=updated.teamStandings||null;
      mirror.gfResetMatchId=updated.gfResetMatchId||null;
      tx.update(room,{data:JSON.stringify(updated),updatedAt:clock()});
      publicPatch.bracketView=JSON.stringify(mirror);
      result.winnerTeamId=updated.matches.find(m=>m.id===d.matchId).winnerId;
      result.nextMatchId=updated.currentMatchId;
    }
    tx.update(publicRoom,publicPatch);
    // Firestore rejects nested arrays. Team games contain lineups/life as arrays of arrays,
    // so persist them as JSON while keeping the callable response as the normal object shape.
    tx.set(matchState,{teamIds:match.teamIds,gameJson:JSON.stringify(game),updatedAt:clock(),updatedBy:uid});
    tx.set(op,{requestHash,resultJson:JSON.stringify(result),actorUid:uid,at:clock()});
    return result;
  });
};}
module.exports={createTeamScoringService};
