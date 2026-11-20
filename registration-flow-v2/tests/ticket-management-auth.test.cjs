'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {authorizeTicketManager}=require('../backend/ticket-host.cjs');

test('PTN authority belongs only to room owner, their one delegate and an active super admin',async()=>{
 const now=Date.now(),ownerUid='original-owner',delegateUid='appointed-delegate';
 const owner={active:true,role:'player',partnerOrganizer:{status:'active',scope:'manual',organizationId:'the-organization',startsAt:now-1000,expiresAt:now+86400000}};
 const delegate={active:true,role:'player'};
 const admin={active:true,role:'super_admin'};
 const other={active:true,role:'player',partnerOrganizer:owner.partnerOrganizer};
 const code='PTN-TEST01',room={eventAuthority:'ticket',createdBy:ownerUid,ownerUid,createdByRole:'partner_organizer',
  ptnDelegateUid:delegateUid,partnerOrganizationCode:'the-organization',partnerContractOrderCode:null,
  ticketAccessV1:{ownerUid,roomId:'room-identifier'}};
 const gate={ownerUid,roomCode:code,roomId:'room-identifier'};
 const db={doc:path=>path};
 const tx={get:async path=>({data:()=>path==='users/'+ownerUid?owner:null})};
 const authorize=(uid,user,currentRoom=room,currentGate=gate)=>authorizeTicketManager(tx,db,{uid,user,room:currentRoom,gate:currentGate,code,now});
 assert.equal((await authorize(ownerUid,owner)).owner,true);
 assert.equal((await authorize(delegateUid,delegate)).delegate,true);
 assert.equal((await authorize('highest-admin',admin)).admin,true);
 await assert.rejects(authorize('another-partner',other),/permission-denied/);
 await assert.rejects(authorize('second-delegate',delegate),/permission-denied/);
 await assert.rejects(authorize(delegateUid,{...delegate,active:false}),/permission-denied/);
 await assert.rejects(authorize(delegateUid,delegate,{...room,ptnDelegateUid:null}),/permission-denied/);
 await assert.rejects(authorize('highest-admin',admin,{...room,ownerUid:'someone-else'}),/permission-denied/);
 await assert.rejects(authorize('highest-admin',admin,{...room,createdByRole:'official'}),/permission-denied/);
 await assert.rejects(authorize('highest-admin',admin,room,{...gate,roomCode:'PTN-OTHER1'}),/permission-denied/);
});
