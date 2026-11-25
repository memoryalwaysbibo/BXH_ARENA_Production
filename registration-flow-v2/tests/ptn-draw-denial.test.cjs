'use strict';

const {test}=require('node:test');
const assert=require('node:assert/strict');
const {authorizeTicketManager,checkTicketContract}=require('../backend/ticket-host.cjs');

test('PTN manager denials retain stable stages without exposing identities',async()=>{
 const now=Date.now(),uid='owner',code='PTN-DRAW01';
 const user={active:true,role:'player',partnerOrganizer:{status:'active',scope:'manual',organizationId:'org',expiresAtMs:now+60000}};
 const room={eventAuthority:'ticket',createdByRole:'partner_organizer',createdBy:uid,ownerUid:uid,
  ticketAccessV1:{ownerUid:uid,roomId:'room-id'},partnerOrganizationCode:'org',partnerContractOrderCode:null};
 const gate={roomCode:code,ownerUid:uid,roomId:'room-id'};
 const tx={get:async()=>({data:()=>user})},db={doc:()=>({})};
 const denied=(stage)=>error=>error.message==='permission-denied'&&error.ptnPermissionStage===stage;
 assert.equal((await authorizeTicketManager(tx,db,{uid,user,room,gate,code,now})).owner,true);
 await assert.rejects(authorizeTicketManager(tx,db,{uid,user,room:{...room,createdBy:'other'},gate,code,now}),denied('room-binding'));
 await assert.rejects(authorizeTicketManager(tx,db,{uid:'stranger',user,room,gate,code,now}),denied('actor-role'));
 await assert.rejects(authorizeTicketManager(tx,db,{uid,user:{...user,partnerOrganizer:{...user.partnerOrganizer,expiresAtMs:now-1}},room,gate,code,now}),denied('owner-grant'));
 assert.throws(()=>checkTicketContract({orderCode:'contract',targetUid:uid,status:'active',signedBy:uid,
  signatureHash:'signature',signedAt:now,startsAt:now-1000,expiresAt:now+60000},
 {order:'contract',startsAt:now-2000,expiresAt:now+60000},uid),denied('contract-proof'));
});
