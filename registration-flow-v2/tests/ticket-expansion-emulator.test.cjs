'use strict';
const assert=require('node:assert/strict');
const {test,after}=require('node:test');
const {randomBytes}=require('node:crypto');
const {db,service,handlers,audit,drainAll}=require('./harness.cjs');
const {createApi}=require('../backend/api.cjs');
const {createTicketRoomHandler,createTicketRoomStateHandler,createTicketStationsHandler}=require('../backend/ticket-room-create.cjs');
const {createStartHandler,createDrawHandler,createTicketScoreHandler,forfeitMatchAvailable,ticketRoundBlocked,ticketBronzeBlocked}=require('../backend/lifecycle.cjs');
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
  await inventory.set({ownerUid:uid,kind:'room_expansion',assetId:'tournament_expansion_1',status:'active',expiresAt:null,quantity:83});
  await sale.set({enabled:true,productIds:{'32':'expansion-fixture-32','64':'expansion-fixture-64','160':'expansion-fixture-160'}});
  const rooms=[];
  for(const base of [32,64,160]){
   const code='PTN-'+randomBytes(3).toString('hex').toUpperCase();
   const ticketId='BXH-SO-'+randomBytes(12).toString('hex').toUpperCase();
   const ticket=db.doc('commerceTickets/'+ticketId);
   await ticket.set({id:ticketId,orderId:ticketId,version:2,ownerUid:uid,status:'available',capacity:base,addedCapacity:0,boundRoomCode:null,boundRoomId:null,expiresAt:null,contractCode:null});
   await db.doc('commerceOrders/'+ticketId).set({id:ticketId,ownerUid:uid,ticketPurchaseVersion:3,paymentStatus:'paid',deliveryStatus:'delivered',
    ticketOrganizationId:uid,contractCode:null,amountTwd:({32:300,64:600,160:2000})[base],
    productSnapshot:{id:'expansion-fixture-'+base,delivery:{kind:'ticket',assetId:String(base),quantity:1,durationDays:0}}});
   const create=createTicketRoomHandler({db,clock:()=>now,newPartnerCode:()=>code});
   const {roomId}=await create({auth:{uid},app:{},data:{action:'create-ticket-room',ticketId,operationId:'create-'+base,name:'Expansion fixture',
    location:'test',stations:base===160?6:1,registrationOpenAt:now-1000,registrationCloseAt:now+1800000,startAt:now+3600000}});
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
  assert.equal((await inventory.get()).data().quantity,75);
  assert.equal((await read(a)).capacity,40);
  await assert.rejects(expand(request(a,9,'expansion-first')),/operation-conflict/);
  const second=await expand(request(b,12,'expansion-second'));
  assert.equal(second.capacityAfter,76);assert.equal(second.balanceAfter,63);
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
  // The existing station count operation must preserve paid expansion capacity.
  const priorResize=(await a.room.get()).data();
  const resize=createTicketStationsHandler({db,clock:()=>now+1500});
  const resizeRequest={auth:{uid},app:{},data:{action:'ticket-room-stations',code:a.code,roomId:a.roomId,operationId:'expansion-resize',expectedUpdatedAt:priorResize.updatedAt,stations:2}};
  assert.equal((await resize(resizeRequest)).ok,true);
  assert.equal((await resize(resizeRequest)).replayed,true);
  const [resized,resizedPublic,resizedTicket,resizedInventory]=await db.getAll(a.room,a.pub,a.ticket,inventory);
  assert.equal(resized.data().capacity,40);
  assert.equal(resizedPublic.data().capacity,40);
  assert.equal(JSON.parse(resized.data().data).meta.registrationCapacity,40);
  assert.equal(JSON.parse(resizedPublic.data().bracketView).meta.registrationCapacity,40);
  assert.equal(JSON.parse(resized.data().data).meta.stations,2);
  assert.equal(JSON.parse(resizedPublic.data().bracketView).meta.stations,2);
  assert.equal(resizedTicket.data().addedCapacity,8);
  assert.equal(resizedInventory.data().quantity,63);
  await assert.rejects(expand(request(a,64,'expansion-insufficient')),/insufficient-expansion-tickets/);
  await config.set({enabled:true,maxCapacity:45});
  await assert.rejects(expand(request(a,6,'expansion-overflow')),/invalid-expansion-capacity/);
  await config.set({enabled:true,maxCapacity:160});
  // A conflicting mirror must not deduct or partly update inventory.
  await a.pub.update({capacity:41});
  await assert.rejects(expand(request(a,1,'expansion-stale')),/ticket-capacity-invalid/);
  await a.pub.update({capacity:40});
  await a.room.update({tournamentPhase:'live'});
  await assert.rejects(expand(request(a,1,'expansion-live')),/expansion-room-unavailable/);
  assert.equal((await inventory.get()).data().quantity,63);
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
  assert.equal((await inventory.get()).data().quantity,63);
  // First-stage acceptance target: 160 + 32 = 192, not a claim of live load.
  const c=rooms[2];
  // A configuration above the first-stage ceiling must fail closed, even for a small request.
  for(const maxCapacity of [193,320]){
   await config.set({enabled:true,maxCapacity});
   assert.equal((await read(c)).expansionEnabled,false);
   await assert.rejects(expand(request(c,1,'expansion-config-'+maxCapacity)),/expansion-unavailable/);
   assert.equal((await c.room.get()).data().capacity,160);
   assert.equal((await c.ticket.get()).data().addedCapacity,0);
   assert.equal((await inventory.get()).data().quantity,63);
  }
  await config.set({enabled:true,maxCapacity:192});
  assert.equal((await read(c)).expansionMaxCapacity,192);
  const patch=request(c,32,'expansion-192');
  const applied=await expand(patch);
  assert.equal(applied.capacityAfter,192);
  assert.equal(applied.balanceAfter,31);
  assert.equal((await expand(patch)).replayed,true);
  await assert.rejects(expand(request(c,1,'expansion-193')),/invalid-expansion-capacity/);
  const [cPrivate,cPublic,cTicket,cInventory]=await db.getAll(c.room,c.pub,c.ticket,inventory);
  assert.equal(cPrivate.data().capacity,192);
  assert.equal(cPublic.data().capacity,192);
  assert.equal(JSON.parse(cPrivate.data().data).meta.registrationCapacity,192);
  assert.equal(JSON.parse(cPublic.data().bracketView).meta.registrationCapacity,192);
  assert.equal(cTicket.data().capacity,160);
  assert.equal(cTicket.data().addedCapacity,32);
  assert.equal(cInventory.data().quantity,31);
  // Exercise 193 simultaneous intake calls with a 192-place patched PTN.
  // Intake acceptance is distinct from final registration confirmation.
  const entrants=Array.from({length:193},(_,i)=>uid+'-large-'+i);
  const users=db.batch();
  for(const player of entrants)users.set(db.doc('users/'+player),{active:true,role:'player',realName:'Fixture '+player,phone:'0000000000',profileCompleted:true});
  await users.commit();
  const worker=service({requireRoomOwnership:true});
  const largeApi=createApi({queue:worker,family:handlers.family(db),enabled:async code=>code===c.code});
  const started=Date.now();
  const intake=await Promise.all(entrants.map((player,i)=>{
   const operationId='large-join-'+i;
   return largeApi({auth:{uid:player},data:{action:'submit',code:c.code,operation:{route:'family',code:c.code,operationId,payload:{action:'join',code:c.code,operationId,childIds:[null],childEligibilityConfirmed:true}}}});
  }));
  const intakeMs=Date.now()-started;
  assert.equal(intake.filter(x=>x.operation.state==='queued').length,193);
  const drainStarted=Date.now();
  await drainAll([worker],c.code);
  const drainMs=Date.now()-drainStarted;
  const {summary,rows,jobs}=await audit(c.code,192);
  assert.equal(summary.confirmed,192);
  assert.equal(summary.waitlist,0);
  assert.equal(summary.completed,192);
  assert.equal(summary.rejected,1);
  assert.equal(jobs.filter(j=>j.state==='rejected'&&j.reason==='full').length,1);
  assert.equal(new Set(rows.filter(r=>r.status==='confirmed').map(r=>r.id)).size,192);
  const largePrivate=JSON.parse((await c.room.get()).data().data);
  assert.equal(largePrivate.players.length,192);
  assert.equal(new Set(largePrivate.players.map(p=>p.id)).size,192);
  assert.equal(largePrivate.meta.checkinRequired,false); // No check-in coverage in this case.
  const largeOptions={db,clock:()=>now+3000,enabled:async code=>code===c.code};
  const largeLifecycle={code:c.code,roomId:c.roomId,rosterRevision:largePrivate.registrationRosterRevision};
  const drawStarted=Date.now();
  const largeDraw=await createDrawHandler(largeOptions)({auth:{uid},data:{...largeLifecycle,baseDrawId:null,operationId:'large-draw-192'}});
  const drawMs=Date.now()-drawStarted;
  const drawnState=JSON.parse((await c.room.get()).data().data);
  assert.equal(drawnState.bracketSize,256);
  assert.equal(new Set(drawnState.matches.flatMap(m=>[m.a?.playerId,m.b?.playerId,m.winnerId]).filter(Boolean)).size,192);
  const startStarted=Date.now();
  await createStartHandler(largeOptions)({auth:{uid},data:{...largeLifecycle,drawId:largeDraw.drawId,confirmEarlyStart:true,operationId:'large-start-192'}});
  const startMs=Date.now()-startStarted;
  const [live,livePub,used,remaining]=await db.getAll(c.room,c.pub,c.ticket,inventory);
  assert.equal(live.data().tournamentPhase,'live');
  assert.equal(livePub.data().tournamentPhase,'live');
  assert.equal(live.data().capacity,192);
  assert.equal(livePub.data().capacity,192);
  assert.equal(used.data().status,'consumed');
  assert.equal(used.data().capacity,160);
  assert.equal(used.data().addedCapacity,32);
  assert.equal(remaining.data().quantity,31);
  // Exercise two supported PTN manager identities, not independent referee seats.
  // The existing room authority permits exactly one delegated player.
  await c.room.update({ptnDelegateUid:delegate});
  const liveState=JSON.parse(live.data().data);
  const assigned=new Map();
  for(const m of liveState.matches){
   if(m.station!=null&&forfeitMatchAvailable(m)&&!ticketRoundBlocked(m,liveState.matches,liveState.meta)&&!ticketBronzeBlocked(m,liveState.matches,liveState.meta)){
    if(!assigned.has(m.station))assigned.set(m.station,m);
   }
  }
  assert.equal(assigned.size,6,'six distinct eligible court assignments');
  const targets=[...assigned.values()];
  const score=createTicketScoreHandler(largeOptions);
  const readMatches=async()=>new Map(JSON.parse((await c.room.get()).data().data).matches.map(m=>[m.id,m]));
  const wave=async(label,command,extra={})=>{
   const current=await readMatches();
   const requests=targets.map((m,i)=>({auth:{uid:i%2===0?uid:delegate},app:{},data:{action:'ticket-room-score',code:c.code,roomId:c.roomId,matchId:m.id,
    matchUpdatedAt:current.get(m.id).updatedAt||0,operationId:'large-score-'+label+'-'+i,command,...extra}}));
   const t=Date.now();
   const results=await Promise.all(requests.map(r=>score(r)));
   return {requests,results,ms:Date.now()-t};
  };
  const firstWave=await wave('first','score',{side:'A',finish:'knockout'});
  assert.ok(firstWave.results.every(r=>r.scoreA===2&&r.completed===false));
  assert.equal((await score(firstWave.requests[0])).replayed,true);
  const deniedRequest={...firstWave.requests[0],auth:{uid:entrants[0]}};
  await assert.rejects(score(deniedRequest),/permission-denied/);
  const secondWave=await wave('second','score',{side:'A',finish:'burst'});
  assert.ok(secondWave.results.every(r=>r.scoreA===4&&r.completed===false));
  const decisions=await wave('confirm','confirm');
  assert.ok(decisions.results.every(r=>r.completed&&r.scoreA===4));
  const [scoredRoom,scoredPublic]=await db.getAll(c.room,c.pub);
  const scored=JSON.parse(scoredRoom.data().data),scoredMirror=JSON.parse(scoredPublic.data().bracketView);
  for(const m of targets){
   const priv=scored.matches.find(x=>x.id===m.id),pubMatch=scoredMirror.matches.find(x=>x.id===m.id);
   assert.equal(priv.winnerId,m.a.playerId);
   assert.equal(pubMatch.winnerId,priv.winnerId);
   assert.equal(pubMatch.scoreA,4);
   assert.equal(pubMatch.completed,true);
   assert.equal(priv.log.length,2);
  }
  assert.equal(scoredRoom.data().capacity,192);
  assert.equal(scoredPublic.data().capacity,192);
  assert.equal((await inventory.get()).data().quantity,31);
  console.info('PTN192 six-court emulator metrics',JSON.stringify({courts:6,authorizedManagerAccounts:2,scoreCommands:12,confirmCommands:6,firstWaveMs:firstWave.ms,secondWaveMs:secondWave.ms,confirmWaveMs:decisions.ms,privateStateBytes:Buffer.byteLength(scoredRoom.data().data),publicStateBytes:Buffer.byteLength(scoredPublic.data().bracketView)}));
  // Complete the remaining bracket via the existing score handler, not fabricated results.
  const fullStarted=Date.now();
  let completedByCommands=targets.length, waves=0;
  for(;waves<256;waves++){
   const state=JSON.parse((await c.room.get()).data().data);
   if(state.championId)break;
   const eligible=state.matches.filter(m=>forfeitMatchAvailable(m)&&
    !ticketRoundBlocked(m,state.matches,state.meta)&&!ticketBronzeBlocked(m,state.matches,state.meta));
   assert.ok(eligible.length,'bracket must make progress before champion');
   const selected=eligible.slice(0,6);
   for(const [step,command,extra] of [['first','score',{side:'A',finish:'knockout'}],['second','score',{side:'A',finish:'burst'}],['confirm','confirm',{}]]){
    const current=await readMatches();
    const results=await Promise.all(selected.map((m,i)=>score({auth:{uid},app:{},data:{
     action:'ticket-room-score',code:c.code,roomId:c.roomId,matchId:m.id,
     matchUpdatedAt:current.get(m.id).updatedAt||0,operationId:'full-'+waves+'-'+step+'-'+i,command,...extra}})));
    assert.ok(results.every(r=>r.scoreA===(step==='first'?2:4)&&r.completed===(command==='confirm')));
   }
   completedByCommands+=selected.length;
  }
  const [finalRoom,finalPublic]=await db.getAll(c.room,c.pub);
  const finalState=JSON.parse(finalRoom.data().data),finalMirror=JSON.parse(finalPublic.data().bracketView);
  assert.ok(finalState.championId,'full bracket must reach champion');
  assert.equal(finalMirror.championId,finalState.championId);
  assert.equal(finalMirror.runnerUpId,finalState.runnerUpId);
  const played=finalState.matches.filter(m=>m.bracket==='SE'&&!m.isBye&&m.a?.playerId&&m.b?.playerId);
  assert.equal(played.length,191);
  assert.ok(played.every(m=>m.completed&&m.winnerId&&m.loserId));
  assert.equal(new Set(played.map(m=>m.loserId)).size,191);
  assert.ok(!played.some(m=>m.loserId===finalState.championId));
  const finalMirrorMatches=new Map(finalMirror.matches.map(m=>[m.id,m]));
  for(const m of played){
   const mirror=finalMirrorMatches.get(m.id);
   assert.equal(mirror.winnerId,m.winnerId);
   assert.equal(mirror.loserId,m.loserId);
   assert.equal(mirror.completed,true);
  }
  assert.equal(completedByCommands,191+(finalState.meta.bronzeMatch?1:0));
  assert.equal(finalRoom.data().capacity,192);
  assert.equal(finalPublic.data().capacity,192);
  assert.equal((await inventory.get()).data().quantity,31);
  // Export the actual isolated lifecycle result for the separate scoring candidate.
  // Only this demo fixture is exported; no production document is read or logged.
  assert.equal(process.env.GCLOUD_PROJECT,'demo-bxh-registration-v2');
  assert.match(process.env.FIRESTORE_EMULATOR_HOST||'',/^(127\.0\.0\.1|localhost):\d+$/);
  const {data:stateJson,...top}=finalRoom.data();
  const pub=finalPublic.data();
  const ticketId=top.ticketAccessV1.ticketId;
  const [proofGate,proofTicket,proofOrder]=await db.getAll(
   db.doc('commerceTicketRoomGates/'+c.code),c.ticket,db.doc('commerceOrders/'+ticketId));
  assert.ok(proofGate.exists&&proofTicket.exists&&proofOrder.exists);
  const proof={version:1,code:c.code,top,state:JSON.parse(stateJson),pub,
   gate:proofGate.data(),ticket:proofTicket.data(),order:proofOrder.data(),
   checkedInCount:finalState.players.filter(p=>p.checkedIn===true).length,
   checkinRequired:finalState.meta.checkinRequired};
  const encoded=JSON.stringify(proof);
  const compressed=require('node:zlib').gzipSync(encoded).toString('base64');
  // Keep each log record short and independently verifiable. A prior
  // transport silently lost bytes in a 1500-character record.
  const chunkSize=480;
  const chunks=compressed.match(/.{1,480}/g);
  assert.equal(chunks.join(''),compressed);
  console.info('PTN192-SETTLEMENT-PROOF manifest',JSON.stringify({
   schema:2,encoding:'gzip+base64',chunks:chunks.length,chunkSize,encodedLength:compressed.length,
   compressedSha256:createHash('sha256').update(compressed).digest('hex'),
   sha256:createHash('sha256').update(encoded).digest('hex'),
   players:finalState.players.length,checkedInCount:proof.checkedInCount,checkinRequired:proof.checkinRequired}));
  for(const [index,chunk] of chunks.entries())console.info('PTN192-SETTLEMENT-PROOF chunk '+index+' '+chunk+' '+createHash('sha256').update(chunk).digest('hex'));
  console.info('PTN192 full bracket emulator metrics',JSON.stringify({completedByCommands,waves,scoreAndConfirmCommands:completedByCommands*3,remainingBracketMs:Date.now()-fullStarted,privateStateBytes:Buffer.byteLength(finalRoom.data().data),publicStateBytes:Buffer.byteLength(finalPublic.data().bracketView)}));
  console.info('PTN192 emulator metrics',JSON.stringify({intakeCount:193,confirmed:192,full:1,intakeMs,drainMs,drawMs,startMs,privateStateBytes:Buffer.byteLength(live.data().data),publicStateBytes:Buffer.byteLength(livePub.data().bracketView)}));
 }finally{
  if(previousSale.exists)await sale.set(previousSale.data());else await sale.delete();
  if(previousConfig.exists)await config.set(previousConfig.data());else await config.delete();
 }
});
