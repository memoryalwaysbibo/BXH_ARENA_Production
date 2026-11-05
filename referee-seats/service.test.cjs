'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {harness,communityFixture,clone}=require('./test-harness.cjs');
test('callable writes seats, mirrors and audit atomically without changing match or fault data',async()=>{const h=harness();await h.run('host','enable');await h.run('main','claim',{station:1,slot:'main',expectedCourtRevision:0});const d=h.doc(),s=JSON.parse(d.data),mirror=JSON.parse(h.docs.get('publicTournaments/BXH-TEST').bracketView);assert.equal(d.refereeSeatsV1.courts['1'].main.uid,'main');assert.equal(s.matches[0].scoreA,2);assert.deepEqual(s.matches[0].faultActions,[{side:'A'}]);assert.equal(mirror.meta.refereeSeatNames['1'].main.name,'main');assert(!JSON.stringify(mirror).includes('"uid"'));assert(!JSON.stringify(mirror).includes('requests'));assert.equal([...h.docs.keys()].filter(k=>k.includes('/refereeSeatAudit/')).length,2);});
test('idempotent retry returns previous receipt and never creates two claims',async()=>{const h=harness();await h.run('host','enable');const request={auth:{uid:'main'},data:{code:'BXH-TEST',operationId:'idempotency-example-123',action:'claim',station:1,slot:'main',expectedCourtRevision:0}};const a=await h.handle(request),b=await h.handle(request);assert.deepEqual(a,b);assert.equal(h.doc().refereeSeatsV1.revision,2);await assert.rejects(h.handle({...request,data:{...request.data,slot:'backup1'}}),/operation-conflict/);});
test('concurrent same-seat requests produce exactly one successful claim',async()=>{const h=harness();await h.run('host','enable');const results=await Promise.allSettled(['main','backup'].map(uid=>h.run(uid,'claim',{station:1,slot:'main',expectedCourtRevision:0})));assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(h.doc().refereeStationUids.length,1);});
test('a lost eligibility after request blocks acceptance without mutating seats',async()=>{const h=harness();await h.run('host','enable');await h.run('main','claim',{station:1,slot:'main',expectedCourtRevision:0});const r=await h.run('backup','request',{station:1,slot:'main',expectedCourtRevision:1,expectedUid:'main'});h.docs.get('users/backup').active=false;const before=clone(h.doc());await assert.rejects(h.run('main','respond',{station:1,slot:'main',requestId:r.requestId,response:'accept'}),/requester-ineligible/);assert.deepEqual(h.doc(),before);});
test('unverified deployment fails closed and unauthenticated requests cannot invoke it',async()=>{const h=harness();h.docs.get('systemConfig/refereeSeatsV1').perCourtScoringVerified=false;await assert.rejects(h.run('host','enable'),/release-not-ready/);await assert.rejects(h.handle({data:{}}),/unauthenticated/);assert(!h.doc().refereeSeatsV1);});

test('community host initializes two courts once and retry checks current eligibility',async()=>{
 const h=harness(),room=h.doc(),state=JSON.parse(room.data);
 Object.assign(room,{eventAuthority:'community',ladderMode:'general',ownerUid:'host',assignedStaffUids:[]});
 Object.assign(state.meta,{eventAuthority:'community',ladderMode:'general',stations:2});
 room.data=JSON.stringify(state);
 const host=h.docs.get('users/host');host.role='player';
 const request={auth:{uid:'host'},data:{code:'BXH-TEST',operationId:'community-enable-123',action:'enable'}};
 await assert.rejects(h.handle(request),/room-read-only/);
 h.docs.get('systemConfig/refereeSeatsV1').communitySeatsEnabled=true;
 await assert.rejects(h.run('main','enable'),/permission-denied/);
 const result=await h.handle(request);
 assert.deepEqual(await h.handle(request),result);
 assert.deepEqual(Object.keys(h.doc().refereeSeatsV1.courts),['1','2']);
 assert.deepEqual(h.doc().assignedStaffUids,[]);
 assert.equal(JSON.parse(h.doc().data).matches[0].scoreA,2);
 assert.equal([...h.docs.keys()].filter(k=>k.includes('/refereeSeatAudit/')).length,1);
 host.active=false;
 await assert.rejects(h.handle(request),/not-event-staff/);
});

