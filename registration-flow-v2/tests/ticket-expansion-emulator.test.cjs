'use strict';
const assert=require('node:assert/strict');
const {test,after}=require('node:test');
const {randomBytes}=require('node:crypto');
const {db,service,handlers}=require('./harness.cjs');
const {createApi}=require('../backend/api.cjs');
const {createTicketRoomHandler,createTicketRoomStateHandler}=require('../backend/ticket-room-create.cjs');
const {createStartHandler,createDrawHandler}=require('../backend/lifecycle.cjs');
after(()=>db.terminate());

test('PTN prepaid expansion atomically updates canonical room, public mirror, ticket and inventory',async()=>{
 const {createHash}=require('node:crypto');
 const {createTicketExpansionHandler}=require('../backend/ticket-expansion.cjs');
 const now=Date.now(),uid='expand-'+randomBytes(6).toString('hex');
 const config=db.doc('systemSettings/commerceRoomExpansionV1');
 const inventory=db.doc('commerceEntitlements/'+createHash('sha256').update(JSON.stringify([uid,'room_expansion','tournament_expansion_1'])).digest('hex'));
 const sale=db.doc('systemSettings/commerceTicketPtnSaleV1');
 const previousSale=await sale.get(),previousConfig=await config.get();
 try{
  await db.doc('users/'+uid).set({active:true,role:'player',partnerOrganizer:{status:'active',scope:'manual',organizationId:uid,expiresAtMs:now+86400000}});
  await inventory.set({ownerUid:uid,kind:'room_expansion',assetId:'tournament_expansion_1',status:'active',expiresAt:null,quantity:50});
  await sale.set({enabled:true,productIds:{'32':'expansion-fixture-32','64':'expansion-fixture-64'}});
  const rooms=[];
  for(const base of [32,64]){
   const code='PTN-'+randomBytes(3).toString('hex').toUpperCase();
   const ticketId='BXH-SO-'+randomBytes(12).toString('hex').toUpperCase();
   const ticket=db.doc('commerceTickets/'+ticketId);
   await ticket.set({id:ticketId,orderId:ticketId,version:2,ownerUid:uid,status:'available',capacity:base,addedCapacity:0,boundRoomCode:null,boundRoomId:null,expiresAt:null,contractCode:null});
   await db.doc('commerceOrders/'+ticketId).set({id:ticketId,ownerUid:uid,ticketPurchaseVersion:3,paymentStatus:'paid',deliveryStatus:'delivered',
    ticketOrganizationId:uid,contractCode:null,amountTwd:base===32?300:600,
    productSnapshot:{id:'expansion-fixture-'+base,delivery:{kind:'ticket',assetId:String(base),quantity:1,durationDays:0}}});
   const create=createTicketRoomHandler({db,clock:()=>now,newPartnerCode:()=>code});
   const {roomId}=await create({auth:{uid},app:{},data:{action:'create-ticket-room',ticketId,operationId:'create-'+base,name:'Expansion fixture',
    location:'test',stations:1,registrationOpenAt:now-1000,registrationCloseAt:now+300000,startAt:now+600000}});
   rooms.push({code,roomId,ticket,base,room:db.doc('tournaments/'+code),pub:db.doc('publicTournaments/'+code)});
  }
  const expand=createTicketExpansionHandler({db,clock:()=>now+1000});
  const request=(r,quantity,operationId)=>({auth:{uid},app:{},data:{action:'ticket-room-expand',code:r.code,roomId:r.roomId,quantity,operationId}});
  const [a,b]=rooms,first=request(a,8,'expansion-first');
  const readRoom=createTicketRoomStateHandler({db,clock:()=>now+1000});
  const read=(r,actor=uid)=>readRoom({auth:{uid:actor},app:{},data:{action:'ticket-room-state',code:r.code}});
  await config.set({enabled:false,maxCapacity:160});
  await assert.rejects(expand(first),/expansion-unavailable/);
  assert.equal((await read(a)).expansionEnabled,false);
  await config.set({enabled:true,maxCapacity:160});
  const initial=await read(a);assert.equal(initial.expansionEnabled,true);assert.equal(initial.expansionMaxCapacity,160);
  const delegate=uid+'-delegate';await db.doc('users/'+delegate).set({active:true,role:'player'});
  await a.room.update({ptnDelegateUid:delegate});
  assert.equal((await read(a,delegate)).expansionEnabled,false);
  await assert.rejects(expand({...first,auth:{uid:delegate}}),/permission-denied/);
  await assert.rejects(expand({...first,auth:{uid:'other'}}),/permission-denied/);
  await assert.rejects(expand({...first,app:null}),/permission-denied/);
  const duplicates=await Promise.all([expand(first),expand(first)]);
  assert.equal(duplicates.filter(r=>r.replayed).length,1);
  assert.equal(duplicates[0].capacityAfter,40);
  assert.equal((await inventory.get()).data().quantity,42);
  assert.equal((await read(a)).capacity,40);
  await assert.rejects(expand(request(a,9,'expansion-first')),/operation-conflict/);
  const second=await expand(request(b,12,'expansion-second'));
  assert.equal(second.capacityAfter,76);assert.equal(second.balanceAfter,30);
  for(const [r,total,added] of [[a,40,8],[b,76,12]]){
   const [priv,pub,ticket]=await db.getAll(r.room,r.pub,r.ticket);
   assert.equal(priv.data().capacity,total);assert.equal(pub.data().capacity,total);
   assert.equal(JSON.parse(priv.data().data).meta.registrationCapacity,total);
   assert.equal(JSON.parse(pub.data().bracketView).meta.registrationCapacity,total);
   assert.equal(priv.data().ticketAccessV1.baseCapacity,r.base);
   assert.equal(priv.data().ticketAccessV1.addedCapacity,added);
   assert.equal(ticket.data().capacity,r.base);assert.equal(ticket.data().addedCapacity,added);
   assert.equal(pub.data().ticketAccessV1,undefined);
   assert.equal(pub.data().ownerUid,undefined);
  }
  await assert.rejects(expand(request(a,31,'expansion-insufficient')),/insufficient-expansion-tickets/);
  await config.set({enabled:true,maxCapacity:45});
  await assert.rejects(expand(request(a,6,'expansion-overflow')),/invalid-expansion-capacity/);
  await config.set({enabled:true,maxCapacity:160});
  // A conflicting mirror must not deduct or partly update inventory.
  await a.pub.update({capacity:41});
  await assert.rejects(expand(request(a,1,'expansion-stale')),/ticket-capacity-invalid/);
  await a.pub.update({capacity:40});
  await a.room.update({tournamentPhase:'live'});
  await assert.rejects(expand(request(a,1,'expansion-live')),/expansion-room-unavailable/);
  assert.equal((await inventory.get()).data().quantity,30);
  assert.equal((await a.room.get()).data().capacity,40);
  assert.equal((await a.ticket.get()).data().addedCapacity,8);
  await a.room.update({tournamentPhase:'waiting'});
  // The original ticket was 32; the expanded capacity must admit 40,
  // refuse the 41st, and use the same lifecycle/consumption as ordinary PTN.
  const players=Array.from({length:41},(_,i)=>uid+'-player-'+i);
  const batch=db.batch();
  for(const player of players)batch.set(db.doc('users/'+player),{active:true,role:'player',realName:'Fixture '+player,phone:'0000000000',profileCompleted:true});
  await batch.commit();
  const queue=service({requireRoomOwnership:true});
  const api=createApi({queue,family:handlers.family(db),enabled:async candidate=>candidate===a.code});
  for(const [i,player] of players.entries()){
   const operationId='expansion-join-'+i;
   const result=await api({auth:{uid:player},data:{action:'submit',code:a.code,operation:{route:'family',code:a.code,operationId,payload:{action:'join',code:a.code,operationId,childIds:[null],childEligibilityConfirmed:true}}}});
   assert.equal(result.operation.state,'queued');
  }
  await queue.drain(a.code,{limit:50,budgetMs:45000});
  const results=await Promise.all(players.map((player,i)=>queue.status(player,a.code,'expansion-join-'+i)));
  assert.equal(results.filter(x=>x.operation.state==='completed').length,40);
  assert.equal(results.filter(x=>x.operation.state==='rejected'&&x.operation.reason==='full').length,1);
  const privateState=JSON.parse((await a.room.get()).data().data);
  assert.equal(privateState.players.length,40);
  const options={db,clock:()=>now+2000,enabled:async candidate=>candidate===a.code};
  const draw=createDrawHandler(options),start=createStartHandler(options);
  const lifecycle={code:a.code,roomId:a.roomId,rosterRevision:privateState.registrationRosterRevision};
  const drawn=await draw({auth:{uid},data:{...lifecycle,baseDrawId:null,operationId:'expansion-draw'}});
  assert.equal((await a.ticket.get()).data().status,'reserved');
  await start({auth:{uid},data:{...lifecycle,drawId:drawn.drawId,confirmEarlyStart:true,operationId:'expansion-start'}});
  const startedTicket=(await a.ticket.get()).data();
  assert.equal((await read(a)).expansionEnabled,false);
  assert.equal(startedTicket.status,'consumed');assert.equal(startedTicket.capacity,32);assert.equal(startedTicket.addedCapacity,8);
  assert.equal((await a.room.get()).data().tournamentPhase,'live');
  assert.equal((await a.pub.get()).data().capacity,40);
  assert.equal((await inventory.get()).data().quantity,30);
 }finally{
  if(previousSale.exists)await sale.set(previousSale.data());else await sale.delete();
  if(previousConfig.exists)await config.set(previousConfig.data());else await config.delete();
 }
});
