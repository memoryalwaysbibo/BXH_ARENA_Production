(function(root){
  'use strict';
  const count=n=>Math.max(1,Math.min(32,Number(n)||1));
  const pending=m=>m&&!m.isBye&&!m.completed;
  // A live current assignment is authoritative even before the first score.
  // Pre-start draw previews and next-match forecasts are not active assignments.
  const held=(st,m)=>pending(m)&&(m.offlinePendingSync||
    Boolean(st.startedAt&&Number(m.station)>0&&st.courtAssignments?.['court'+m.station]?.currentMatchId===m.id)||
    !m.skippedAt&&(m.status==='in_progress'||m.status==='paused'||Number(m.scoreA)>0||Number(m.scoreB)>0||(m.log||[]).length>0));
  function target(st){return count(st.courtRetirementPlan?.targetCount||st.meta?.stations);}
  function accepts(st,n){return Number.isInteger(Number(n))&&Number(n)>0&&Number(n)<=target(st)&&!st.forcedCourtExits?.[n]?.closed;}
  // Without authoritative call records, every displayed next is reserved too.
  // Keep PASS predecessors together; moving either endpoint can change its order.
  function movableQueuedMatches(st){
    const reserved=new Set();
    for(const c of Object.values(st.courtAssignments||{})){
      if(c?.currentMatchId)reserved.add(c.currentMatchId);
      if(c?.nextMatchId)reserved.add(c.nextMatchId);
    }
    for(const m of st.matches||[]){
      for(const id of m?.skipWaitFor||[])reserved.add(id);
      for(const id of m?.callPass?.waitFor||[])reserved.add(id);
    }
    return (st.matches||[]).filter(m=>pending(m)&&!reserved.has(m.id)&&
      Number.isInteger(Number(m.station))&&Number(m.station)>0&&!m.forceDetached&&!st.forcedCourtExits?.[m.station]?.closed&&
      ['pending','ready'].includes(m.status||'pending')&&!m.startedAt&&!m.completedAt&&!m.confirmedAt&&!m.confirmedBy&&!m.resultMethod&&
      !m.winnerId&&!m.loserId&&!m.offlinePendingSync&&!m.skippedAt&&!m.resumeQueuedAt&&!m.skipManualOnly&&!m.callPass&&!(m.skipWaitFor||[]).length&&
      !Number(m.scoreA||0)&&!Number(m.scoreB||0)&&!(m.log||[]).length&&!(m.faultActions||[]).length);
  }
  function expandQueuedMatches(st,n,now){
    const movable=movableQueuedMatches(st).slice().sort((a,b)=>Number(a.seq||0)-Number(b.seq||0));
    const ids=new Set(movable.map(m=>m.id));
    const courts=Array.from({length:n},(_,i)=>i+1).filter(i=>accepts(st,i));
    if(!courts.length)return;
    const load=new Map(courts.map(i=>[i,0]));
    for(const m of st.matches||[])if(pending(m)&&!ids.has(m.id)&&load.has(Number(m.station)))load.set(Number(m.station),load.get(Number(m.station))+1);
    for(const m of movable){
      const to=courts.reduce((best,i)=>load.get(i)<load.get(best)?i:best,courts[0]);
      load.set(to,load.get(to)+1);
      if(Number(m.station)===to)continue;
      // Only routing changes: do not reset slots, scores, readiness or dependencies.
      m.station=to;m.dispatchRevision=Number(m.dispatchRevision||0)+1;m.updatedAt=now;
    }
  }
  function reconcile(st,now=Date.now()){
    const p=st.courtRetirementPlan;if(!p)return;
    let changed=false;
    const load=Array(p.targetCount).fill(0);
    for(const m of st.matches||[])if(pending(m)&&Number(m.station)>0&&Number(m.station)<=p.targetCount)load[Number(m.station)-1]++;
    for(const m of st.matches||[]){
      if(!pending(m)||Number(m.station)<=p.targetCount||held(st,m)||(p.expansionHeldIds||[]).includes(m.id))continue;
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
  function request(st,n,expectedTarget=target(st),now=Date.now(),expectedRevision=Number(st.courtRetirementPlan?.revision||0)){
    if(!Number.isInteger(n)||n<1||n>32)return {ok:false,reason:'invalid-court-count'};
    if(target(st)!==expectedTarget)return {ok:false,reason:'court-plan-stale'};
    if(!Number.isSafeInteger(expectedRevision)||expectedRevision!==Number(st.courtRetirementPlan?.revision||0))return {ok:false,reason:'court-plan-stale'};
    if(st.archiveStatus==='completed')return {ok:false,reason:'already-completed'};
    if(n===expectedTarget)return {ok:true,state:st};
    const old=st.courtRetirementPlan;const p={targetCount:n,revision:Number(old?.revision||0)+1,requestedAt:now,updatedAt:now,status:'draining',courts:{}};
    const physical=Math.max(n,count(st.meta.stations));
    for(let i=n+1;i<=physical;i++)p.courts[i]={status:'draining',holdIds:[],requestedAt:old?.courts?.[i]?.requestedAt||now,updatedAt:now};
    st.courtRetirementPlan=p;
    if(n>expectedTarget){
      const movable=new Set(movableQueuedMatches(st).map(m=>m.id));
      // Expanding a still-draining plan (6→1→3) must not let the legacy
      // shrink/reconcile pass move a reserved next or other protected work.
      p.expansionHeldIds=(st.matches||[]).filter(m=>pending(m)&&Number(m.station)>n&&!movable.has(m.id)).map(m=>m.id);
      expandQueuedMatches(st,n,now);
    }
    const load=Array(n).fill(0);for(const m of st.matches||[])if(pending(m)&&Number(m.station)>0&&Number(m.station)<=n)load[Number(m.station)-1]++;
    for(const m of (st.matches||[]).slice().sort((a,b)=>Number(a.seq||0)-Number(b.seq||0))){
      if(!pending(m)||Number(m.station)<=n||held(st,m)||(p.expansionHeldIds||[]).includes(m.id))continue;
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
  // Physical removal is independent of referee occupancy. A draining court
  // retains its seats until the shared match retirement plan actually removes it.
  const seatSlots=['main','backup1','backup2'];
  function reconcileSeatCount(model,physicalCount,now=Date.now(),previousPhysicalCount=physicalCount){
    if(model?.version!==1)return {model,changed:false};
    if(!Number.isSafeInteger(physicalCount)||physicalCount<1||physicalCount>64)throw Error('invalid-court-count');
    // Older rooms may still contain seats above their current capacity. Clear
    // them before expansion so a removed assignment can never reappear.
    if(Number.isSafeInteger(previousPhysicalCount)&&previousPhysicalCount>=1&&previousPhysicalCount<physicalCount){
      const prior=reconcileSeatCount(model,previousPhysicalCount,now);
      const expanded=reconcileSeatCount(prior.model,physicalCount,now);
      return {model:expanded.model,changed:prior.changed||expanded.changed};
    }
    const needsCourtChange=Object.entries(model.courts||{}).some(([key,court])=>{
      const station=Number(key);return Number.isSafeInteger(station)&&station>0&&court&&(station>physicalCount?(court.retired!==true||seatSlots.some(slot=>court[slot])):court.retired===true);
    });
    const needsRequestChange=Object.values(model.requests||{}).some(req=>req?.status==='pending'&&Number(req.station)>physicalCount);
    if(!needsCourtChange&&!needsRequestChange)return {model,changed:false};
    const next=JSON.parse(JSON.stringify(model));next.courts||={};next.requests||={};let changed=false;
    for(const [key,court] of Object.entries(next.courts)){
      const station=Number(key);if(!Number.isSafeInteger(station)||station<1||!court)continue;
      if(station>physicalCount){
        if(court.retired!==true||seatSlots.some(slot=>court[slot])){
          next.courts[key]={revision:Number(court.revision||0)+1,main:null,backup1:null,backup2:null,retired:true};changed=true;
        }
      }else if(court.retired===true){
        next.courts[key]={revision:Number(court.revision||0)+1,main:null,backup1:null,backup2:null};changed=true;
      }
    }
    for(const req of Object.values(next.requests)){
      if(req?.status==='pending'&&Number(req.station)>physicalCount){req.status=req.expiresAt<=now?'expired':'stale';req.resolvedAt=now;changed=true;}
    }
    if(changed)next.revision=Number(next.revision||0)+1;
    return {model:changed?next:model,changed};
  }
  function projectSeats(model,ownerUid=null,stations=0){
    const assignments={},names={},publicSeats={},uids=new Set();
    const courts={...model.courts};for(let n=1;n<=Math.min(32,Number(stations)||0);n++)courts[n]=courts[n]||{main:null,backup1:null,backup2:null};
    for(const [station,court] of Object.entries(courts)){
      if(!court||court.retired===true||(stations>0&&Number(station)>stations))continue;
      assignments[station]=[];names[station]=[];publicSeats[station]={};
      if(ownerUid)assignments[station].push(ownerUid);
      for(const slot of seatSlots){const seat=court[slot];publicSeats[station][slot]=seat?{name:seat.name}:null;if(seat){if(!assignments[station].includes(seat.uid))assignments[station].push(seat.uid);names[station].push(seat.name);uids.add(seat.uid);}}
    }
    return {refereeStationAssignments:assignments,refereeStationNames:names,refereeStationUids:[...uids],refereeStationRestrictionEnabled:true,refereeSeatNames:publicSeats};
  }
  root.BXHCourtRetirement={target,accepts,request,reconcile,transfer,forceExit,reopen,claimDetached,movableQueuedMatches,reconcileSeatCount,projectSeats};
})(module.exports);
