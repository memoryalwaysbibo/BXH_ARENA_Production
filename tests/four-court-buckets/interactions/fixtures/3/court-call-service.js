'use strict';
const C=require('./court-call-core');
const G=require('./court-session-guard');
function createCourtCallService(db,clock=Date.now){
 return async req=>{
  const uid=req.auth?.uid,d=req.data||{},code=String(d.code||'').toUpperCase();
  if(!uid)throw Error('auth-required');if(!/^BXH-[A-Z0-9]{4,16}$/.test(code))throw Error('invalid-code');
  if(!['list','notify','prepare','respond','approve','reject'].includes(d.action))throw Error('invalid-action');
  if(d.action!=='list'&&!/^[a-zA-Z0-9_-]{8,100}$/.test(d.operationId||''))throw Error('invalid-operation');
  const tour=db.doc('tournaments/'+code),pub=db.doc('publicTournaments/'+code),root=db.doc('courtCalls/'+code);
  const op=d.action!=='list'?root.collection('audit').doc(C.hash(uid+':'+d.operationId)):null;
  return db.runTransaction(async tx=>{
   const refs=[db.doc('users/'+uid),tour,pub,root,...(op?[op]:[])],snaps=await Promise.all(refs.map(r=>tx.get(r)));
   const p=snaps[0].data(),t=snaps[1].data();if(!C.active(p))throw Error('account-inactive');if(!t)throw Error('event-not-found');
   let s;try{s=JSON.parse(t.data);}catch{throw Error('invalid-tournament');}
   // Keep tester access scoped to the tester's own sandbox, including rooms
   // created before the explicit testMode/eventAuthority fields existed.
   if(C.tester(p)&&!C.testerSandbox(s,uid))throw Error('permission-denied');
   const record=snaps[3].data()||{calls:{},used:{},prepares:{}},calls=record.calls||{},used=record.used||{},prepares=record.prepares||{},now=clock();
   const matchPlayers=m=>[m.a,m.b].map(side=>(s.players||[]).find(p=>p.id===side?.playerId));
   const quota=p=>p?.familyPlayerId||C.playerUid(p);
   const stationRefereeUids=m=>{
    const restricted=t.refereeStationRestrictionEnabled===true||s.meta?.refereeStationRestrictionEnabled===true;
    const stationMap=t.refereeStationAssignments||s.meta?.refereeStationAssignments||{};
    const station=Array.isArray(stationMap?.[String(m.station)])?stationMap[String(m.station)]:[];
    const general=t.assignedStaffUids||s.meta?.assignedStaffUids||[];
    const owners=[t.createdBy,s.createdBy,s.ownerUid];
    return [...new Set([...(restricted?station:general),...owners].filter(Boolean))];
   };
   const callPush=(m,kind,title,body,uids)=>({
    kind,title,body,uids:[...new Set((uids||[]).filter(Boolean))],
    code,matchId:m.id,station:String(m.station),sequence:String((kind==='prepare'?prepares:calls)[m.id]?.sequence||0),
    dispatchRevision:String(G.revision(m)),
    url:'https://arena.bxh.com.tw/'
   });
   const responseKey=(m,actor,id)=>{const own=matchPlayers(m).filter(p=>C.playerUid(p)===actor);const chosen=id?own.find(p=>p.id===id):own.length===1?own[0]:null;if(!chosen)throw Error('participant-required');return chosen;};
   const passPlayer=(m,pass)=>matchPlayers(m).find(p=>C.playerUid(p)===pass?.uid&&(pass.localPlayerId?p?.id===pass.localPlayerId:!pass.participantId||quota(p)===pass.participantId));
   const myMatches=(s.matches||[]).filter(m=>C.matchUsers(s,m).includes(uid));
   const allowed=m=>C.canReferee(p,uid,t,s,m.station);
   const visible=(s.matches||[]).filter(m=>allowed(m)||myMatches.includes(m));
   if(!visible.length)throw Error('permission-denied');
   if(d.action==='list'){
    let changed=false;const recallPushes=[];
    for(const m of visible){const c=calls[m.id];if(!c||!G.bound(s,m,c)||!m.callPass||c.recalledPassAt===m.callPass.approvedAt||m.completed)continue;
     const done=m.callPass.waitFor.every(id=>s.matches.find(x=>x.id===id)?.completed===true);
     if(done&&G.current(s,m)){
      c.sequence++;c.calledAt=now;c.responses={};c.recalledPassAt=m.callPass.approvedAt;changed=true;
      tx.set(root.collection('audit').doc('recall_'+C.hash(m.id+':'+m.callPass.approvedAt)),{action:'recall',matchId:m.id,at:now});
      const names=matchPlayers(m).map(p=>p?.name||'選手');
      recallPushes.push(callPush(m,'recall',`🔔 BXH CALL｜Court ${m.station}`,`${names[0]||'選手 A'} VS ${names[1]||'選手 B'}｜PASS 延後場次已完成，請前往 ${m.station} 號戰鬥台。`,C.matchUsers(s,m)));
     }
    }
    if(changed)tx.set(root,{calls,used},{merge:true});
    const rows=visible.filter(m=>calls[m.id]&&!m.completed&&G.bound(s,m,calls[m.id])).map(m=>{
     const c=calls[m.id],ref=allowed(m),requester=passPlayer(m,c.pass);
     let passQueueAvailable=false,passUnavailableReason='';
     if(m.callPass)passUnavailableReason='pass-unavailable';
     else{
      try{C.passPredecessors(s,m);passQueueAvailable=true;}
      catch(e){passUnavailableReason=String(e?.message||'pass-unavailable');}
     }
     const players=matchPlayers(m).map(player=>{
      const owner=C.playerUid(player),passUsed=!!used[quota(player)];
      return {
       id:player?.id,name:player?.name||'選手',
       response:c.responses?.[player?.id]||c.responses?.[owner]||'unanswered',
       me:owner===uid,passUsed,
       canPass:owner===uid&&!passUsed&&!m.callPass&&passQueueAvailable
      };
     });
     const mePassUsed=players.some(player=>player.me&&player.passUsed);
     return {
      matchId:m.id,station:m.station,round:m.round,sequence:c.sequence,calledAt:c.calledAt,
      pass:c.pass?{status:c.pass.status,reason:c.pass.reason,requestedAt:c.pass.requestedAt,requester:c.pass.uid===uid,playerId:requester?.id||null,playerName:requester?.name||'選手',waitFor:c.pass.waitFor||[]}:null,
      players,isReferee:ref,
      canPass:players.some(player=>player.me&&player.canPass),
      passUnavailableReason:mePassUsed?'pass-used':passUnavailableReason,
      canApprove:ref&&c.pass?.status==='pending',
      waitingFor:m.callPass?.waitFor.filter(id=>!s.matches.find(x=>x.id===id)?.completed)||[],
      completed:!!m.completed
     };
    });
    const prepareRows=visible.filter(m=>prepares[m.id]&&!m.completed&&G.bound(s,m,prepares[m.id])&&G.next(s,m)).map(m=>{
     const p=prepares[m.id],users=C.matchUsers(s,m),names=matchPlayers(m).map(x=>x?.name||'選手');
     return {
      matchId:m.id,station:m.station,round:m.round,sequence:Number(p.sequence||0),notifiedAt:Number(p.notifiedAt||0),
      me:users.includes(uid),isReferee:allowed(m),
      players:names.map((name,i)=>({name,me:users[i]===uid}))
     };
    });
    return {
     ok:true,_pushes:recallPushes,
     passUsed:myMatches.some(m=>matchPlayers(m).some(p=>C.playerUid(p)===uid&&!!used[quota(p)])),
     rows,prepares:prepareRows
    };
   }
   if(!s.startedAt||s.archiveStatus==='completed'||t.systemClosed||s.meta?.eventCancelled)throw Error('event-not-live');
   const m=(s.matches||[]).find(x=>x.id===d.matchId);if(!m||m.completed||m.isBye||!m.a||!m.b)throw Error('match-unavailable');
   if(!G.activeCourt(s,m))throw Error('court-session-ended');
   if(op&&snaps[4].exists){if(snaps[4].data().fingerprint!==C.hash(JSON.stringify(d)))throw Error('operation-conflict');return {ok:true,repeated:true};}
   const ref=allowed(m),users=C.matchUsers(s,m);let c=calls[m.id],prepare=prepares[m.id],push=null,stateChanged=false;
   if(d.action==='notify'){
    if(!ref)throw Error('referee-required');
    if(!G.current(s,m))throw Error('not-current-match');
    if(users.some(x=>!x)||m.a.playerId===m.b.playerId)throw Error('players-not-linked');
    if(G.bound(s,m,c)&&c?.pass?.status==='pending')throw Error('resolve-pass-first');
    if(G.bound(s,m,c)&&now-c.calledAt<10000)throw Error('notify-cooldown');
    c={...c,sequence:Number(c?.sequence||0)+1,calledAt:now,responses:{},dispatchRevision:G.revision(m),station:m.station};calls[m.id]=c;
    const names=matchPlayers(m).map(p=>p?.name||'選手');
    push=callPush(m,'call',`🔔 BXH CALL｜Court ${m.station}`,`${names[0]||'選手 A'} VS ${names[1]||'選手 B'}｜請前往 ${m.station} 號戰鬥台，開啟 ARENA 回覆 OK 或 PASS。`,users);
   }else if(d.action==='prepare'){
    if(!ref)throw Error('referee-required');
    const court=s.courtAssignments?.['court'+m.station];
    if(!court||!G.next(s,m))throw Error('not-next-match');
    if(users.some(x=>!x)||m.a.playerId===m.b.playerId)throw Error('players-not-linked');
    if(G.bound(s,m,prepare)&&now-Number(prepare.notifiedAt||0)<30000)throw Error('prepare-cooldown');
    prepare={sequence:Number(prepare?.sequence||0)+1,notifiedAt:now,notifiedByUid:uid,dispatchRevision:G.revision(m),station:m.station};
    prepares[m.id]=prepare;
    const names=matchPlayers(m).map(p=>p?.name||'選手');
    push=callPush(m,'prepare','⏳ BXH CALL｜下一場準備',`${names[0]||'選手 A'} VS ${names[1]||'選手 B'}｜你是下一場，請先到 ${m.station} 號戰鬥台附近準備。`,users);
   }else{
    if(!c||d.sequence!==c.sequence||!G.bound(s,m,c)||!G.current(s,m))throw Error('stale-call');
    const persistPassState=list=>{
     if(!snaps[2].exists)throw Error('public-view-missing');
     let mirror;try{mirror=JSON.parse(snaps[2].data().bracketView);}catch{throw Error('public-view-missing');}
     mirror.callRevision=s.callRevision;
     mirror.courtAssignments=Object.fromEntries(Object.entries(s.courtAssignments||{}).map(([k,v])=>[k,{currentMatchId:v.currentMatchId||null,nextMatchId:v.nextMatchId||null,status:v.status||'idle'}]));
     for(const x of [m,...list]){
      const v=mirror.matches?.find(y=>y.id===x.id);if(!v)throw Error('public-view-missing');
      Object.assign(v,{status:x.status,skippedAt:x.skippedAt||null,skipWaitFor:x.skipWaitFor||[],skipManualOnly:!!x.skipManualOnly,resumeQueuedAt:x.resumeQueuedAt||null,callPass:x.callPass||null,dispatchRevision:Number(x.dispatchRevision||0)});
     }
     tx.update(tour,{data:JSON.stringify(s),updatedAt:now,callRevision:s.callRevision});
     tx.update(pub,{bracketView:JSON.stringify(mirror),updatedAt:now,callRevision:s.callRevision});
     stateChanged=true;
    };
    if(d.action==='respond'){
     if(!users.includes(uid))throw Error('player-required');const participant=responseKey(m,uid,d.participantId);
     if(!['coming','pass','ready'].includes(d.response))throw Error('invalid-response');
     if(d.response==='pass'){
      if(used[quota(participant)])throw Error('pass-used');
      if(c.pass?.status==='pending')throw Error('pass-pending');
      // Phase A: PASS is self-service and atomically accepted. It defers exactly
      // one match on the same Court/round; no referee approval round-trip.
      const list=C.passPredecessors(s,m);
      const reason=['上廁所','裝備處理','其他'].includes(d.reason)?d.reason:'其他';
      C.applyPass(s,m,list,now);
      c.dispatchRevision=G.revision(m);
      used[quota(participant)]={matchId:m.id,at:now};
      c.pass={uid,localPlayerId:participant.id,participantId:quota(participant),status:'approved',reason,requestedAt:now,approvedAt:now,waitFor:list.map(x=>x.id),autoAccepted:true,deferCount:1};
      c.responses[participant.id]='pass';
      persistPassState(list);
      const other=users.filter(x=>x&&x!==uid),refs=stationRefereeUids(m);
      push=callPush(m,'pass',`BXH CALL｜Court ${m.station}`,`${participant.name||'選手'} 使用 PASS，本場已延後 1 場。`,[...other,...refs]);
     }else{
      if(passPlayer(m,c.pass)?.id===participant.id&&c.pass.status==='pending')throw Error('resolve-pass-first');
      c.responses[participant.id]=d.response;
      const other=users.filter(x=>x&&x!==uid),refs=stationRefereeUids(m);
      const label=d.response==='coming'?'正在前往':d.response==='ready'?'已準備好':d.response;
      push=callPush(m,'response',`BXH CALL｜Court ${m.station}`,`${participant.name||'選手'} 已回覆：${label}。`,[...other,...refs]);
     }
    }else{
     // approve/reject are retained only for legacy pending PASS records created
     // before Phase A. New PASS requests never require this branch.
     if(!ref)throw Error('referee-required');if(c.pass?.status!=='pending')throw Error('pass-not-pending');const requester=passPlayer(m,c.pass);if(!requester)throw Error('stale-call');
     if(d.action==='approve'){
      if(used[quota(requester)])throw Error('pass-used');
      const list=C.passPredecessors(s,m);C.applyPass(s,m,list,now);used[quota(requester)]={matchId:m.id,at:now};c.pass.status='approved';c.pass.approvedAt=now;c.pass.waitFor=list.map(x=>x.id);c.pass.autoAccepted=false;c.pass.deferCount=1;
      persistPassState(list);
     }else{c.pass.status='rejected';c.pass.rejectedAt=now;c.responses[requester.id]='unanswered';delete c.responses[c.pass.uid];}
    }
   }
   tx.set(root,{calls,used,prepares},{merge:true});tx.create(op,{action:d.action,matchId:m.id,actorUid:uid,at:now,fingerprint:C.hash(JSON.stringify(d)),sequence:Number(c?.sequence||prepare?.sequence||0),status:c?.pass?.status||null});
   const out=stateChanged?{ok:true,state:s,passApplied:true}:{ok:true};
   if(push)out._push=push;
   return out;
  });
 };
}
module.exports={createCourtCallService};
