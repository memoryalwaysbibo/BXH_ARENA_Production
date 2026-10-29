'use strict';
const D=require('./domain.cjs');

function parseState(room) {
  try {const s=typeof room?.data==='string'?JSON.parse(room.data):room?.data;return s&&typeof s==='object'&&!Array.isArray(s)?s:null;} catch{return null;}
}
function testRoom(room,state) {
  if(room.testMode===true||state.testMode===true||state.meta?.testMode===true||room.syntheticTestRoster===true||state.syntheticTestRoster===true
    ||room.eventAuthority==='test'||state.meta?.eventAuthority==='test'||room.createdByRole==='tester'||state.createdByRole==='tester'
    ||room.testLadderEnabled===true||state.testLadderEnabled===true) return true;
  const players=Array.isArray(state.players)?state.players:[];
  return players.length>=2&&players.every(p=>p?.source==='test'&&/^T\d{3}$/.test(String(p.testPlayerKey||''))
    &&!p.familyPlayerId&&!p.registrationUid&&!p.accountUid&&!p.playerUid&&!p.uid&&p.accountLinked!==true);
}
function validRoom(room,state) {
  if(testRoom(room,state)) return 'test-event';
  if(room.eventCancelled||state.meta?.eventCancelled||room.deletionStatus||state.deletionStatus
    ||room.systemClosed||(state.systemClosure&&!state.systemClosure.restoredAt)||room.tournamentPhase==='cancelled') return 'cancelled-event';
  const authority=room.eventAuthority||state.meta?.eventAuthority;
  if(!authority||(room.eventAuthority&&state.meta?.eventAuthority&&room.eventAuthority!==state.meta.eventAuthority)) return 'event-authority-unresolved';
  if(authority!=='official') return 'non-official-event';
  return null;
}
function completedEvent(room,state) {
  if(state.archiveStatus!=='completed') return false;
  const matches=Array.isArray(state.matches)?state.matches.filter(m=>m&&!m.isBye):[];
  if(!matches.length||matches.some(m=>m.completed!==true)) return false;
  return true;
}
// An actual entrant is a roster identity present in the canonical bracket, not a capacity/seed slot.
function actualSize(state) {
  if(state.meta?.battleMode==='team'||!Array.isArray(state.players)||!Array.isArray(state.matches)) return {size:null,precision:'unknown',source:'unknown'};
  const players=state.players.filter(p=>p&&typeof p.id==='string'&&p.id);
  const unique=new Set(players.map(p=>p.id));
  if(unique.size!==players.length) return {size:null,precision:'unknown',source:'ambiguous-roster'};
  const bracket=new Set();
  for(const m of state.matches) for(const id of [m?.a?.playerId,m?.b?.playerId]) if(typeof id==='string'&&id) bracket.add(id);
  if(bracket.size>=2&&[...bracket].every(id=>unique.has(id))) return {size:bracket.size,precision:'exact',source:'canonical-bracket-roster'};
  // No bracket roster can be established: do not promote a registration/check-in count to exact actual participation.
  return {size:null,precision:'unknown',source:'unresolved-bracket-roster'};
}
function trustworthyAudit(match,uid,audit) {
  const revision=Number(match.refereeSeatScoreRevision),at=Number(match.confirmedAt||match.completedAt);
  return Number.isSafeInteger(revision)&&revision>0&&Number.isFinite(at)&&at>0&&audit.uid===uid&&audit.matchId===match.id
    &&['confirm','quick'].includes(audit.action)&&audit.scoreRevision===revision&&audit.at===at;
}
function limited(snapshot,limit,out,reason) {
  const docs=snapshot.docs||[];
  if(docs.length>limit){out.incomplete=true;out.incompleteReasons.push(reason);}
  return docs.slice(0,limit);
}
async function readSystemSources(tx,db,uid,limits=D.LIMITS) {
  const out=D.emptySource();
  const logsSnap=await tx.get(db.collection('staffActivityLogs/'+uid+'/matches').limit(limits.logs+1));
  const logDocs=limited(logsSnap,limits.logs,out,'logs-limit');
  const logs=logDocs.map(doc=>({docId:doc.id,...doc.data()}));
  const codes=[...new Set(logs.map(log=>log.tournamentCode).filter(code=>typeof code==='string'&&/^BXH-[A-Z0-9]{4,24}$/.test(code)))];
  if(codes.length>limits.rooms){out.incomplete=true;out.incompleteReasons.push('rooms-limit');}
  const rooms=new Map();
  await Promise.all(codes.slice(0,limits.rooms).map(async code=>{
    const snap=await tx.get(db.doc('tournaments/'+code));
    const room=snap.exists?snap.data():null,state=parseState(room);
    rooms.set(code,{room,state});
  }));
  const audits=new Map();let auditRooms=0;
  const validEvents=new Map(),seen=new Set();
  for(const log of logs) {
    const code=log.tournamentCode,matchId=log.matchId,key=String(code||'')+'_'+String(matchId||'');
    const row={id:log.docId,tournamentCode:typeof code==='string'?code:'',matchId:typeof matchId==='string'?matchId:'',status:'pending',reason:null};
    out.systemRecords.push(row);
    const pending=reason=>{row.reason=reason;out.pendingLogCount++;};
    const excluded=reason=>{row.status='excluded';row.reason=reason;out.excludedLogCount++;};
    if(log.uid!==uid||typeof matchId!=='string'||!matchId||matchId.includes('/')||!/^BXH-[A-Z0-9]{4,24}$/.test(code||'')){pending('invalid-log-identity');continue;}
    if(seen.has(key)){excluded('duplicate-source-key');continue;}
    seen.add(key);
    const context=rooms.get(code);
    if(!context){pending('room-not-read');continue;}
    if(!context.room||!context.state){pending('source-room-unavailable');continue;}
    const {room,state}=context,roomProblem=validRoom(room,state);
    if(roomProblem){if(roomProblem==='event-authority-unresolved')pending(roomProblem);else excluded(roomProblem);continue;}
    if(!Array.isArray(state.matches)){pending('source-matches-unavailable');continue;}
    const candidates=state.matches.filter(m=>m?.id===matchId);
    if(candidates.length!==1){pending('match-unresolved');continue;}
    const match=candidates[0];
    if(match.isBye){excluded('bye');continue;}
    if(match.completed!==true){excluded('current-result-not-completed');continue;}
    if(!match.a?.playerId||!match.b?.playerId||match.a.playerId===match.b.playerId||![match.a.playerId,match.b.playerId].includes(match.winnerId)){pending('current-result-invalid');continue;}
    let verified=match.confirmedByUid===uid;
    if(match.confirmedByUid&&match.confirmedByUid!==uid){excluded('different-confirming-referee');continue;}
    if(!verified) {
      if(!audits.has(code)) {
        if(auditRooms>=limits.auditRooms){out.incomplete=true;out.incompleteReasons.push('audit-rooms-limit');audits.set(code,[]);}
        else {
          auditRooms++;
          const snap=await tx.get(db.collection('tournaments/'+code+'/refereeScoreAudit').where('uid','==',uid).limit(limits.scoreAudits+1));
          audits.set(code,limited(snap,limits.scoreAudits,out,'score-audit-limit').map(doc=>doc.data()));
        }
      }
      verified=audits.get(code).some(audit=>trustworthyAudit(match,uid,audit));
    }
    if(!verified){pending('confirming-identity-unresolved');continue;}
    out.decisions++;
    const done=completedEvent(room,state);
    row.status=done?'verified':'pending_event';
    row.reason=done?null:'event-not-completed';
    row.eventName=String(state.meta?.name||room.name||'').slice(0,160);
    row.confirmedAt=Number(match.confirmedAt||match.completedAt)||null;
    row.station=Number(match.confirmedStation||match.station)||null;
    validEvents.set(code,{room,state,done});
  }
  for(const [code,{state,done}] of validEvents) {
    if(!done){out.pendingEvents++;continue;}
    const scale=actualSize(state);
    D.addEvent(out,1,scale.size,scale.precision);
    for(const row of out.systemRecords) if(row.tournamentCode===code&&row.status==='verified') Object.assign(row,{eventSize:scale.size,eventPrecision:scale.precision,eventSizeSource:scale.source});
  }
  out.incompleteReasons=[...new Set(out.incompleteReasons)];
  return out;
}
module.exports={parseState,testRoom,validRoom,completedEvent,actualSize,trustworthyAudit,limited,readSystemSources};
