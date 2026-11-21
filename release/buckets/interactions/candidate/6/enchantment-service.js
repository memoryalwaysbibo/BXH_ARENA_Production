'use strict';
const {randomInt}=require('node:crypto');
const C=require('./court-call-core');
const round=require('./enchantment-round-core');
const score=require('./enchantment-score-core');
const completion=require('./enchantment-completion-core');
const G=require('./court-session-guard');

const codePattern=/^BXH-[A-Z0-9]{4,16}$/;
const matchPattern=/^[A-Za-z0-9_-]{1,100}$/;
function createEnchantmentService(db,clock=Date.now){
 return async request=>{
  const uid=request.auth?.uid,d=request.data||{};
  if(!uid)throw Error('auth-required');
  const code=String(d.code||'').toUpperCase();
  if(!codePattern.test(code)||!matchPattern.test(d.matchId||''))throw Error('invalid-identifier');
  if(!['get','start','draw','assistReveal','setAutoReveal','score','fault','undo','confirm'].includes(d.action))throw Error('invalid-action');
  const userRef=db.doc('users/'+uid),tourRef=db.doc('tournaments/'+code);
  const publicRef=db.doc('publicTournaments/'+code);
  const ledgerRef=tourRef.collection('enchantmentMatches').doc(d.matchId);
  return db.runTransaction(async tx=>{
   const [userSnap,tourSnap,publicSnap,ledgerSnap]=await Promise.all([
    tx.get(userRef),tx.get(tourRef),tx.get(publicRef),tx.get(ledgerRef)]);
   const profile=userSnap.data(),t=tourSnap.data();
   if(!C.active(profile))throw Error('account-inactive');
   if(!t)throw Error('event-not-found');
   if([t,publicSnap.data()].some(x=>x&&['scoreStorage','scoreBucketProjection','bucketMigration','deletionStatus'].some(k=>Object.prototype.hasOwnProperty.call(x,k))))throw Error('bucket-scoring-required');
   let s;try{s=typeof t.data==='string'?JSON.parse(t.data):t.data;}catch{throw Error('invalid-tournament');}
   if(!s||s.meta?.playMode!=='enchantment')throw Error('wrong-play-mode');
   if(s.meta.enchantmentPilot!==true||s.meta.formatType!=='single'||s.meta.bronzeMatch===true||s.meta.ladderMode==='ranked')throw Error('pilot-only');
   if(C.tester(profile)&&!C.testerSandbox(s,uid))throw Error('permission-denied');
   const m=(s.matches||[]).find(x=>x.id===d.matchId);
   if(!m||m.isBye||!m.a?.playerId||!m.b?.playerId)throw Error('match-unavailable');
   let publicState,publicMatch;
   if(!publicSnap.exists)throw Error('public-view-missing');
   try{publicState=JSON.parse(publicSnap.data().bracketView);}catch{throw Error('public-view-missing');}
   publicMatch=(publicState.matches||[]).find(x=>x.id===m.id);
   if(!publicMatch||publicMatch.a?.playerId!==m.a.playerId||publicMatch.b?.playerId!==m.b.playerId)throw Error('public-view-mismatch');
   const isRef=C.canReferee(profile,uid,t,s,m.station);
   const participants=[m.a,m.b].map(side=>(s.players||[]).find(p=>p.id===side.playerId));
   const uids=participants.map(C.playerUid);
   if(uids.some(x=>!x)||uids[0]===uids[1])throw Error('players-not-linked');
   const side=uids[0]===uid?'A':uids[1]===uid?'B':null;
   if(!side&&!isRef)throw Error('permission-denied');
   if(d.action!=='get'&&(t.systemClosed||!s.startedAt||s.archiveStatus==='completed'||s.meta?.eventCancelled))throw Error('event-not-live');
   let state=ledgerSnap.data()?.state;
   if(state&&(state.players.A!==uids[0]||state.players.B!==uids[1]))throw Error('participants-changed');
   const bound=Number(ledgerSnap.data()?.dispatchRevision||0)===G.revision(m);
   if(d.action==='get'){
    let version=ledgerSnap.data()?.version||0;
    if(m.completed&&bound)return {ok:true,version,state:state?round.view(state,isRef?'referee':side):null};
    if(!G.current(s,m)||!bound)return {ok:true,version,state:null,suspended:true};
    if(state?.phase==='drawing'&&state.autoReveal!==false&&state.revealDeadline&&clock()>=state.revealDeadline){
     const missing=['A','B'].filter(who=>!state.revealed[who]);
     if(missing.length===1){
      const revealed=round.reveal(state,state.round,missing[0],state.players[missing[0]]);
      if(!revealed.ok)throw Error(revealed.reason);
      state=revealed.state;version++;
      tx.set(ledgerRef,{...ledgerSnap.data(),version,state,updatedAt:clock(),updatedBy:'auto-reveal'});
     }
    }
    return {ok:true,version,state:state?round.view(state,isRef?'referee':side):null};
   }
   if(m.completed)throw Error('match-unavailable');
   if(!G.current(s,m))throw Error('court-session-ended');
   if(d.action==='start'){
    if(!isRef)throw Error('referee-required');
    if(G.revision(m)>0&&d.dispatchRevision!==G.revision(m))throw Error('stale-dispatch');
    if(!state){
     if(Number(m.scoreA)||Number(m.scoreB)||(m.log||[]).length)throw Error('existing-score');
     state=round.create(m.id,uids[0],uids[1]);
    }
   }
   if(d.action!=='start'&&!bound)throw Error('court-session-ended');
   if(!state)throw Error('not-started');
   if(d.action==='draw'&&!side)throw Error('player-required');
   if(['assistReveal','setAutoReveal'].includes(d.action)&&!isRef)throw Error('referee-required');
   if(['score','fault','undo','confirm'].includes(d.action)&&!isRef)throw Error('referee-required');
   if(d.action!=='start'&&(!Number.isSafeInteger(d.version)||d.version!==ledgerSnap.data()?.version))throw Error('stale-version');
   // The tournament and its public mirror must match the last confirmed
   // enchantment ledger before any result is changed. This stops stale
   // client-side standard scoring writes from overwriting an enchanted round.
   if(['score','fault','undo','confirm'].includes(d.action)){
    const expected=state.scores;
    if(Number(m.scoreA)!==expected.A||Number(m.scoreB)!==expected.B||
       Number(publicMatch.scoreA)!==expected.A||Number(publicMatch.scoreB)!==expected.B)throw Error('score-ledger-mismatch');
    const privateLog=Array.isArray(m.log)?m.log:[],publicLog=Array.isArray(publicMatch.log)?publicMatch.log:[];
    if(privateLog.length!==state.history.length||publicLog.length!==privateLog.length)throw Error('score-ledger-mismatch');
    for(let i=0;i<privateLog.length;i++){
     const event=state.history[i],row=privateLog[i],publicRow=publicLog[i];
     if(row.enchantment!==true||row.v!==2||row.eventId!==event.eventId||
        row.points!==event.points||publicRow.eventId!==row.eventId||publicRow.points!==row.points)throw Error('score-ledger-mismatch');
    }
   }
   let result;
   if(d.action==='start'){
    if(!bound&&ledgerSnap.data()?.state){
     // The court was claimed by another referee. Preserve confirmed history,
     // while rotating the ledger version so a former device cannot act again.
     if(Number(m.scoreA)!==state.scores.A||Number(m.scoreB)!==state.scores.B||
        Number(publicMatch.scoreA)!==state.scores.A||Number(publicMatch.scoreB)!==state.scores.B||
        (m.log||[]).length!==state.history.length||
        (publicMatch.log||[]).length!==state.history.length)throw Error('score-ledger-mismatch');
     const awaitingOther=state.phase==='drawing'&&state.revealed.A!==state.revealed.B&&state.autoReveal!==false;
     result={ok:true,state:{...state,revealDeadline:awaitingOther?clock()+8000:null}};
    }else result=round.start(state,true);
    if(result.ok&&result.state.phase==='drawing'&&result.state.round===1&&!result.state.cards.A&&!result.state.cards.B){
     const ids=Object.keys(score.CARDS);
     for(const target of ['A','B'])result=round.assign(result.state,1,target,ids[randomInt(ids.length)]);
    }
   }else if(d.action==='draw'){
    result=round.reveal(state,d.round,side,uid);
   }else if(d.action==='assistReveal'){
    if(!['A','B'].includes(d.target))throw Error('invalid-side');
    result=round.reveal(state,d.round,d.target,state.players[d.target]);
   }else if(d.action==='setAutoReveal'){
    if(typeof d.enabled!=='boolean')throw Error('invalid-setting');
    result={ok:true,state:{...state,autoReveal:d.enabled,revealDeadline:d.enabled&&state.phase==='drawing'&&
     (state.revealed.A!==state.revealed.B)?clock()+8000:null}};
   }else if(d.action==='score'){
    result=round.submit(state,d.round,d.winner,d.type,true);
   }else if(d.action==='fault'){
    result=round.fault(state,d.round,d.offender,true);
   }else if(d.action==='confirm'){
    result=round.confirm(state,true);
   }else result=round.undo(state,true);
   if(!result.ok)throw Error(result.reason);
   if(result.idempotent)return {ok:true,version:ledgerSnap.data().version,state:round.view(state,isRef?'referee':side),idempotent:true};
   if(['draw','assistReveal'].includes(d.action)&&result.state.phase==='drawing'&&
      result.state.autoReveal!==false&&!result.state.revealDeadline&&
      (result.state.revealed.A!==result.state.revealed.B)){
    result.state.revealDeadline=clock()+8000;
   }
   // A newly opened round is dealt before either phone can request a draw.
   // Keep the cards private in this ledger until each player reveals theirs.
   if(result.event&&result.state.phase==='drawing'){
    const ids=Object.keys(score.CARDS),nextRound=result.state.round;
    for(const target of ['A','B']){
     const dealt=round.assign(result.state,nextRound,target,ids[randomInt(ids.length)]);
     if(!dealt.ok)throw Error(dealt.reason);
     result={...result,state:dealt.state};
    }
   }
   const version=(ledgerSnap.data()?.version||0)+1,now=clock();
   let completionResult=null;
   if(d.action==='confirm'){
    completionResult=completion.completeSingle(s,publicState,m.id,state.scores,now,uid);
    if(!completionResult.ok)throw Error(completionResult.reason);
   }
   if(d.action==='score'||d.action==='fault'&&result.event){
    const event=result.event,record={v:2,enchantment:true,eventId:`${m.id}:e${state.history.length+1}`,
     seq:state.history.length+1,round:event.round,side:event.side,type:event.type,
     basePoints:event.originalPoints,points:event.points,delta:event.delta,
     appliedCardId:event.appliedCardId||null,
     winningCardId:event.winningCardId,losingCardId:event.losingCardId,t:now};
    event.eventId=record.eventId;
    for(const target of [m,publicMatch]){
     target.scoreA=result.state.scores.A;target.scoreB=result.state.scores.B;
     target.log=[...(target.log||[]),{...record}];target.updatedAt=now;
    }
   }else if(d.action==='undo'&&result.event){
    for(const target of [m,publicMatch]){
     target.scoreA=result.state.scores.A;target.scoreB=result.state.scores.B;
     target.log=target.log.slice(0,-1);target.updatedAt=now;
    }
   }
   if(d.action==='score'||d.action==='undo'&&result.event||d.action==='fault'&&result.event||d.action==='confirm'){
    s.updatedAt=now;
    tx.update(tourRef,{data:JSON.stringify(s),updatedAt:now});
    tx.update(publicRef,{bracketView:JSON.stringify(publicState),updatedAt:now});
   }
   tx.set(ledgerRef,{version,state:result.state,dispatchRevision:G.revision(m),station:m.station,
    updatedAt:now,updatedBy:uid,createdAt:ledgerSnap.data()?.createdAt||now});
   return {ok:true,version,state:round.view(result.state,isRef?'referee':side),
    event:result.event||null,warning:result.warning||null,warningUndone:result.warningUndone||null,
    completion:completionResult};
  });
 };
}
module.exports={createEnchantmentService};
