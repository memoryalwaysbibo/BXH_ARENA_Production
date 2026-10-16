'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {transition,signToken,preserveCheckins}=require('./core.cjs');
const now=1800000000000,secret='test-only-key',code='BXH-ABC123';
function input(overrides={}) {
 const x={code,uid:'u1',user:{active:true,role:'player'},room:{qrCheckin:{enabled:true,session:'s1'}},state:{meta:{checkinRequired:true},players:[{id:'p1',name:'選手一',registrationUid:'u1',registrationId:'r1',checkedIn:false}]},registration:{status:'confirmed',uid:'u1'},config:{enabled:true,writerGuardsVerified:true,roomCodes:[code]},d:{action:'scan',token:signToken(code,'s1',now,secret)},now,secret,newSession:'s2'};
 return {...x,...overrides};
}
const rejects=(x,code)=>assert.throws(()=>transition(x),e=>e.code===code);
test('confirmed scan produces receipt and exactly one audit, using server time',()=>{
 const x=input(),r=transition(x);assert.equal(r.result.ok,true);assert.equal(r.receipt.firstAt,now);assert.equal(r.receipt.actorUid,'u1');assert.equal(r.audit.method,'qr');assert.equal(r.audit.accountUid,'u1');assert.equal(r.audit.registrationId,'r1');assert.equal(r.audit.checkedIn,true);assert.equal(r.audit.firstAt,now);assert.equal(x.state.players[0].checkedIn,false);
});
test('waitlist-only account cannot scan',()=>rejects(input({state:{meta:{checkinRequired:true},players:[],waitlistPlayers:[{registrationUid:'u1'}]}}),'not-confirmed'));
test('stale confirmed projection cannot override cancelled registration',()=>rejects(input({registration:{status:'cancelled',uid:'u1'}}),'not-confirmed'));
test('latest confirmed membership enables former waitlist immediately',()=>assert.equal(transition(input()).result.checkedIn,true));
test('name alone and request-supplied UID never grant check-in',()=>{
 const x=input();x.state.players[0].registrationUid='u2';x.d.uid='u2';rejects(x,'not-confirmed');
});
test('family child never inherits guardian scan',()=>{const x=input();x.state.players[0].familyPlayerId='child';rejects(x,'not-confirmed');});
test('multiple account matches require staff assistance',()=>{const x=input();x.state.players.push({...x.state.players[0],id:'p2'});rejects(x,'ambiguous-player');});
test('repeat scan returns original time without a new audit',()=>{
 const x=input();x.state.players[0].checkedIn=true;x.receipt={firstAt:now-10000,currentAt:now-10000};const r=transition(x);assert.equal(r.result.already,true);assert.equal(r.result.firstAt,now-10000);assert.equal(r.audit,undefined);
});
test('QR expires at server deadline',()=>{const x=input({now:now+90000});rejects(x,'qr-expired');});
test('forged QR and another room token are rejected',()=>{
 const x=input();x.d.token+='x';rejects(x,'invalid-qr');
 const y=input();y.d.token=signToken('BXH-OTHER1','s1',now,secret);rejects(y,'qr-expired');
});
test('old session becomes unusable after reopening',()=>{const x=input();x.room.qrCheckin.session='s2';rejects(x,'qr-expired');});
test('stopped check-in does not accept a still-valid QR',()=>{const x=input();x.room.qrCheckin.enabled=false;rejects(x,'checkin-closed');});
test('started, archived, early-closed and onsite-owned events fail closed',()=>{
 for(const patch of [{startedAt:1},{archiveStatus:'completed'},{meta:{checkinRequired:true,checkinClosedEarly:true}}]){const x=input();Object.assign(x.state,patch);rejects(x,'checkin-closed');}
 const x=input();x.room.onsiteWaitlistServerOwned=true;rejects(x,'onsite-integration-required');
});
test('rollout requires both writer verification and explicit room allowlist',()=>{
 for(const config of [{enabled:false},{enabled:true,writerGuardsVerified:false,roomCodes:[code]},{enabled:true,writerGuardsVerified:true,roomCodes:[]}])rejects(input({config}),'feature-unavailable');
});
test('disabled accounts cannot scan',()=>rejects(input({user:{role:'player',active:false}}),'account-unavailable'));
test('test-only identities cannot scan an official roster',()=>rejects(input({user:{role:'tester',active:true}}),'account-unavailable'));
test('non-ASCII forged signatures produce a controlled invalid-QR error',()=>{const x=input();x.d.token=x.d.token.split('.')[0]+'.'+'漢'.repeat(43);rejects(x,'invalid-qr');});
test('player cannot manage or forge operator authority',()=>rejects(input({d:{action:'configure',enabled:true,role:'super_admin'}}),'permission-denied'));
test('manager manual check-in and revoke retain first time and operator',()=>{
 const x=input({uid:'staff1',user:{active:true,role:'admin'},d:{action:'manual',playerId:'p1',operationId:'operation-0000001'}});
 const r=transition(x);assert.equal(r.receipt.method,'manual');assert.equal(r.receipt.actorUid,'staff1');assert.equal(r.audit.accountUid,'u1');assert.equal(r.audit.actorUid,'staff1');
 x.state.players[0].checkedIn=true;x.receipt=r.receipt;x.d={...x.d,action:'revoke'};x.now+=1000;
 const revoke=transition(x);assert.equal(revoke.receipt.firstAt,now);assert.equal(revoke.receipt.currentAt,null);assert.equal(revoke.receipt.checkedIn,false);
 x.state.players[0].checkedIn=false;x.receipt=revoke.receipt;x.d.action='manual';x.now+=1000;
 assert.equal(transition(x).receipt.firstAt,now);
});
test('manual operation replay returns committed result after subsequent revocation',()=>{
 const x=input({uid:'staff1',user:{active:true,role:'admin'},d:{action:'manual',playerId:'p1',operationId:'operation-0000001'}}),r=transition(x);
 x.operation=r.operation;x.state.players[0].checkedIn=false;
 const replay=transition(x);assert.deepEqual(replay.result,r.result);assert.equal(replay.receipt,undefined);
});
test('operation id cannot be repurposed to another action',()=>{
 const x=input({uid:'staff1',user:{active:true,role:'admin'},d:{action:'revoke',playerId:'p1',operationId:'operation-0000001'},operation:{actorUid:'staff1',action:'manual',playerId:'p1',result:{ok:true}}});rejects(x,'operation-conflict');
});
test('manual cannot silently promote a waitlist player',()=>rejects(input({user:{active:true,role:'admin'},d:{action:'manual',playerId:'waitlist-id',operationId:'operation-0000001'}}),'not-confirmed'));
test('ledger restores server-owned check-ins after a stale full-state save',()=>{
 const s={players:[{id:'p1',checkedIn:false},{id:'p2',checkedIn:true}]};
 preserveCheckins(s,[{playerId:'p1',checkedIn:true,firstAt:now,currentAt:now,method:'qr'}]);assert.equal(s.players[0].checkedIn,true);assert.equal(s.players[1].checkedIn,true);
});
test('status after tournament starts never issues a working QR',()=>{
 const x=input({user:{active:true,role:'admin'},d:{action:'status'}});x.state.startedAt=1;assert.equal(transition(x).result.token,null);
});
function eventStaffInput(){
 const organizer={role:'player',active:true,partnerOrganizer:{status:'active',organizationId:'org1',orderCode:'ORDER1',expiresAtMs:now+100000}};
 const room={createdBy:'organizer',createdByRole:'partner_organizer',eventAuthority:'official',partnerOrganizationCode:'org1',partnerContractOrderCode:'ORDER1',qrCheckin:{enabled:true,session:'s1'}};
 const C=require('./event-staff-core.cjs');
 room.eventStaffAssignments={helper:{...C.makeInvitation({eventCode:code,targetUid:'helper',organizerUid:'organizer',organizerProfile:organizer,tournament:room,duties:['checkin'],displayName:'報到人員',now}),status:'accepted'}};
 return input({uid:'helper',user:{role:'player',active:true},parentUser:organizer,room,d:{action:'status'}});
}
test('accepted event staff can manage check-in using the deployed grant model',()=>assert.equal(transition(eventStaffInput()).result.ok,true));
test('revoking parent organizer immediately removes event staff authority',()=>{const x=eventStaffInput();x.parentUser.partnerOrganizer.status='revoked';rejects(x,'permission-denied');});
test('expired parent organizer immediately removes event staff authority',()=>{const x=eventStaffInput();x.parentUser.partnerOrganizer.expiresAtMs=now-1;rejects(x,'permission-denied');});
test('invited but unaccepted event staff cannot manage check-in',()=>{const x=eventStaffInput();x.room.eventStaffAssignments.helper.status='invited';rejects(x,'permission-denied');});
test('a stale user membership does not override a revoked room assignment',()=>{const x=eventStaffInput();x.user.eventStaffMemberships={[code]:{status:'accepted'}};x.room.eventStaffAssignments.helper.status='revoked';rejects(x,'permission-denied');});
test('active partner organizer manages only the matching event and contract',()=>{const x=eventStaffInput();x.uid='organizer';x.user=x.parentUser;assert.equal(transition(x).result.ok,true);x.room.partnerContractOrderCode='OTHER';rejects(x,'permission-denied');});
test('regular staff follows the existing room assignment scope',()=>{const x=input({uid:'staff1',user:{role:'staff',active:true},d:{action:'status'}});assert.equal(transition(x).result.ok,true);x.room.assignedStaffUids=['other'];rejects(x,'permission-denied');});
