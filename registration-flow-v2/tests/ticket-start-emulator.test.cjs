'use strict';

const assert=require('node:assert/strict');
const {test,after}=require('node:test');
const {randomBytes}=require('node:crypto');
const {db,service,handlers}=require('./harness.cjs');
const {createApi}=require('../backend/api.cjs');
const {createTicketRoomHandler,createPtnStatusHandler,createTicketRoomStateHandler,createTicketScheduleHandler,createTicketStationsHandler,createTicketRemoveHandler,createTicketDelegateHandler,createTicketDelegateSearchHandler}=require('../backend/ticket-room-create.cjs');
const {createStartHandler,createDrawHandler,createTicketForfeitHandler,createTicketScoreHandler}=require('../backend/lifecycle.cjs');
const {createEngine}=require('../../referee-seats/functions/engine/index.cjs');

after(()=>db.terminate());

test('two-player PTN match produces a champion with the shared bracket engine',()=>{
 const now=Date.now(),state={cloudCode:'PTN-TEST01',startedAt:now,archiveStatus:'ongoing',
  bracketSize:2,meta:{eventAuthority:'ticket',formatType:'single',battleMode:'individual',stations:1},
  players:[{id:'a',name:'甲'},{id:'b',name:'乙'}],courtAssignments:{},
  matches:[{id:'final',bracket:'SE',round:0,indexInRound:0,seq:0,station:1,
   a:{type:'player',playerId:'a'},b:{type:'player',playerId:'b'},status:'ready',
   scoreA:0,scoreB:0,log:[],completed:false}]};
 const match=state.matches[0],engine=createEngine(state,{uid:'owner',name:'主辦'},now,'two-player-final');
 for(let i=0;i<4;i++){
  match.log.push(engine.createHunterRoundEvent(match,'A','spin',1,now+i));
  match.scoreA++;
 }
 const decision=engine.evaluateMatchCompletion(match);
 assert.equal(decision.ok,true);
 engine.applyMatchCompletionFields(match,decision,'主辦');
 engine.rebuildPropagationForState(state);
 assert.equal(match.winnerId,'a');
 assert.equal(state.championId,'a');
 assert.equal(state.runnerUpId,'b');
});

