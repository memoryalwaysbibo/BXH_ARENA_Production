'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createTicketRoomHandler,createPtnStatusHandler}=require('../backend/ticket-room-create.cjs');
const {ticketGateForCode,authorizeTicketManager}=require('../backend/ticket-host.cjs');

test('a second paid ticket creates an independent PTN room and retries cannot consume it twice',async()=>{
 const now=1800000000000,owner='owner',oldCode='PTN-E50A3E',code='PTN-NEW001';
 const ticketId='BXH-SO-'+'A'.repeat(24),oldId='legacy-room-id',rows=new Map();
 const db={doc(path){return {path,collection(name){return {doc(id){return db.doc(path+'/'+name+'/'+id);}}}};},
  async getAll(...refs){return Promise.all(refs.map(ref=>tx.get(ref)));},
  async runTransaction(fn){return fn(tx);}};
 const snap=path=>({exists:rows.has(path),data:()=>rows.get(path)});
 const tx={get:async ref=>snap(ref.path),getAll:async(...refs)=>refs.map(ref=>snap(ref.path)),
  create(ref,value){assert.equal(rows.has(ref.path),false);rows.set(ref.path,value);},
  update(ref,patch){rows.set(ref.path,{...rows.get(ref.path),...patch});}};
 rows.set('users/'+owner,{active:true,role:'player',partnerOrganizer:{status:'active',scope:'manual',organizationId:'org',expiresAtMs:now+30*86400000}});
 rows.set('systemSettings/commerceTicketPtnPilotV1',{enabled:true,bindingEnabled:true,ownerUid:owner,roomCode:oldCode,roomId:oldId});
 rows.set('tournaments/'+oldCode,{ownerUid:owner,eventAuthority:'ticket',ticketAccessV1:{roomId:oldId,ownerUid:owner},createdBy:owner,createdByRole:'partner_organizer',partnerOrganizationCode:'org'});
 rows.set('commerceTickets/'+ticketId,{version:1,id:ticketId,orderId:ticketId,ownerUid:owner,status:'available',usedAt:null,
  boundRoomCode:null,boundRoomId:null,addedCapacity:0,expiresAt:now+20*86400000,capacity:32,contractCode:null});
 rows.set('commerceOrders/'+ticketId,{id:ticketId,ownerUid:owner,paymentStatus:'paid',deliveryStatus:'delivered',
  ticketOrganizationId:'org',contractCode:null,productSnapshot:{delivery:{kind:'ticket',assetId:'32'}}});
 const request={auth:{uid:owner},app:{},data:{action:'create-ticket-room',ticketId,operationId:'OP_NEW_01',name:'新測試房',
  location:'台南',stations:1,registrationOpenAt:now-1000,registrationCloseAt:now+3600000,startAt:now+7200000}};
 let candidate=0;
 const create=createTicketRoomHandler({db,clock:()=>now,newPartnerCode:()=>candidate++? 'PTN-NEW002':code});
 const first=await create(request),again=await create(request);
 assert.equal(first.code,code);assert.equal(again.replayed,true);assert.equal(again.roomId,first.roomId);
 assert.equal(rows.get('commerceTickets/'+ticketId).boundRoomCode,code);
 const gate=rows.get('systemSettings/commerceTicketPtnPilotV1');
 assert.equal(ticketGateForCode(gate,oldCode).roomId,oldId);
 assert.equal(ticketGateForCode(gate,code).roomId,first.roomId);
 assert.equal((await createPtnStatusHandler({db,clock:()=>now})({auth:{uid:owner},app:{},data:{action:'ticket-ptn-status'}})).code,code);
 const newRoom=rows.get('tournaments/'+code);
 assert.equal((await authorizeTicketManager(tx,db,{uid:owner,user:rows.get('users/'+owner),room:newRoom,gate,code,now})).owner,true);
 await assert.rejects(create({...request,data:{...request.data,operationId:'OP_NEW_02'}}),/ticket-unavailable/);
});
