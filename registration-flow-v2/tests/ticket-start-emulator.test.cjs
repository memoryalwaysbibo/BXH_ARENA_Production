'use strict';

const assert=require('node:assert/strict');
const {test,after}=require('node:test');
const {randomBytes}=require('node:crypto');
const {db,service,handlers}=require('./harness.cjs');
const {createApi}=require('../backend/api.cjs');
const {createTicketRoomHandler,createPtnStatusHandler,createTicketRoomStateHandler,createTicketRemoveHandler}=require('../backend/ticket-room-create.cjs');
const {createStartHandler,createDrawHandler,createTicketForfeitHandler}=require('../backend/lifecycle.cjs');

after(()=>db.terminate());

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
  await assert.rejects(create({...creation,data:{...creation.data,operationId:'another-ticket-create'}}),/ticket-ptn-slot-occupied/);
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
 assert.deepEqual(waiting,{ok:true,code,roomId,name:'Fixture',phase:'waiting',startAt:now+600000,drawId:null,rosterRevision:0,eligibleCount:0,drawReady:false,participants:[],...(ptn?{ticketStatus:'reserved'}:{})});
 await assert.rejects(create({...creation,data:{...creation.data,name:'Changed'}}),/operation-conflict/);
 if(!ptn){
  const otherCode=code+'B';
  await release.update({roomCode:otherCode});
  await assert.rejects(create({...creation,data:{...creation.data,code:otherCode,operationId:'ticket-other-room'}}),/ticket-unavailable/);
  await release.update({roomCode:code});
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
 if(ptn)assert.equal(live.ticketStatus,'consumed');
 assert.equal(live.phase,'live');
 assert.equal(live.eligibleCount,29);
 assert.equal(live.drawId,result.drawId);
 await assert.rejects(remove({...removal,data:{...removal.data,operationId:'late-host-cancel'}}),/tournament-started/);
 await assert.rejects(submit(other,'cancel','late-player-cancel'),/tournament-started/);
 const forfeit=createTicketForfeitHandler(options);
 const match=live.matches.find(item=>item.round===0);
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
 await release.update({enabled:false});
 assert.equal((await start(startRequest)).replayed,true);
 await assert.rejects(start({...startRequest,data:{...startData,operationId:'ticket-fresh-start'}}),/bracket-started/);
});
