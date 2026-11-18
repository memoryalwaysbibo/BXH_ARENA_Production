'use strict';

const assert=require('node:assert/strict');
const {test,after}=require('node:test');
const {db,seed}=require('./harness.cjs');
const {createStartHandler,createDrawHandler}=require('../backend/lifecycle.cjs');

after(()=>db.terminate());

test('reserved activation ticket is consumed only by a successful trusted start',async()=>{
 const {code,ids:[owner,other]}=await seed(2,32);
 const roomId='ticket-room-preserved-generation';
 const ticketId='BXH-SO-'+code.replace(/[^A-Z0-9]/g,'').padEnd(24,'0');
 const now=Date.now();
 const room=db.doc('tournaments/'+code),pub=db.doc('publicTournaments/'+code);
 const ticket=db.doc('commerceTickets/'+ticketId);
 const release=db.doc('systemSettings/commerceTicketLifecycleV1');
 const state={id:roomId,cloudCode:code,updatedAt:now,meta:{
  name:'Ticket start fixture',eventAuthority:'ticket',ladderMode:'ranked',formatType:'single',battleMode:'individual',
  stations:1,registrationEnabled:true,registrationCapacity:32,checkinRequired:false
 },players:[{id:'first',name:'First'},{id:'second',name:'Second'}],matches:[],bracketSize:0,
 waitlistPlayers:[],registrationRosterRevision:0,courtAssignments:{}};
 const access={version:1,ticketId,ownerUid:owner,roomId,baseCapacity:32,addedCapacity:0};
 const initial=db.batch();
 initial.update(room,{eventAuthority:'ticket',ladderMode:'ranked',registrationQueueVersion:2,createdBy:owner,ownerUid:owner,
  createdByRole:'partner_organizer',partnerOrganizationCode:'fixture-org',partnerContractOrderCode:null,
  ticketAccessV1:access,data:JSON.stringify(state)});
 initial.update(pub,{eventAuthority:'ticket',ladderMode:'ranked',ticketRoomVersion:1,bracketView:JSON.stringify(state)});
 initial.update(db.doc('users/'+owner),{partnerOrganizer:{status:'active',scope:'manual',organizationId:'fixture-org',startsAtMs:now-1000,expiresAtMs:now+86400000}});
 initial.set(ticket,{id:ticketId,orderId:ticketId,version:1,ownerUid:owner,contractCode:null,status:'reserved',
  capacity:32,addedCapacity:0,boundRoomCode:code,boundRoomId:roomId,expiresAt:now+86400000});
 await initial.commit();
 const options={db,clock:()=>now,enabled:async candidate=>candidate===code};
 const draw=createDrawHandler(options),start=createStartHandler(options);
 const request={auth:{uid:owner},data:{code,roomId,baseDrawId:null,rosterRevision:0,operationId:'ticket-fixture-draw'}};
 await assert.rejects(draw(request),/ticket-lifecycle-disabled/);
 await release.set({enabled:true,roomCode:code,roomId});
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

 const startData={code,roomId,drawId:result.drawId,rosterRevision:0,operationId:'ticket-fixture-start'};
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
 await release.update({enabled:false});
 assert.equal((await start(startRequest)).replayed,true);
 await assert.rejects(start({...startRequest,data:{...startData,operationId:'ticket-fresh-start'}}),/bracket-started/);
});
