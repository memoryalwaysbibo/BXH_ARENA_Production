'use strict';

const assert=require('node:assert/strict');
const {test,after}=require('node:test');
const {randomBytes}=require('node:crypto');
const {db,service,handlers}=require('./harness.cjs');
const {createApi}=require('../backend/api.cjs');
const {createTicketRoomHandler,createTicketRoomStateHandler}=require('../backend/ticket-room-create.cjs');
const {createStartHandler,createDrawHandler}=require('../backend/lifecycle.cjs');

after(()=>db.terminate());

test('ticket room creation reserves once and only a successful start consumes the ticket',async()=>{
 const code='BXH-T'+randomBytes(5).toString('hex').toUpperCase(),owner='holder-'+code,other='other-'+code;
 const roomId='ticket-room-preserved-generation';
 const ticketId='BXH-SO-'+code.replace(/[^A-Z0-9]/g,'').padEnd(24,'0');
 const now=Date.now(),contract='contract-'+code;
 const room=db.doc('tournaments/'+code),pub=db.doc('publicTournaments/'+code);
 const ticket=db.doc('commerceTickets/'+ticketId),order=db.doc('commerceOrders/'+ticketId);
 const contractRef=db.doc('partnerContracts/'+contract);
 const release=db.doc('systemSettings/commerceTicketLifecycleV1');
 const startsAt=new Date(now-1000).toISOString(),expiresAt=new Date(now+86400000).toISOString();
 const initial=db.batch();
 initial.set(db.doc('users/'+owner),{active:true,role:'player',partnerContractOrderCode:contract,
  partnerOrganizer:{status:'active',scope:'contract',organizationId:'fixture-org',orderCode:contract,startsAt,expiresAt}});
 initial.set(db.doc('users/'+other),{active:true,role:'player'});
 initial.set(contractRef,{orderCode:contract,status:'active',targetUid:owner,signedBy:owner,
  signatureHash:'fixture-signature',signedAt:startsAt,startsAt,expiresAt,usedEvents:1});
 initial.set(ticket,{id:ticketId,orderId:ticketId,version:1,ownerUid:owner,contractCode:contract,status:'available',
  capacity:32,addedCapacity:0,boundRoomCode:null,expiresAt:now+86400000});
 initial.set(order,{id:ticketId,ownerUid:owner,paymentStatus:'paid',deliveryStatus:'delivered',
  ticketOrganizationId:'fixture-org',contractCode:contract,productSnapshot:{delivery:{kind:'ticket',assetId:'32'}}});
 await initial.commit();

 const create=createTicketRoomHandler({db,clock:()=>now});
 const creation={auth:{uid:owner},app:{appId:'fixture-app'},data:{action:'create-ticket-room',code,ticketId,
  operationId:'ticket-fixture-create',name:'Fixture',location:'Tainan',stations:1,
  registrationOpenAt:now-2000,registrationCloseAt:now+300000,startAt:now+600000}};
 await assert.rejects(create(creation),/ticket-lifecycle-disabled/);
 await release.set({bindingEnabled:true,enabled:false,roomCode:code,roomId,ownerUid:owner});
 await assert.rejects(create({...creation,app:null}),/permission-denied/);
 await assert.rejects(create({...creation,auth:{uid:other}}),/permission-denied/);
 await assert.rejects(create({...creation,data:{...creation.data,capacity:160}}),/invalid-operation/);
 await order.update({paymentStatus:'pending'});
 await assert.rejects(create(creation),/ticket-binding-invalid/);
 assert.equal((await ticket.get()).data().status,'available');
 assert.equal((await room.get()).exists,false);
 assert.equal((await pub.get()).exists,false);
 await order.update({paymentStatus:'paid'});

 const creations=await Promise.all([create(creation),create(creation)]);
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
 assert.doesNotMatch(JSON.stringify(createdPub.data()),new RegExp(ticketId));
 const status=createTicketRoomStateHandler({db,clock:()=>now});
 const statusRequest={auth:creation.auth,app:creation.app,data:{action:'ticket-room-state',code}};
 await assert.rejects(status({...statusRequest,auth:{uid:other}}),/permission-denied/);
 const waiting=await status(statusRequest);
 assert.deepEqual(waiting,{ok:true,code,roomId,name:'Fixture',phase:'waiting',startAt:now+600000,drawId:null,rosterRevision:0,eligibleCount:0});
 await assert.rejects(create({...creation,data:{...creation.data,name:'Changed'}}),/operation-conflict/);
 const otherCode=code+'B';
 await release.update({roomCode:otherCode});
 await assert.rejects(create({...creation,data:{...creation.data,code:otherCode,operationId:'ticket-other-room'}}),/ticket-unavailable/);
 await release.update({roomCode:code});
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
 const result=await draw(request);
 assert.equal((await ticket.get()).data().status,'reserved');
 const [drawnPrivate,drawnPublic]=await db.getAll(room,pub);
 const registration=room.collection('registrations').doc(remainingUid);
 assert.equal((await registration.get()).data().status,'confirmed');
 await submit(remainingUid,'cancel','cancel-after-draw');
 await submit(remainingUid,'cancel','cancel-legacy-route','roster');
 await queue.drain(code);
 for(const id of ['cancel-after-draw','cancel-legacy-route']){
  const rejected=(await queue.status(remainingUid,code,id)).operation;
  assert.equal(rejected.state,'rejected');
  assert.equal(rejected.reason,'roster-locked');
 }
 assert.equal((await registration.get()).data().status,'confirmed');
 const [lockedPrivate,lockedPublic]=await db.getAll(room,pub);
 assert.deepEqual(lockedPrivate.data(),drawnPrivate.data());
 assert.deepEqual(lockedPublic.data(),drawnPublic.data());
 assert.equal((await ticket.get()).data().status,'reserved');
 assert.equal((await status(statusRequest)).rosterRevision,synced.rosterRevision);

 const startData={code,roomId,drawId:result.drawId,rosterRevision:synced.rosterRevision,confirmEarlyStart:true,operationId:'ticket-fixture-start'};
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
 assert.equal(live.phase,'live');
 assert.equal(live.eligibleCount,31);
 assert.equal(live.drawId,result.drawId);
 await release.update({enabled:false});
 assert.equal((await start(startRequest)).replayed,true);
 await assert.rejects(start({...startRequest,data:{...startData,operationId:'ticket-fresh-start'}}),/bracket-started/);
});
