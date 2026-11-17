(function(root){
  'use strict';
  const sameRound=(a,b)=>a.bracket===b.bracket&&Number(a.round||0)===Number(b.round||0);
  const hasPair=m=>!!(m&&m.a?.playerId&&m.b?.playerId);
  const supported=st=>(st.meta?.formatType||'single')==='single'&&st.meta?.battleMode!=='team'&&st.meta?.playMode!=='enchantment';
  const byId=(st,id)=>(st.matches||[]).find(m=>m.id===id);
  function predecessors(st,m){
    const candidates=(st.matches||[]).filter(x=>x.id!==m.id&&!x.isBye&&!x.completed&&!x.skippedAt&&!x.offlinePendingSync&&!x.forceDetached&&!st.forcedCourtExits?.[x.station]?.closed&&x.status!=='paused'&&hasPair(x)&&sameRound(x,m));
    const order=(a,b)=>Number(a.seq||0)-Number(b.seq||0)||String(a.id).localeCompare(String(b.id));
    const local=candidates.filter(x=>Number(x.station)===Number(m.station)).sort(order);
    return (local.length?local:candidates.sort(order)).slice(0,2).map(x=>x.id);
  }
  function create(st,m,now){
    const waitFor=predecessors(st,m);
    if(!waitFor.length)return {ok:false,reason:'no-pass-alternative'};
    m.passReturn={version:1,originStation:Number(m.station),skippedAt:now,waitFor,readyAt:null,status:'waiting'};
    m.skipWaitFor=waitFor.slice();m.skipManualOnly=false;
    return {ok:true};
  }
  function ensure(st,m,now){
    if(m.passReturn?.version===1)return m.passReturn;
    // Legacy manual-only skips must never become permanently un-runnable.
    // Existing fixed dependencies, including player CALL/PASS, stay authoritative.
    const waitFor=Array.isArray(m.callPass?.waitFor)?m.callPass.waitFor.slice():Array.isArray(m.skipWaitFor)?m.skipWaitFor.filter(id=>!byId(st,id)||sameRound(byId(st,id),m)):[];
    if(!waitFor.length&&!m.callPass&&(m.skipManualOnly||Array.isArray(m.skipWaitFor)&&m.skipWaitFor.length)){
      const laterCompletion=(st.matches||[]).some(x=>x.id!==m.id&&x.completed&&sameRound(x,m)&&Number(x.completedAt||x.confirmedAt||x.updatedAt||0)>Number(m.skippedAt||0));
      if(!laterCompletion)waitFor.push(...predecessors(st,m));
    }
    m.passReturn={version:1,originStation:Number(m.station),skippedAt:Number(m.skippedAt)||now,waitFor,readyAt:null,status:'waiting',legacy:true};
    m.skipWaitFor=waitFor.slice();m.skipManualOnly=false;
    return m.passReturn;
  }
  function readiness(st,m){
    if(!m||m.completed||!m.skippedAt)return {ok:false,reason:'not-deferred'};
    if(!hasPair(m))return {ok:false,reason:'players-waiting'};
    if(m.offlinePendingSync)return {ok:false,reason:'offline-pending'};
    if(m.status==='paused'||m.forceDetached)return {ok:false,reason:'match-paused'};
    const ids=m.passReturn?.waitFor||m.callPass?.waitFor||m.skipWaitFor||[];
    if(ids.some(id=>!byId(st,id)?.completed))return {ok:false,reason:'pass-waiting'};
    if(m.skipManualOnly&&!m.passReturn)return {ok:false,reason:'legacy-recovery-pending'};
    return {ok:true};
  }
  function idle(st,n){
    const c=st.courtAssignments?.['court'+n];if(!c)return false;
    if(c.status==='paused'||c.paused===true)return false;
    const m=byId(st,c.currentMatchId);
    if(!m||m.completed)return true;
    if(m.skippedAt)return false;
    return ['pending','ready'].includes(m.status||'pending')&&!m.startedAt&&!m.dispatchPriorityAt&&!m.offlinePendingSync&&!Number(m.scoreA)&&!Number(m.scoreB)&&!(m.log||[]).length&&!(m.faultActions||[]).length;
  }
  function request(st,m,to,now,accepts,blocked){
    if(m&&m.skippedAt)ensure(st,m,now);
    const ready=readiness(st,m);if(!ready.ok)return ready;
    if(blocked(m))return {ok:false,reason:'previous-round-waiting'};
    if(!Number.isInteger(to)||!accepts(to))return {ok:false,reason:'court-retired'};
    const info=ensure(st,m,now);info.requestedStation=to;info.readyAt=info.readyAt||now;info.status='ready';
    m.dispatchRevision=Number(m.dispatchRevision||0)+1;m.updatedAt=now;
    return {ok:true,state:st};
  }
  function reconcile(st,now,{accepts,blocked}){
    if(!supported(st)||!st.startedAt||['completed','archived'].includes(st.archiveStatus))return;
    const ready=[];
    for(const m of st.matches||[]){
      if(m.completed||!m.skippedAt)continue;
      const info=ensure(st,m,now),r=readiness(st,m);
      if(!r.ok||blocked(m)){info.status='waiting';continue;}
      if(!info.readyAt){
        const times=info.waitFor.map(id=>byId(st,id)).map(x=>Number(x?.completedAt||x?.confirmedAt||x?.updatedAt||0)).filter(Boolean);
        info.readyAt=Math.max(info.skippedAt,...times);
      }
      info.status='ready';ready.push(m);
    }
    const free=[];
    for(let n=1;n<=Math.max(1,Number(st.meta?.stations)||1);n++){
      const c=st.courtAssignments?.['court'+n];if(!c)continue;
      if(!accepts(n)||!idle(st,n)){c.idleSinceAt=null;continue;}
      c.idleSinceAt=c.idleSinceAt||now;free.push(n);
    }
    free.sort((a,b)=>Number(st.courtAssignments['court'+a].idleSinceAt)-Number(st.courtAssignments['court'+b].idleSinceAt)||a-b);
    ready.sort((a,b)=>a.passReturn.readyAt-b.passReturn.readyAt||a.passReturn.skippedAt-b.passReturn.skippedAt||Number(a.seq||0)-Number(b.seq||0)||String(a.id).localeCompare(String(b.id)));
    for(const m of ready){
      const info=m.passReturn;
      if(m.resumeQueuedAt&&Object.values(st.courtAssignments).some(c=>c.currentMatchId===m.id)){info.status='assigned';continue;}
      const preferred=Number(info.requestedStation||info.originStation);
      const to=info.requestedStation?(free.includes(preferred)?preferred:null):free.includes(preferred)?preferred:free[0];
      if(!to)continue;
      free.splice(free.indexOf(to),1);
      for(const c of Object.values(st.courtAssignments)){if(c.currentMatchId===m.id)c.currentMatchId=null;if(c.nextMatchId===m.id)c.nextMatchId=null;}
      info.assignedStation=to;info.assignedAt=now;info.status='assigned';
      m.station=to;m.resumeQueuedAt=now;m.skipManualOnly=false;m.dispatchRevision=Number(m.dispatchRevision||0)+1;m.updatedAt=now;
      const court=st.courtAssignments['court'+to];court.currentMatchId=m.id;court.idleSinceAt=null;
    }
  }
  function started(m,now){if(m.passReturn){m.passReturn.status='playing';m.passReturn.startedAt=now;}}
  root.BXHPassReturn={supported,predecessors,create,ensure,readiness,idle,request,reconcile,started};
})(module.exports);
