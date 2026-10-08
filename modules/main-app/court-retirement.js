(function(root){
  'use strict';
  const count=n=>Math.max(1,Math.min(32,Number(n)||1));
  const pending=m=>m&&!m.isBye&&!m.completed;
  const held=m=>pending(m)&&(m.offlinePendingSync||!m.skippedAt&&(m.status==='in_progress'||m.status==='paused'||Number(m.scoreA)>0||Number(m.scoreB)>0||(m.log||[]).length>0));
  function target(st){return count(st.courtRetirementPlan?.targetCount||st.meta?.stations);}
  function accepts(st,n){return Number.isInteger(Number(n))&&Number(n)>0&&Number(n)<=target(st)&&!st.forcedCourtExits?.[n]?.closed;}
  function reconcile(st,now=Date.now()){
    const p=st.courtRetirementPlan;if(!p)return;
    let changed=false;
    const load=Array(p.targetCount).fill(0);
    for(const m of st.matches||[])if(pending(m)&&Number(m.station)<=p.targetCount)load[Number(m.station)-1]++;
    for(const m of st.matches||[]){
      if(!pending(m)||Number(m.station)<=p.targetCount||held(m))continue;
      const to=load.indexOf(Math.min(...load))+1;load[to-1]++;move(st,m,to,now);changed=true;
    }
    for(const [key,c] of Object.entries(p.courts||{})){
      if(Number(key)<=p.targetCount)continue;
      const work=(st.matches||[]).filter(m=>pending(m)&&Number(m.station)===Number(key));
      const ids=work.map(m=>m.id);const status=ids.length?'draining':'retired';
      if(c.status!==status||JSON.stringify(c.holdIds)!==JSON.stringify(ids)){c.status=status;c.holdIds=ids;c.updatedAt=now;changed=true;}
      if(status==='retired'&&st.courtAssignments?.['court'+key]){
        st.courtAssignments['court'+key].currentMatchId=null;st.courtAssignments['court'+key].nextMatchId=null;
      }
    }
    const draining=Object.entries(p.courts||{}).filter(([,c])=>c.status==='draining').map(([k])=>Number(k));
    const physical=Math.max(p.targetCount,...draining);
    if(st.meta.stations!==physical){st.meta.stations=physical;changed=true;}
    const status=draining.length?'draining':'completed';if(p.status!==status){p.status=status;changed=true;}
    if(changed){p.revision=Number(p.revision||0)+1;p.updatedAt=now;}
  }
  function request(st,n,expectedTarget=target(st),now=Date.now()){
    if(!Number.isInteger(n)||n<1||n>32)return {ok:false,reason:'invalid-court-count'};
    if(target(st)!==expectedTarget)return {ok:false,reason:'court-plan-stale'};
    if(st.archiveStatus==='completed')return {ok:false,reason:'already-completed'};
    const old=st.courtRetirementPlan;const p={targetCount:n,revision:Number(old?.revision||0)+1,requestedAt:now,updatedAt:now,status:'draining',courts:{}};
    const physical=Math.max(n,count(st.meta.stations));
    for(let i=n+1;i<=physical;i++)p.courts[i]={status:'draining',holdIds:[],requestedAt:old?.courts?.[i]?.requestedAt||now,updatedAt:now};
    st.courtRetirementPlan=p;
    const load=Array(n).fill(0);for(const m of st.matches||[])if(pending(m)&&Number(m.station)<=n)load[Number(m.station)-1]++;
    for(const m of (st.matches||[]).slice().sort((a,b)=>Number(a.seq||0)-Number(b.seq||0))){
      if(!pending(m)||Number(m.station)<=n||held(m))continue;
      const to=load.indexOf(Math.min(...load))+1;load[to-1]++;
      move(st,m,to,now); // PASS dependencies and score ledgers remain attached to the match.
    }
    reconcile(st,now);return {ok:true,state:st};
  }
  function move(st,m,to,now){
    const from=Number(m.station);for(const c of Object.values(st.courtAssignments||{})){if(c.currentMatchId===m.id)c.currentMatchId=null;if(c.nextMatchId===m.id)c.nextMatchId=null;}
    m.station=to;m.dispatchRevision=Number(m.dispatchRevision||0)+1;m.updatedAt=now;
    m.retirementMoves=(m.retirementMoves||[]).concat({from,to,at:now,revision:m.dispatchRevision});
    if(!m.skippedAt){m.status='ready';m.dispatchPriorityAt=now;}
  }
  function transfer(st,id,to,revision,now=Date.now()){
    const m=(st.matches||[]).find(x=>x.id===id);
    if(!pending(m)||Number(m.station)<=target(st)||!st.courtRetirementPlan?.courts?.[m.station])return {ok:false,reason:'not-retiring'};
    if(!accepts(st,to))return {ok:false,reason:'target-retiring'};
    if(Number(m.dispatchRevision||0)!==revision)return {ok:false,reason:'dispatch-stale'};
    if(m.offlinePendingSync)return {ok:false,reason:'offline-sync-pending'};
    move(st,m,to,now);reconcile(st,now);return {ok:true,state:st};
  }
  function forceExit(st,n,expectedId,expectedRevision,expectedExitRevision=0,now=Date.now()){
    if(!Number.isInteger(n)||n<1||n>count(st.meta?.stations))return {ok:false,reason:'invalid-court'};
    if(st.archiveStatus==='completed')return {ok:false,reason:'already-completed'};
    const c=st.courtAssignments?.['court'+n],old=st.forcedCourtExits?.[n];
    if(Number(old?.revision||0)!==expectedExitRevision)return {ok:false,reason:'court-exit-stale'};
    if((c?.currentMatchId||null)!==(expectedId||null))return {ok:false,reason:'current-match-changed'};
    const m=(st.matches||[]).find(x=>x.id===expectedId);
    if(expectedId&&(!m||Number(m.dispatchRevision||0)!==expectedRevision))return {ok:false,reason:'dispatch-stale'};
    // Release every court reference to the current match, including legacy aliases.
    if(m){
      for(const court of Object.values(st.courtAssignments||{})){
        if(court.currentMatchId===m.id)court.currentMatchId=null;
        if(court.nextMatchId===m.id)court.nextMatchId=null;
      }
      if(st.currentMatchId===m.id)st.currentMatchId=null;
      m.dispatchRevision=Number(m.dispatchRevision||0)+1;m.updatedAt=now;
      if(pending(m)){m.station=0;m.status='paused';m.forceDetached={from:n,at:now,revision:m.dispatchRevision};}
    }
    // Reopening the court must not revive queued commands from the old session.
    for(const queued of st.matches||[])if(pending(queued)&&queued!==m&&Number(queued.station)===n){queued.dispatchRevision=Number(queued.dispatchRevision||0)+1;queued.updatedAt=now;}
    if(c)Object.assign(c,{currentMatchId:null,nextMatchId:null,status:'retired',lockedBy:null,lockedAt:null,updatedAt:now});
    st.forcedCourtExits=st.forcedCourtExits||{};
    st.forcedCourtExits[n]={closed:true,revision:expectedExitRevision+1,at:now,matchId:expectedId||null};
    reconcile(st,now);return {ok:true,state:st};
  }
  function reopen(st,n,revision,now=Date.now()){
    const c=st.forcedCourtExits?.[n];
    if(st.archiveStatus==='completed')return {ok:false,reason:'already-completed'};
    if(!c?.closed||c.revision!==revision)return {ok:false,reason:'court-exit-stale'};
    if(n>target(st))return {ok:false,reason:'target-retiring'};
    c.closed=false;c.revision++;c.reopenedAt=now;return {ok:true,state:st};
  }
  function claimDetached(st,id,to,revision,now=Date.now()){
    const m=(st.matches||[]).find(x=>x.id===id);
    if(!pending(m)||!m.forceDetached||Number(m.station)!==0)return {ok:false,reason:'not-detached'};
    if(!accepts(st,to))return {ok:false,reason:'target-retiring'};
    if(Number(m.dispatchRevision||0)!==revision)return {ok:false,reason:'dispatch-stale'};
    if(m.offlinePendingSync)return {ok:false,reason:'offline-sync-pending'};
    move(st,m,to,now);delete m.forceDetached;return {ok:true,state:st};
  }
  root.BXHCourtRetirement={target,accepts,request,reconcile,transfer,forceExit,reopen,claimDetached};
})(typeof window==='undefined'?globalThis:window);