for(const ptn of [false,true])test(`${ptn?'PTN':'BXH'} ticket room reserves once and only a successful start consumes the ticket`,async()=>{
 const code=ptn?'PTN-'+randomBytes(3).toString('hex').toUpperCase():'BXH-T'+randomBytes(5).toString('hex').toUpperCase();
 const owner='holder-'+code,other='other-'+code;
 let roomId='ticket-room-preserved-generation';
 const ticketId='BXH-SO-'+code.replace(/[^A-Z0-9]/g,'').padEnd(24,'0');
 const now=Date.now(),contract='contract-'+code;
 const room=db.doc('tournaments/'+code),pub=db.doc('publicTournaments/'+code);
 const ticket=db.doc('commerceTickets/'+ticketId),order=db.doc('commerceOrders/'+ticketId);
 const contractRef=db.doc('partnerContracts/'+contract);
 const release=db.doc('systemSettings/'+(ptn?'commerceTicketPtnPilotV1':'commerceTicketLifecycleV1'));
 const startsAt=new Date(now-1000).toISOString(),expiresAt=new Date(now+86400000).toISOString();
 await release.delete();
 const initial=db.batch();
 initial.set(db.doc('users/'+owner),{active:true,role:'player',partnerContractOrderCode:contract,
  partnerOrganizer:{status:'active',scope:'contract',organizationId:'fixture-org',organizationName:'測試主辦',orderCode:contract,startsAt,expiresAt}});
 initial.set(db.doc('users/'+other),{active:true,role:'player'});
 initial.set(contractRef,{orderCode:contract,status:'active',targetUid:owner,signedBy:owner,
  signatureHash:'fixture-signature',signedAt:startsAt,startsAt,expiresAt,usedEvents:1});
 initial.set(ticket,{id:ticketId,orderId:ticketId,version:1,ownerUid:owner,contractCode:contract,status:'available',
  capacity:32,addedCapacity:0,boundRoomCode:null,expiresAt:now+86400000});
 initial.set(order,{id:ticketId,ownerUid:owner,paymentStatus:'paid',deliveryStatus:'delivered',
  ticketOrganizationId:'fixture-org',contractCode:contract,productSnapshot:{delivery:{kind:'ticket',assetId:'32'}}});
 await initial.commit();

 let attempts=0;
 const collisionCode=code==='PTN-000000'?'PTN-000001':'PTN-000000';
 if(ptn)await db.doc('publicTournaments/'+collisionCode).set({sentinel:true});
 const create=createTicketRoomHandler({db,clock:()=>now,newPartnerCode:()=>++attempts<=6?collisionCode:code});
 const creation={auth:{uid:owner},app:{appId:'fixture-app'},data:{action:'create-ticket-room',...(ptn?{}:{code}),ticketId,
  operationId:'ticket-fixture-create',name:'Fixture',location:'Tainan',stations:1,
  registrationOpenAt:now-2000,registrationCloseAt:now+300000,startAt:now+600000}};
 await assert.rejects(create(creation),/ticket-lifecycle-disabled/);
 await release.set({bindingEnabled:true,enabled:ptn,...(ptn?{}:{roomCode:code,roomId}),ownerUid:owner});
 const ptnStatus=createPtnStatusHandler({db,clock:()=>now});
 const ptnStatusRequest={auth:creation.auth,app:creation.app,data:{action:'ticket-ptn-status'}};
 if(ptn){
  assert.equal((await ptnStatus(ptnStatusRequest)).code,null);
  await assert.rejects(ptnStatus({...ptnStatusRequest,auth:{uid:other}}),/permission-denied/);
  await assert.rejects(create({...creation,data:{...creation.data,code}}),/invalid-operation/);
 }
 await assert.rejects(create({...creation,app:null}),/permission-denied/);
 await assert.rejects(create({...creation,auth:{uid:other}}),/permission-denied/);
 await assert.rejects(create({...creation,data:{...creation.data,capacity:160}}),/invalid-operation/);
 await order.update({paymentStatus:'pending'});
 await assert.rejects(create(creation),/ticket-binding-invalid/);
 assert.equal((await ticket.get()).data().status,'available');
 assert.equal((await room.get()).exists,false);
 assert.equal((await pub.get()).exists,false);
 await order.update({paymentStatus:'paid'});

 if(ptn)attempts=5;
 const creations=await Promise.all([create(creation),create(creation)]);
 if(ptn){
  roomId=creations[0].roomId;
  assert.match(roomId,/^[a-f0-9-]{36}$/);
  assert.equal((await ptnStatus(ptnStatusRequest)).code,code);
  assert.equal((await db.doc('publicTournaments/'+collisionCode).get()).data().sentinel,true);
  await assert.rejects(create({...creation,data:{...creation.data,operationId:'another-ticket-create'}}),/room-code-conflict/);
 }
 assert.ok(creations.every(result=>result.code===code));
 assert.equal(creations.filter(result=>result.replayed).length,1);
 assert.ok(creations.every(result=>result.roomId===roomId));
 assert.equal((await ticket.get()).data().status,'reserved');
 assert.equal((await contractRef.get()).data().usedEvents,1);
 const [createdRoom,createdPub]=await db.getAll(room,pub);
 assert.equal(createdRoom.data().capacity,32);
 assert.equal(createdRoom.data().createdByRole,'partner_organizer');
 assert.equal(createdPub.data().ownerUid,undefined);
 assert.equal(createdPub.data().ticketAccessV1,undefined);
 assert.equal(createdPub.data().capacity,32);
 if(ptn)assert.equal(createdPub.data().hostName,'測試主辦');
 assert.doesNotMatch(JSON.stringify(createdPub.data()),new RegExp(ticketId));
 const status=createTicketRoomStateHandler({db,clock:()=>now});
 const statusRequest={auth:creation.auth,app:creation.app,data:{action:'ticket-room-state',code}};
 await assert.rejects(status({...statusRequest,auth:{uid:other}}),/permission-denied/);
 const waiting=await status(statusRequest);
 if(ptn)assert.equal(waiting.ticketStatus,'reserved');
 assert.deepEqual(waiting,{ok:true,code,roomId,name:'Fixture',location:'Tainan',capacity:32,confirmedCount:0,
  phase:'waiting',startAt:now+600000,stations:1,
  registrationOpenAt:now-2000,registrationCloseAt:now+300000,registrationEnabled:true,updatedAt:now,
  drawId:null,rosterRevision:0,eligibleCount:0,drawReady:false,participants:[],...(ptn?{ticketStatus:'reserved',delegateUid:null,delegateName:null,delegateGameId:null,canAssignDelegate:true,refereeSeatView:null}:{})});
 if(ptn){
  const delegate='delegate-'+code,admin='super-'+code,unrelated='unrelated-'+code;
  await db.doc('users/'+delegate).set({active:true,role:'player',realName:'同名測試',gameId:'delegate-one'});
  const duplicate='duplicate-'+code;
  await db.doc('users/'+duplicate).set({active:true,role:'player',realName:'同名測試',gameId:'delegate-two'});
  await db.doc('users/'+admin).set({active:true,role:'super_admin'});
  await db.doc('users/'+unrelated).set({active:true,role:'player',partnerOrganizer:{status:'active',scope:'manual',organizationId:'fixture-org',startsAt:now-1000,expiresAt:now+86400000}});
  const assign=createTicketDelegateHandler({db,clock:()=>now});
  const search=createTicketDelegateSearchHandler({db,clock:()=>now});
  const lookup={auth:{uid:owner},app:creation.app,data:{action:'ticket-room-delegate-search',code,query:'同名測試'}};
  await assert.rejects(search({...lookup,auth:{uid:admin}}),/permission-denied/);
  await assert.rejects(search({...lookup,auth:{uid:unrelated}}),/permission-denied/);
  await assert.rejects(search({...lookup,app:null}),/permission-denied/);
  assert.deepEqual((await search(lookup)).players.map(p=>p.gameId).sort(),['delegate-one','delegate-two']);
  assert.equal((await search({...lookup,data:{...lookup.data,query:'delegate-two'}})).players[0].uid,duplicate);
  const permission={auth:{uid:delegate},app:creation.app,data:{action:'ticket-room-state',code}};
  await assert.rejects(status(permission),/permission-denied/);
  await assert.rejects(status({...permission,auth:{uid:unrelated}}),/permission-denied/);
  assert.equal((await status({...permission,auth:{uid:admin}})).canAssignDelegate,false);
  const assignment={auth:{uid:owner},app:creation.app,data:{action:'ticket-room-delegate',code,delegateUid:delegate}};
  await assert.rejects(assign({...assignment,auth:{uid:admin}}),/permission-denied/);
  await assert.rejects(assign({...assignment,auth:{uid:unrelated}}),/permission-denied/);
  await assert.rejects(assign({...assignment,data:{...assignment.data,delegateUid:unrelated},auth:{uid:other}}),/permission-denied/);
  assert.equal((await assign(assignment)).delegateUid,delegate);
  assert.equal((await status(permission)).canAssignDelegate,false);
  assert.equal((await status(statusRequest)).delegateUid,delegate);
  assert.equal((await status(statusRequest)).delegateName,'同名測試');
  assert.equal((await status(statusRequest)).delegateGameId,'delegate-one');
  assert.equal((await status({...permission,auth:{uid:unrelated}}).catch(e=>e.message)),'permission-denied');
  await assign({...assignment,data:{...assignment.data,delegateUid:null}});
  await assert.rejects(status(permission),/permission-denied/);
  await assign(assignment);
 }
 const schedule=createTicketScheduleHandler({db,clock:()=>now+1000});
 const edit={auth:creation.auth,app:creation.app,data:{action:'ticket-room-schedule',code,
  operationId:'edit-ticket-schedule',expectedUpdatedAt:now,registrationOpenAt:now-2000,
  registrationCloseAt:now+400000,startAt:now+600000}};
 if(!ptn)await assert.rejects(schedule(edit),/invalid-operation/);
 if(ptn){
 await assert.rejects(schedule({...edit,auth:{uid:other}}),/permission-denied/);
 assert.equal((await schedule(edit)).ok,true);
 assert.equal((await schedule(edit)).replayed,true);
 await assert.rejects(schedule({...edit,data:{...edit.data,operationId:'another-edit'}}),/version-conflict/);
 await assert.rejects(schedule({...edit,data:{...edit.data,startAt:now+86400000}}),/operation-conflict/);
 assert.equal((await room.get()).data().registrationCloseAt,now+400000);
 assert.equal((await pub.get()).data().registrationCloseAt,now+400000);
 assert.equal(JSON.parse((await room.get()).data().data).meta.registrationCloseAt,now+400000);
 assert.equal(JSON.parse((await pub.get()).data().bracketView).meta.registrationCloseAt,now+400000);
 }
 await assert.rejects(create({...creation,data:{...creation.data,name:'Changed'}}),/operation-conflict/);
 if(!ptn){
  const otherCode=code+'B';
  await release.update({roomCode:otherCode});
  await assert.rejects(create({...creation,data:{...creation.data,code:otherCode,operationId:'ticket-other-room'}}),/ticket-unavailable/);
  await release.update({roomCode:code});
 }
 if(ptn){
  // The candidate uses the same Firestore seat and inbox transaction before
  // opening; neither the reserved ticket nor the drawn bracket is consumed.
  const {createTicketRefereeHandler}=require('../backend/ticket-referee-seat.cjs');
  await db.doc('systemConfig/refereeSeatsV1').set({enabled:true,perCourtScoringVerified:true,ticketSeatsEnabled:true});
  const staff='staff-'+code,qrPlayer='qr-ref-'+code;
  await db.doc('users/'+staff).set({active:true,role:'staff',realName:'Fixture Staff'});
  await db.doc('users/'+qrPlayer).set({active:true,role:'player',realName:'Fixture QR'});
  const seat=createTicketRefereeHandler({db,enabled:async c=>c===code,clock:()=>now+1100});
  const command=(uid,seatAction,operationId,fields)=>({auth:{uid},app:creation.app,data:{action:'ticket-room-referee',code,seatAction,operationId,...fields}});
  const mail=await seat(command(owner,'invite','fixture-mail-invite',{station:1,slot:'main',targetUid:other,expectedCourtRevision:0}));
  await seat(command(other,'accept-invite','fixture-mail-accept',{station:1,slot:'main',requestId:mail.requestId}));
  const qr=await seat(command(owner,'create-qr','fixture-qr-create',{station:1,slot:'backup1',expectedCourtRevision:1}));
  await seat(command(qrPlayer,'accept-qr','fixture-qr-accept',{requestId:qr.requestId,qrToken:qr.qrToken}));
  await seat(command(staff,'claim','fixture-staff-claim',{station:1,slot:'backup2',expectedCourtRevision:2}));
  const seatView=(await status(statusRequest)).refereeSeatView;
  assert.equal(seatView.courts[1].backup1.name,'Fixture QR');
  assert.equal(seatView.courts[1].backup2.name,'Fixture Staff');
  assert.equal((await db.doc('users/'+other+'/communityRefereeInbox/ref-invite-'+mail.requestId).get()).data().refereeInviteStatus,'accepted');
  assert.equal((await ticket.get()).data().status,'reserved');
 }
 assert.equal(createdPub.data().registrationQueueVersion,2);
 const playerIds=Array.from({length:33},(_,i)=>'ticket-'+code+'-'+i);
 const profiles=db.batch();
 for(const uid of playerIds)profiles.set(db.doc('users/'+uid),{active:true,role:'player',realName:'Fixture '+uid,phone:'0000000000',profileCompleted:true});
 await profiles.commit();
 const queue=service({requireRoomOwnership:true});
 const api=createApi({queue,family:handlers.family(db),enabled:async candidate=>candidate===code});
 const submit=(uid,action,operationId,route='family')=>api({auth:{uid},data:{action:'submit',code,operation:{route,code,operationId,
  payload:{action,code,operationId,...(action==='join'?{childIds:[null],childEligibilityConfirmed:true}:{registrationId:uid,intent:'player'})}}}});
 const ops=playerIds.map((uid,i)=>({uid,id:'join-ticket-'+i}));
 for(const {uid,id} of ops)assert.equal((await submit(uid,'join',id)).operation.state,'queued');
 await queue.drain(code,{limit:40,budgetMs:45000});
 const results=await Promise.all(ops.map(({uid,id})=>queue.status(uid,code,id)));
 assert.equal(results.filter(x=>x.operation.state==='completed').length,32);
 assert.equal(results.filter(x=>x.operation.state==='rejected'&&x.operation.reason==='full').length,1);
 const cancelUid=ops[results.findIndex(x=>x.operation.state==='completed')].uid;
 const full=await status(statusRequest);
 assert.equal(full.eligibleCount,32);
 assert.equal((await pub.get()).data().confirmedCount,32);
 assert.equal(JSON.parse((await pub.get()).data().bracketView).players.length,32);
 await submit(cancelUid,'cancel','cancel-before-draw');
 await queue.drain(code);
 assert.equal((await queue.status(cancelUid,code,'cancel-before-draw')).operation.state,'completed');
 const synced=await status(statusRequest);
 assert.equal(synced.eligibleCount,31);
 const remainingUid=ops.find(({uid},i)=>uid!==cancelUid&&results[i].operation.state==='completed').uid;
 const options={db,clock:()=>now,enabled:async candidate=>candidate===code};
 const draw=createDrawHandler(options),start=createStartHandler(options);
 const request={auth:{uid:owner},data:{code,roomId,baseDrawId:null,rosterRevision:synced.rosterRevision,operationId:'ticket-fixture-draw'}};
 if(ptn)await release.update({enabled:false});
 await assert.rejects(draw(request),/ticket-lifecycle-disabled/);
 await release.update({enabled:true});
 await assert.rejects(draw({...request,auth:{uid:other}}),/permission-denied/);
 await ticket.update({boundRoomId:'replaced-room'});
 await assert.rejects(draw(request),/ticket-binding-invalid/);
 await ticket.update({boundRoomId:roomId});
 await pub.update({ladderMode:'general'});
 await assert.rejects(draw(request),/ticket-binding-invalid/);
 await pub.update({ladderMode:'ranked',capacity:64});
 await assert.rejects(draw(request),/ticket-capacity-invalid/);
 await pub.update({capacity:32});
 const firstDraw=await draw(request);
 assert.equal((await ticket.get()).data().status,'reserved');
 const confirmed=await status(statusRequest);
 assert.equal(confirmed.drawReady,true);
 assert.equal(confirmed.phase,'waiting');
 assert.ok(confirmed.bracket.length>0);
 assert.equal(confirmed.bracket.some(match=>match.canScore),false);
 assert.deepEqual(confirmed.matches,[]);
 if(ptn){
  const resize=createTicketStationsHandler({db,clock:()=>now+2000});
  const edit={auth:{uid:owner},app:{},data:{action:'ticket-room-stations',code,roomId,operationId:'ticket-resize-after-draw',expectedUpdatedAt:confirmed.updatedAt,stations:4}};
  await assert.rejects(resize({...edit,auth:{uid:other}}),/permission-denied/);
  await resize(edit);
  const resized=await status(statusRequest);
  assert.equal(resized.stations,4);assert.equal(resized.drawId,confirmed.drawId);assert.equal(resized.drawReady,true);
  const pairing=b=>b.map(m=>[m.id,m.a,m.b,m.winnerId]);
  assert.deepEqual(pairing(resized.bracket),pairing(confirmed.bracket));
  assert.ok(resized.bracket.filter(m=>!m.isBye).every(m=>m.station>=1&&m.station<=4));
  assert.equal(new Set(resized.bracket.filter(m=>!m.isBye).map(m=>m.station)).size,4);
  assert.equal((await ticket.get()).data().status,'reserved');
  // Return to one station to preserve subsequent single-court fixtures.
  await resize({...edit,data:{...edit.data,operationId:'ticket-resize-back',expectedUpdatedAt:resized.updatedAt,stations:1}});
 }
 const removalUid=confirmed.participants.find(player=>player.registrationId!==remainingUid).registrationId;
 const remove=createTicketRemoveHandler({db,queue,enabled:async candidate=>candidate===code,clock:()=>now});
 const removal={auth:creation.auth,app:creation.app,data:{action:'ticket-room-remove',code,
  registrationId:removalUid,operationId:'organizer-removal'}};
 await assert.rejects(remove({...removal,auth:{uid:other}}),/permission-denied/);
 await submit(remainingUid,'cancel','cancel-after-draw');
 await queue.drain(code);
 assert.equal((await queue.status(remainingUid,code,'cancel-after-draw')).operation.state,'completed');
 await room.update({cancellationDeadline:now-1});
 await pub.update({cancellationDeadline:now-1});
 await submit(removalUid,'cancel','cancel-after-deadline');
 await queue.drain(code);
 assert.equal((await queue.status(removalUid,code,'cancel-after-deadline')).operation.reason,'cancel-deadline-passed');
 assert.equal((await remove(removal)).operation.state,'queued');
 await queue.drain(code);
 assert.equal((await queue.status(owner,code,'organizer-removal')).operation.result.registrationId,removalUid);
 for(const uid of [remainingUid,removalUid])assert.equal((await room.collection('registrations').doc(uid).get()).data().status,'cancelled');
 assert.equal((await ticket.get()).data().status,'reserved');
 const changed=await status(statusRequest);
 assert.equal(changed.eligibleCount,29);
 assert.equal(changed.drawReady,false);
 assert.equal(changed.drawId,firstDraw.drawId);
 assert.ok(changed.bracket.length>0);
 await assert.rejects(start({auth:{uid:owner},data:{code,roomId,drawId:firstDraw.drawId,
  rosterRevision:changed.rosterRevision,confirmEarlyStart:true,operationId:'stale-ticket-bracket'}}),/bracket-roster-changed/);
 const result=await draw({auth:{uid:owner},data:{...request.data,baseDrawId:firstDraw.drawId,
  rosterRevision:changed.rosterRevision,operationId:'ticket-reshuffle'}});
 const startData={code,roomId,drawId:result.drawId,rosterRevision:changed.rosterRevision,confirmEarlyStart:true,operationId:'ticket-fixture-start'};
 const startRequest={auth:{uid:owner},data:startData};
 await assert.rejects(start({...startRequest,data:{...startData,drawId:'wrong-draw'}}),/bracket-version-conflict/);
 await ticket.update({expiresAt:now});
 await assert.rejects(start(startRequest),/ticket-expired/);
 assert.equal((await ticket.get()).data().status,'reserved');
 assert.equal((await room.get()).data().tournamentPhase,'waiting');
 assert.equal((await pub.get()).data().tournamentPhase,'waiting');

 await ticket.update({expiresAt:now+86400000});
 const starts=await Promise.all([start(startRequest),start(startRequest)]);
 assert.equal(starts.filter(result=>result.replayed).length,1);
 assert.ok(starts.every(result=>result.startedAt===now));
 const [savedRoom,savedPub,savedTicket]=await db.getAll(room,pub,ticket);
 assert.equal(savedRoom.data().tournamentPhase,'live');
 assert.equal(savedPub.data().tournamentPhase,'live');
 assert.equal(JSON.parse(savedPub.data().bracketView).startedAt,now);
 assert.equal(savedTicket.data().status,'consumed');
 assert.equal(savedTicket.data().usedAt,now);
 assert.equal(savedPub.data().ticketAccessV1,undefined);
 const live=await status(statusRequest);
 if(ptn){assert.equal(live.ticketStatus,'consumed');assert.equal(live.refereeSeatView.courts[1].backup1.name,'Fixture QR');assert.equal(live.refereeSeatView.courts[1].backup2.name,'Fixture Staff');}
 assert.equal(live.phase,'live');
 if(ptn)await assert.rejects(createTicketStationsHandler({db,clock:()=>now+3000})({auth:{uid:owner},app:{},data:{action:'ticket-room-stations',code,roomId,operationId:'ticket-resize-live-disabled',expectedUpdatedAt:live.updatedAt,stations:2}}),/court-room-not-live/);
 assert.equal(live.eligibleCount,29);
 assert.equal(live.drawId,result.drawId);
 assert.ok(live.bracket.length>live.matches.length);
 let scoredMatch={id:'not-scored'};
 if(ptn){
 const score=createTicketScoreHandler(options);
 const {createTicketRefereeHandler}=require('../backend/ticket-referee-seat.cjs');
 const referee=createTicketRefereeHandler(options);
 const scopedView=await referee({auth:{uid:other},app:creation.app,data:{action:'ticket-room-referee',code,seatAction:'view',operationId:'fixture-seat-view'}});
 assert.deepEqual(Object.keys(scopedView.refereeSeatControl.courts),['1']);
 assert.equal(scopedView.participants,undefined);
 assert.equal(scopedView.bracket.length,1);assert.equal(scopedView.bracket[0].canScore,true);
 scoredMatch=live.bracket.find(item=>item.id===scopedView.bracket[0].id);
 assert.ok(scoredMatch?.canScore);
 let scoreUpdatedAt=scoredMatch.updatedAt;
 const scoreRequest=(command,suffix,extra={})=>({auth:creation.auth,app:creation.app,
  data:{action:'ticket-room-score',code,roomId,matchId:scoredMatch.id,matchUpdatedAt:scoreUpdatedAt,
   operationId:'score-'+suffix,command,...extra}});
 await assert.rejects(score({...scoreRequest('score','no-app',{side:'A',finish:'spin'}),app:null}),/permission-denied/);
 await assert.rejects(score({...scoreRequest('score','other',{side:'A',finish:'spin'}),auth:{uid:other}}),/permission-denied/);
 for(let i=0;i<4;i++){
  const request=scoreRequest('score','point-'+i,{side:'A',finish:'spin'});
  if(i===0){
   request.auth={uid:other};Object.assign(request.data,{station:1,expectedCourtRevision:scopedView.refereeSeatControl.courts[1].revision});
   await assert.rejects(score({...request,auth:{uid:'qr-ref-'+code}}),/permission-denied/);
  }
  const saved=await score(request);
  assert.equal(saved.scoreA,i+1);
  assert.equal((await score(request)).replayed,true);
  scoreUpdatedAt=(await status(statusRequest)).bracket.find(item=>item.id===scoredMatch.id).updatedAt;
  await assert.rejects(score({...request,data:{...request.data,operationId:'stale-score-'+i}}),/score-match-stale/);
 }
 await assert.rejects(score(scoreRequest('score','too-many',{side:'B',finish:'spin'})),/score-match-stale/);
 assert.equal((await score(scoreRequest('undo','undo'))).scoreA,3);
 scoreUpdatedAt=(await status(statusRequest)).bracket.find(item=>item.id===scoredMatch.id).updatedAt;
 await assert.rejects(score(scoreRequest('confirm','too-early')),/score-result-not-ready/);
 await score(scoreRequest('score','last',{side:'A',finish:'spin'}));
 scoreUpdatedAt=(await status(statusRequest)).bracket.find(item=>item.id===scoredMatch.id).updatedAt;
 const confirmation=scoreRequest('confirm','confirm');
 const scoredDecision=await score(confirmation);
 assert.equal(scoredDecision.completed,true);
 assert.equal((await score(confirmation)).replayed,true);
 const projected=(await status(statusRequest)).bracket.find(item=>item.id===scoredMatch.id);
 assert.equal(projected.winnerId,scoredMatch.a.id);
 assert.equal(projected.scoreA,4);
 const [privateAfterScore,publicAfterScore]=await db.getAll(room,pub);
 assert.equal(JSON.parse(privateAfterScore.data().data).matches.find(item=>item.id===scoredMatch.id).winnerId,scoredMatch.a.id);
 assert.equal(JSON.parse(publicAfterScore.data().bracketView).matches.find(item=>item.id===scoredMatch.id).scoreA,4);
 assert.equal((await ticket.get()).data().status,'consumed');
 }
 await assert.rejects(remove({...removal,data:{...removal.data,operationId:'late-host-cancel'}}),/tournament-started/);
 await assert.rejects(submit(other,'cancel','late-player-cancel'),/tournament-started/);
 const forfeit=createTicketForfeitHandler(options);
 const match=(await status(statusRequest)).matches.find(item=>item.round===0&&item.id!==scoredMatch.id);
 assert.ok(match);
 const forfeitData={action:'ticket-room-forfeit',code,roomId,matchId:match.id,
  playerId:match.a.id,opponentId:match.b.id,matchUpdatedAt:match.updatedAt,operationId:'ticket-forfeit-once'};
 const forfeitRequest={auth:creation.auth,app:creation.app,data:forfeitData};
 await assert.rejects(forfeit({...forfeitRequest,app:null}),/permission-denied/);
 await assert.rejects(forfeit({...forfeitRequest,auth:{uid:other}}),/permission-denied/);
 await assert.rejects(forfeit({...forfeitRequest,data:{...forfeitData,opponentId:'missing-player'}}),/forfeit-match-stale/);
 const decisions=await Promise.all([forfeit(forfeitRequest),forfeit(forfeitRequest)]);
 assert.equal(decisions.filter(decision=>decision.replayed).length,1);
 const [forfeitedRoom,forfeitedPub,unchangedTicket]=await db.getAll(room,pub,ticket);
 const finalState=JSON.parse(forfeitedRoom.data().data),finalMirror=JSON.parse(forfeitedPub.data().bracketView);
 for(const state of [finalState,finalMirror]){
  const completed=state.matches.find(item=>item.id===match.id);
  assert.equal(completed.resultMethod,'forfeit');
  assert.equal(completed.winnerId,match.b.id);
  assert.equal(completed.loserId,match.a.id);
  assert.equal(completed.scoreA,null);
  assert.equal(completed.scoreB,null);
  assert.ok(state.matches.some(item=>item.round===1&&[item.a?.playerId,item.b?.playerId].includes(match.b.id)));
  assert.equal(state.players.length,29);
 }
 assert.deepEqual(unchangedTicket.data(),savedTicket.data());
 await assert.rejects(forfeit({...forfeitRequest,data:{...forfeitData,operationId:'another-forfeit'}}),/forfeit-match-stale/);
 if(ptn){
  // Real Firestore transaction: expansion after a score and a forfeit must
  // keep both decisions and the already-consumed voucher intact.
  const resize=createTicketStationsHandler(options);
  const current=(await room.get()).data();
  const command=(operationId,expectedUpdatedAt,fields)=>({auth:creation.auth,app:creation.app,data:{action:'ticket-room-stations',code,roomId,operationId,expectedUpdatedAt,...fields}});
  await resize(command('ticket-live-expand',current.updatedAt,{stations:2}));
  const expanded=(await room.get()).data(),expandedState=JSON.parse(expanded.data);
  assert.equal(expandedState.meta.stations,2);
  assert.equal(JSON.parse((await pub.get()).data().bracketView).meta.stations,2);
  assert.equal(expandedState.matches.find(m=>m.id===scoredMatch.id).scoreA,4);
  assert.equal(expandedState.matches.find(m=>m.id===match.id).winnerId,match.b.id);
  // Exercise the manager routing and correction handlers against real emulator
  // documents after expansion; the existing score/forfeit must stay intact.
  const routeStatus=createTicketRoomStateHandler(options);
  const readRoute=()=>routeStatus(statusRequest);
  const route=await readRoute(),court=route.courtControl.courts.find(c=>c.swapTargets.length);
  assert.ok(court,'expanded field has an eligible cross-court swap');
  const targetId=court.swapTargets[0],sourceId=court.currentMatchId;
  const targetStation=expandedState.matches.find(m=>m.id===targetId).station;
  const swap=command('ticket-emulator-swap',route.updatedAt,{command:'swap',station:court.station,matchId:sourceId,targetMatchId:targetId});
  await resize(swap);assert.equal((await resize(swap)).replayed,true);
  const readPair=async()=>{const [r,p]=await db.getAll(room,pub);return [JSON.parse(r.data().data),JSON.parse(p.data().bracketView)];};
  for(const document of await readPair()){
   assert.equal(document.courtAssignments['court'+court.station].currentMatchId,targetId);
   assert.equal(document.matches.find(m=>m.id===sourceId).station,targetStation);
  }
  const score=createTicketScoreHandler(options);
  const scoreRoute=async(suffix,kind='score')=>{
   const latest=(await readRoute()).bracket.find(m=>m.id===targetId);
   return score({auth:creation.auth,app:creation.app,data:{action:'ticket-room-score',code,roomId,matchId:targetId,
    matchUpdatedAt:latest.updatedAt,operationId:'ticket-emulator-route-'+suffix,command:kind,...(kind==='score'?{side:'A',finish:'knockout'}:{})}});
  };
  await scoreRoute('first');await scoreRoute('second');await scoreRoute('confirm','confirm');
  const previous=await readRoute();
  assert.equal(previous.courtControl.courts.find(c=>c.station===court.station).previousMatchId,targetId);
  const correction=command('ticket-emulator-correct',previous.updatedAt,{command:'correct',station:court.station,matchId:targetId,mode:'edit'});
  await resize(correction);assert.equal((await resize(correction)).replayed,true);
  for(const document of await readPair()){
   const corrected=document.matches.find(m=>m.id===targetId);
   assert.equal(corrected.completed,false);assert.equal(corrected.scoreA,4);assert.equal(corrected.winnerId,null);assert.equal(corrected.log.length,2);
  }
  await scoreRoute('reconfirm','confirm');
  const afterRouting=(await room.get()).data();
  await resize(command('ticket-live-shrink',afterRouting.updatedAt,{stations:1}));
  const shrinking=(await room.get()).data(),shrinkingState=JSON.parse(shrinking.data);
  const currentMatchId=shrinkingState.courtAssignments?.court2?.currentMatchId;
  if(currentMatchId)await resize(command('ticket-live-exit',shrinking.updatedAt,{command:'exit',station:2,matchId:currentMatchId}));
  assert.equal(JSON.parse((await room.get()).data().data).meta.stations,1);
  assert.equal(JSON.parse((await pub.get()).data().bracketView).meta.stations,1);
  assert.deepEqual((await ticket.get()).data(),savedTicket.data());
 }
 await release.update({enabled:false});
 assert.equal((await start(startRequest)).replayed,true);
 await assert.rejects(start({...startRequest,data:{...startData,operationId:'ticket-fresh-start'}}),/bracket-started/);
 await room.update({tournamentPhase:'done'});
 const history=await status(statusRequest);
 assert.equal(history.phase,'done');
 assert.equal(history.participants.length,29);
 assert.ok(history.participants.every(player=>player.name&&!Object.hasOwn(player,'registrationId')));
 assert.equal(history.bracket.length,finalState.matches.length);
 assert.equal(history.matches.length,0);
 assert.ok(history.bracket.every(item=>item.canScore===false));
});
