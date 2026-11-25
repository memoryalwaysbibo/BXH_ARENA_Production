'use strict';

const {test}=require('node:test');
const assert=require('node:assert/strict');
const {authorizeTicketManager,checkTicketContract}=require('../backend/ticket-host.cjs');
const {createDrawHandler,createStartHandler}=require('../backend/lifecycle.cjs');

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

test('PTN draw authorizes against the independent sale-room gate before the shared draw',async()=>{
 const now=Date.now(),code='PTN-GATE01',uid='owner',roomId='sale-room-id';
 const user={active:true,role:'player',partnerOrganizer:{status:'active',scope:'manual',organizationId:'org',expiresAtMs:now+60000}};
 const room={eventAuthority:'ticket',createdByRole:'partner_organizer',createdBy:uid,ownerUid:uid,
  partnerOrganizationCode:'org',partnerContractOrderCode:null,ticketAccessV1:{ownerUid:uid,roomId},
  data:JSON.stringify({id:roomId})};
 const pub={eventAuthority:'ticket',bracketView:JSON.stringify({id:roomId})};
 const gate={enabled:true,bindingEnabled:true,roomCode:code,roomId,ownerUid:uid};
 const rows=new Map([['users/'+uid,user],['tournaments/'+code,room],['publicTournaments/'+code,pub],
  ['systemSettings/commerceTicketPtnPilotV1',{enabled:true,bindingEnabled:true,rooms:{}}],
  ['commerceTicketRoomGates/'+code,gate]]);
 const ref=path=>({path,collection:name=>({doc:id=>({path:path+'/'+name+'/'+id})})});
 const snap=path=>({exists:rows.has(path),data:()=>rows.get(path)});
 const db={doc:ref,runTransaction:async fn=>fn({getAll:async(...refs)=>refs.map(item=>snap(item.path)),
  get:async item=>snap(item.path)})};
 const request={auth:{uid},data:{code,roomId,baseDrawId:null,rosterRevision:0,operationId:'sale-room-draw'}};
 const draw=createDrawHandler({db,clock:()=>now,enabled:async()=>false});
 const start=createStartHandler({db,clock:()=>now,enabled:async()=>false});
 await assert.rejects(draw(request),/registration-queue-disabled/);
 await assert.rejects(start({...request,data:{code,roomId,drawId:'existing-draw',rosterRevision:0,operationId:'sale-room-start'}}),/registration-queue-disabled/);
 rows.delete('commerceTicketRoomGates/'+code);
 await assert.rejects(draw(request),error=>error.message==='permission-denied'&&error.ptnPermissionStage==='room-binding');
 await assert.rejects(start({...request,data:{code,roomId,drawId:'existing-draw',rosterRevision:0,operationId:'sale-room-start'}}),
  error=>error.message==='permission-denied'&&error.ptnPermissionStage==='room-binding');
});
