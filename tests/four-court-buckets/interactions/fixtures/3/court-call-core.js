'use strict';
const hash=v=>require('node:crypto').createHash('sha256').update(String(v)).digest('hex');
const active=p=>p&&p.active===true&&!p.deleted&&!['deleted','disabled','frozen'].includes(p.accountStatus);
const tester=p=>p?.role==='tester'||p?.isTestAccount===true;
// Test accounts may use their own legacy general rooms.  Older rooms were
// created before the explicit testMode/eventAuthority fields were added, so
// use the durable creator/owner identity plus the non-ranked boundary and the
// existing tester marker to recognize them without opening official events.
function testerSandbox(s,uid){
 if(!s||!uid||s.ownerUid!==uid||s.createdBy!==uid)return false;
 if(s.ladderMode==='ranked'||s.meta?.ladderMode==='ranked')return false;
 if(s.meta?.eventAuthority==='official')return false;
 return s.testMode===true||s.testLabel==='（測試）'||s.createdByRole==='tester'||s.meta?.eventAuthority==='test';
}
function canReferee(p,uid,t,s,station){
 if(!active(p))return false;
 if(tester(p))return testerSandbox(s,uid);
 if(['super_admin','admin'].includes(p.role))return true;
 if(s.meta?.eventAuthority==='community')return s.ownerUid===uid;
 if(p.role!=='staff')return false;
 const assigned=t.assignedStaffUids||s.meta?.assignedStaffUids||[];
 if(assigned.length&&!assigned.includes(uid)&&t.createdBy!==uid)return false;
 if(t.refereeStationRestrictionEnabled===true||s.meta?.refereeStationRestrictionEnabled===true)return (t.refereeStationAssignments||s.meta.refereeStationAssignments||{})[String(station)]?.includes(uid)===true;
 return true;
}
const playerUid=p=>p?.guardianUid||p?.registrationUid||p?.playerUid||null;
function matchUsers(s,m){return [m.a,m.b].map(side=>playerUid((s.players||[]).find(p=>p.id===side?.playerId)));}
function passPredecessors(s,m){
 if(!m||m.completed||m.isBye||m.skippedAt||m.callPass||!m.a||!m.b||Number(m.scoreA)||Number(m.scoreB)||(m.log||[]).length)throw Error('pass-unavailable');
 if(s.courtAssignments?.['court'+m.station]?.currentMatchId!==m.id)throw Error('not-current-match');
 // BXH CALL 2.0 Phase A: PASS defers exactly ONE executable match,
 // stays on the same Court and the same round/bracket, and never crosses rounds.
 const list=(s.matches||[]).filter(x=>x.id!==m.id&&x.station===m.station&&x.bracket===m.bracket&&x.round===m.round&&!x.isBye&&!x.completed&&!x.skippedAt&&x.a&&x.b&&!['paused','in_progress'].includes(x.status)&&Number(x.seq)>Number(m.seq)).sort((a,b)=>Number(a.seq)-Number(b.seq)).slice(0,1);
 if(list.length!==1)throw Error('insufficient-same-round');
 return list;
}
function applyPass(s,m,list,now){
 const waitFor=list.map(x=>x.id);
 m.callPass={approvedAt:now,station:m.station,round:m.round,bracket:m.bracket||null,waitFor,deferCount:1,autoAccepted:true};
 m.skipWaitFor=waitFor;m.skippedAt=now;m.skipManualOnly=false;m.resumeQueuedAt=null;m.status='pending';m.dispatchRevision=Number(m.dispatchRevision||0)+1;m.updatedAt=now;
 const court=s.courtAssignments['court'+m.station];
 court.currentMatchId=list[0].id;
 // After the one deferred match completes, the PASS match is the intended next match.
 court.nextMatchId=m.id;
 court.status='in_progress';court.updatedAt=now;
 list[0].status='in_progress';list[0].startedAt=list[0].startedAt||now;list[0].updatedAt=now;
 s.callRevision=Number(s.callRevision||0)+1;s.updatedAt=now;
}
module.exports={hash,active,tester,testerSandbox,canReferee,playerUid,matchUsers,passPredecessors,applyPass};