test('community host invites two players to separate courts; only the named player can accept',async()=>{
 const h=harness(),room=h.doc(),state=JSON.parse(room.data);
 Object.assign(room,{eventAuthority:'community',ladderMode:'general',ownerUid:'host',assignedStaffUids:[]});
 Object.assign(state.meta,{eventAuthority:'community',ladderMode:'general',stations:2});
 room.data=JSON.stringify(state);
 for(const uid of ['host','main','backup'])h.docs.get('users/'+uid).role='player';
 h.docs.get('systemConfig/refereeSeatsV1').communitySeatsEnabled=true;
 await h.run('host','enable');
 for(const [station,uid,other] of [[1,'main','backup'],[2,'backup','main']]){
  const slot='main';
  const {requestId}=await h.run('host','invite',{station,slot,targetUid:uid,expectedCourtRevision:0});
  await assert.rejects(h.run(other,'accept-invite',{station,slot,requestId}),/request-unavailable/);
  const mailPath='users/'+uid+'/communityRefereeInbox/ref-invite-'+requestId;
  assert.equal(h.docs.get(mailPath).refereeInviteStatus,'pending');
  await h.run(uid,'accept-invite',{station,slot,requestId});
  assert.equal(h.doc().refereeSeatsV1.courts[station].main.uid,uid);
  assert.equal(h.docs.get(mailPath).refereeInviteStatus,'accepted');
 }
 assert.deepEqual(h.doc().assignedStaffUids,[]);
});

test('a super admin who created a community room can invite by game ID and the player can accept',async()=>{
 const h=communityFixture();
 h.docs.get('users/host').role='super_admin';
 h.docs.get('users/main').gameId='PLAYER-123';
 h.docs.set('users/other-admin',{active:true,role:'super_admin',gameId:'OTHER'});
 await h.run('host','enable');
 const invite={station:1,slot:'main',targetGameId:'PLAYER-123',expectedCourtRevision:0};
 await assert.rejects(h.run('other-admin','invite',invite),/permission-denied/);
 const {requestId}=await h.run('host','invite',invite);
 assert.equal(h.docs.get('users/main/communityRefereeInbox/ref-invite-'+requestId).refereeInviteStatus,'pending');
 await h.run('main','accept-invite',{station:1,slot:'main',requestId});
 assert.equal(h.doc().refereeSeatsV1.courts[1].main.uid,'main');
 assert.equal(h.docs.get('users/main/communityRefereeInbox/ref-invite-'+requestId).refereeInviteStatus,'accepted');
});
test('staff room owner may invite, but a disabled room owner cannot issue new invitations',async()=>{
 const h=communityFixture();
 h.docs.get('users/host').role='staff';
 await h.run('host','enable');
 await h.run('host','invite',{station:1,slot:'backup1',targetUid:'backup',expectedCourtRevision:0});
 h.docs.get('users/host').active=false;
 await assert.rejects(h.run('host','invite',{station:1,slot:'main',targetUid:'main',expectedCourtRevision:0}),/room-read-only/);
 assert.equal(Object.keys(h.doc().refereeSeatsV1.requests).length,1);
});
test('three simultaneous invitations on one court remain usable after another seat accepts',async()=>{
 const h=communityFixture();h.docs.set('users/third',{active:true,role:'player'});await h.run('host','enable');
 const invites=[];
 for(const [uid,slot] of [['main','main'],['backup','backup1'],['third','backup2']]){
  const r=await h.run('host','invite',{station:1,slot,targetUid:uid,expectedCourtRevision:0});invites.push({uid,slot,requestId:r.requestId});
 }
 for(const {uid,...args} of invites)await h.run(uid,'accept-invite',{station:1,...args});
 const court=h.doc().refereeSeatsV1.courts[1];assert.equal(court.main.uid,'main');assert.equal(court.backup1.uid,'backup');assert.equal(court.backup2.uid,'third');
 const r=await h.run('backup','request',{station:1,slot:'main',expectedCourtRevision:3,expectedUid:'main'});
 await h.run('main','respond',{station:1,slot:'main',requestId:r.requestId,response:'accept'});
 assert.equal(h.doc().refereeSeatsV1.courts[1].main.uid,'backup');assert.equal(h.doc().refereeSeatsV1.courts[1].backup1.uid,'main');
 assert.equal(h.doc().refereeSeatsV1.courts[2].revision,0);
});
test('referee inbox only lists own invitations and inactive accounts cannot read or mark mail',async()=>{
 const h=communityFixture();await h.run('host','enable');
 const {requestId}=await h.run('host','invite',{station:1,slot:'main',targetUid:'main',expectedCourtRevision:0});
 const list=await h.run('main','invite-mail-list');assert.equal(list.messages.length,1);assert.equal((await h.run('backup','invite-mail-list')).messages.length,0);
 await h.run('main','invite-mail-read',{messageId:'ref-invite-'+requestId});assert.equal(h.docs.get('users/main/communityRefereeInbox/ref-invite-'+requestId).readAt,1000);
 await assert.rejects(h.run('backup','invite-mail-read',{messageId:'ref-invite-'+requestId}));
 h.docs.get('users/main').active=false;await assert.rejects(h.run('main','invite-mail-list'),/permission-denied/);
 await assert.rejects(h.run('main','invite-mail-read',{messageId:'ref-invite-'+requestId}),/permission-denied/);
});
test('an ended community invitation cannot assign a seat or mark its mail accepted',async()=>{
 const h=communityFixture();await h.run('host','enable');
 const {requestId}=await h.run('host','invite',{station:1,slot:'main',targetUid:'main',expectedCourtRevision:0});
 h.doc().tournamentPhase='done';const before=clone(h.doc());
 await assert.rejects(h.run('main','accept-invite',{station:1,slot:'main',requestId}),/community-result-available/);
 assert.deepEqual(h.doc(),before);assert.equal(h.docs.get('users/main/communityRefereeInbox/ref-invite-'+requestId).refereeInviteStatus,'pending');
});

test('game ID lookup survives transaction retries without mutating the idempotency payload',async()=>{
 const h=communityFixture();h.docs.get('users/main').gameId='PLAYER-123';await h.run('host','enable');
 const request={auth:{uid:'host'},data:{code:'BXH-TEST',action:'invite',operationId:'gameid-invite-retry-123',targetGameId:'PLAYER-123',station:1,slot:'main',expectedCourtRevision:0}};
 h.retry();const result=await h.handle(request);assert.deepEqual(await h.handle(request),result);
 assert(!Object.hasOwn(request.data,'targetUid'));assert.equal(h.doc().refereeSeatsV1.requests[result.requestId].toUid,'main');
 assert.equal([...h.docs.keys()].filter(k=>k.includes('/communityRefereeInbox/')).length,1);
});

const qrBase={station:1,slot:'main',expectedCourtRevision:0};
async function qrFixture(){const h=communityFixture();await h.run('host','enable');const q=await h.run('host','create-qr',qrBase);return {h,q,args:{requestId:q.requestId,qrToken:q.qrToken}};}
test('QR preview requires login and token, never grants a seat; confirmation claims once',async()=>{
 const {h,q,args}=await qrFixture();assert.match(q.qrToken,/^[\w-]{43}$/);
 const p=await h.run('main','inspect-qr',args);assert.equal(p.station,1);assert.equal(p.slot,'main');assert.equal(h.doc().refereeSeatsV1.courts[1].main,null);
 await assert.rejects(h.handle({data:{action:'inspect-qr',code:'BXH-TEST',...args}}),/unauthenticated/);
 await assert.rejects(h.run('main','accept-qr',{...args,qrToken:'X'.repeat(43)}),/invalid-qr/);
 await h.run('main','accept-qr',args);assert.equal(h.doc().refereeSeatsV1.courts[1].main.uid,'main');
 const mirror=h.docs.get('publicTournaments/BXH-TEST').bracketView;
 assert(!mirror.includes(q.qrToken));assert(!mirror.includes('tokenHash'));assert(!JSON.stringify(h.doc()).includes(q.qrToken));
 assert(![...h.docs.keys()].some(k=>k.includes('communityRefereeInbox')));
});
test('two players scanning one QR concurrently produce exactly one seated player',async()=>{
 const {h,args}=await qrFixture();const r=await Promise.allSettled(['main','backup'].map(uid=>h.run(uid,'accept-qr',args)));
 assert.equal(r.filter(x=>x.status==='fulfilled').length,1);assert.equal(h.doc().refereeStationUids.length,1);
});
test('lost QR acceptance response retries the original operation without another seat mutation',async()=>{
 const {h,args}=await qrFixture(),r={auth:{uid:'main'},data:{code:'BXH-TEST',operationId:'qr-accept-same-operation-123',action:'accept-qr',...args}};
 const first=await h.handle(r),rev=h.doc().refereeSeatsV1.revision;assert.deepEqual(await h.handle(r),first);assert.equal(h.doc().refereeSeatsV1.revision,rev);
 await h.run('host','revoke',{station:1,slot:'main',expectedUid:'main',expectedCourtRevision:1});
 await assert.rejects(h.handle(r),/qr-expired/);
});
test('QR creation retries return the original token and do not rotate an already displayed code',async()=>{
 const h=communityFixture();await h.run('host','enable');h.retry();
 const r={auth:{uid:'host'},data:{code:'BXH-TEST',operationId:'qr-create-same-operation-123',action:'create-qr',...qrBase}};
 const first=await h.handle(r);assert.deepEqual(await h.handle(r),first);assert.equal(Object.values(h.doc().refereeSeatsV1.requests).length,1);
});
test('replacement QR invalidates old code and five-minute expiry denies preview and acceptance',async()=>{
 const {h,args}=await qrFixture();await h.run('host','create-qr',qrBase);
 await assert.rejects(h.run('main','accept-qr',args),/qr-expired/);
 const q=await h.run('host','create-qr',qrBase),newArgs={requestId:q.requestId,qrToken:q.qrToken};h.advance(300001);
 for(const a of ['inspect-qr','accept-qr'])await assert.rejects(h.run('main',a,newArgs),/qr-expired/);
});
test('QR checks authoritative owner, player account, flags, cancellation and end of event',async()=>{
 for(const mutate of [h=>h.docs.get('users/host').active=false,h=>h.doc().ownerUid='other',h=>h.docs.get('users/main').active=false,h=>h.docs.get('users/main').isTestAccount=true,h=>h.docs.get('systemConfig/refereeSeatsV1').communitySeatsEnabled=false,h=>h.doc().eventCancelled=true,h=>h.doc().systemClosed=true,h=>h.doc().tournamentPhase='done']){
  const {h,args}=await qrFixture();mutate(h);const before=clone(h.doc());
  for(const a of ['inspect-qr','accept-qr'])await assert.rejects(h.run('main',a,args));assert.deepEqual(h.doc(),before);
 }
});
test('QR is bound to room and physical seat; caller-supplied station cannot redirect it',async()=>{
 const {h,args}=await qrFixture();await h.run('main','accept-qr',{...args,station:2,slot:'backup2',tokenHash:'forged'});
 assert.equal(h.doc().refereeSeatsV1.courts[1].main.uid,'main');assert.equal(h.doc().refereeSeatsV1.courts[2].backup2,null);
 const another=await qrFixture();another.h.doc().refereeSeatsV1.requests={};await assert.rejects(another.h.run('main','accept-qr',args),/invalid-qr/);
});
test('finished QR reports result available and creates no seat or receipt',async()=>{
 const {h,args}=await qrFixture();const s=JSON.parse(h.doc().data);s.completedAt=10;h.doc().data=JSON.stringify(s);
 const before=h.docs.size;for(const a of ['inspect-qr','accept-qr'])await assert.rejects(h.run('main',a,args),/community-result-available/);assert.equal(h.docs.size,before);
});
test('name lookup returns matching active players with game IDs, without private contact data',async()=>{
 const h=communityFixture();await h.run('host','enable');for(const uid of ['main','backup'])Object.assign(h.docs.get('users/'+uid),{realName:'同名玩家',gameId:uid,email:'secret',phone:'private'});
 const before=clone(h.doc()),r=await h.run('host','find-invite-player',{...qrBase,query:'同名玩家'});
 assert.equal(r.players.length,2);assert.deepEqual(Object.keys(r.players[0]).sort(),['gameId','name','uid']);assert.deepEqual(h.doc(),before);
 await assert.rejects(h.run('main','find-invite-player',{...qrBase,query:'同名玩家'}),/permission-denied/);
 await h.run('host','invite',{...qrBase,targetUid:r.players[1].uid});
 const req=Object.values(h.doc().refereeSeatsV1.requests)[0];assert.equal(req.toUid,'backup');
});
