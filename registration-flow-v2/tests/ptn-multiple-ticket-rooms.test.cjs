'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createTicketRoomHandler,createPtnStatusHandler,createTicketRoomStateHandler,createTicketStationsHandler}=require('../backend/ticket-room-create.cjs');
const {ticketGateForCode,authorizeTicketManager}=require('../backend/ticket-host.cjs');

test('a second paid ticket creates an independent PTN room and retries cannot consume it twice',async()=>{
 const now=1800000000000,owner='owner',oldCode='PTN-E50A3E',code='PTN-NEW001';
 const ticketId='BXH-SO-'+'A'.repeat(24),oldId='legacy-room-id',rows=new Map();
 const db={doc(path){return {path,get:async()=>snap(path),collection(name){return {doc(id){return db.doc(path+'/'+name+'/'+id);}}}};},
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

test('published vouchers create independent PTN gates for two eligible organizers without an expiry',async()=>{
 const now=1800000000000,rows=new Map(),prices={'32':300,'160':2000};
 const snapshot=path=>({exists:rows.has(path),data:()=>rows.get(path)});
 const db={doc(path){return {path,get:async()=>snapshot(path),collection(name){return {doc(id){return db.doc(path+'/'+name+'/'+id);}}}};},
  async getAll(...refs){return refs.map(ref=>snapshot(ref.path));},
  async runTransaction(fn){return fn(tx);}};
 const tx={get:async ref=>snapshot(ref.path),getAll:async(...refs)=>refs.map(ref=>snapshot(ref.path)),
  create(ref,value){assert.equal(rows.has(ref.path),false);rows.set(ref.path,value);},
  update(ref,patch){rows.set(ref.path,{...rows.get(ref.path),...patch});},
  set(ref,patch){rows.set(ref.path,{...rows.get(ref.path),...patch});}};
 rows.set('systemSettings/commerceTicketPtnSaleV1',{enabled:true,productIds:{'32':'ptn-32','160':'ptn-160'}});
 for(const [index,capacity] of ['32','160'].entries()){
  const uid='host-'+index,id='BXH-SO-'+String(index).repeat(24);
  rows.set('users/'+uid,{active:true,role:'player',partnerOrganizer:{status:'active',scope:'manual',organizationId:'org-'+index,expiresAtMs:now+86400000}});
  rows.set('commerceTickets/'+id,{version:2,id,orderId:id,ownerUid:uid,status:'available',boundRoomCode:null,
   boundRoomId:null,addedCapacity:0,expiresAt:null,capacity:Number(capacity),contractCode:null});
  rows.set('commerceOrders/'+id,{id,ownerUid:uid,ticketPurchaseVersion:3,paymentStatus:'paid',deliveryStatus:'delivered',
   ticketOrganizationId:'org-'+index,contractCode:null,amountTwd:prices[capacity],
   productSnapshot:{id:'ptn-'+capacity,delivery:{kind:'ticket',assetId:capacity,quantity:1,durationDays:0}}});
  const code='PTN-NEW00'+index;
  const create=createTicketRoomHandler({db,clock:()=>now,newPartnerCode:()=>code});
  const request={auth:{uid},app:{},data:{action:'create-ticket-room',ticketId:id,
   operationId:'purchase-'+index,name:'合作積分賽',location:'台南',stations:capacity==='32'?4:1,
   registrationOpenAt:now-1000,registrationCloseAt:now+3600000,startAt:now+7200000}};
  const first=await create(request),replay=await create(request);
  assert.equal(first.code,code);assert.equal(replay.replayed,true);
  const gate=rows.get('commerceTicketRoomGates/'+code);
  assert.equal(gate.ownerUid,uid);
  assert.equal(gate.roomId,first.roomId);
  assert.equal(rows.get('tournaments/'+code).ptnSettlementVersion,1);
  assert.equal(rows.get('commerceTickets/'+id).status,'reserved');
  assert.equal((await createPtnStatusHandler({db,clock:()=>now})({auth:{uid},app:{},data:{action:'ticket-ptn-status'}})).code,code);
  if(capacity==='32'){
   const waiting=await createTicketRoomStateHandler({db,clock:()=>now})({auth:{uid},app:{},data:{action:'ticket-room-state',code}});
   assert.equal(waiting.phase,'waiting');assert.equal(waiting.stations,4);assert.equal(waiting.bracket,undefined);
   assert.equal(waiting.refereeSeatView,null);
   const roomPath='tournaments/'+code, original=rows.get(roomPath);
   rows.set(roomPath,{...original,refereeSeatsV1:{version:1,revision:3,courts:{1:{main:{name:'測試主裁',uid:'private-seat-uid'},backup1:{name:'  測試備裁  ',uid:'private-backup-uid'}},5:{main:{name:'超出台數'}}},requests:{pending:{tokenHash:'private-qr-token'}}}});
   const projected=await createTicketRoomStateHandler({db,clock:()=>now})({auth:{uid},app:{},data:{action:'ticket-room-state',code}});
   assert.deepEqual(projected.refereeSeatView.courts[1],{main:{name:'測試主裁'},backup1:{name:'測試備裁'},backup2:null});
   assert.equal(Object.keys(projected.refereeSeatView.courts).length,4);
   assert.doesNotMatch(JSON.stringify(projected.refereeSeatView),/private-seat-uid|private-backup-uid|private-qr-token|超出台數/);
   rows.set(roomPath,original);
   const resize=createTicketStationsHandler({db,clock:()=>now+1000});
   const resizeRequest={auth:{uid},app:{},data:{action:'ticket-room-stations',code,roomId:first.roomId,operationId:'resize-to-six',expectedUpdatedAt:waiting.updatedAt,stations:6}};
   await assert.rejects(resize({...resizeRequest,data:{...resizeRequest.data,stations:13}}),/invalid-operation/);
   assert.equal((await resize(resizeRequest)).ok,true);
   assert.equal((await resize(resizeRequest)).replayed,true);
   await assert.rejects(resize({...resizeRequest,data:{...resizeRequest.data,operationId:'resize-stale'}}),/version-conflict/);
   const current=await createTicketRoomStateHandler({db,clock:()=>now})({auth:{uid},app:{},data:{action:'ticket-room-state',code}});
   assert.equal(current.stations,6);
   assert.equal(JSON.parse(rows.get('publicTournaments/'+code).bracketView).meta.stations,6);
   assert.equal(rows.get('commerceTickets/'+id).status,'reserved');
   const existing=rows.get('tournaments/'+code),state=JSON.parse(existing.data);
   const {createEngine}=require('../../referee-seats/functions/engine/index.cjs');
   const {signature}=require('../../modules/main-app/bracket-commit.js');
   state.players=Array.from({length:7},(_,i)=>({id:'fixture-'+i,name:'選手'+i}));
   const engine=createEngine(state,{uid},now,'fixture-draw','fixture-seed');
   assert.equal(engine.generateSingleElim(),true);engine.rebuildCourtAssignments();
   state.bracketDraw={id:'draw-fixed',rosterRevision:0};
   rows.set('tournaments/'+code,{...existing,data:JSON.stringify(state)});
   const beforePublic=rows.get('publicTournaments/'+code);
   const mirror=JSON.parse(beforePublic.bracketView);
   Object.assign(mirror,{bracketSize:state.bracketSize,drawnAt:state.drawnAt,matches:state.matches,courtAssignments:state.courtAssignments});
   rows.set('publicTournaments/'+code,{...beforePublic,bracketView:JSON.stringify(mirror)});
   const beforeSignature=signature(state);
   const seatModel={version:1,revision:3,courts:{1:{revision:1,main:{uid:'keep',name:'保留'},backup1:null,backup2:null},6:{revision:2,main:{uid:'remove',name:'移除'},backup1:null,backup2:null}},requests:{old:{id:'old',kind:'qr',station:6,status:'pending',expiresAt:now+300000}}};
   rows.set('tournaments/'+code,{...rows.get('tournaments/'+code),refereeSeatsV1:seatModel});
   await resize({...resizeRequest,data:{...resizeRequest.data,operationId:'resize-draw-two',expectedUpdatedAt:current.updatedAt,stations:2}});
   const resizedRoom=rows.get('tournaments/'+code);
   assert.equal(resizedRoom.refereeSeatsV1.courts[6].main,null);assert.equal(resizedRoom.refereeSeatsV1.requests.old.status,'stale');
   assert.equal(resizedRoom.refereeSeatsV1.courts[1].main.uid,'keep');
   assert.deepEqual(Object.keys(JSON.parse(rows.get('publicTournaments/'+code).bracketView).meta.refereeSeatNames),['1','2']);
   assert.doesNotMatch(JSON.stringify(JSON.parse(rows.get('publicTournaments/'+code).bracketView).meta),/"uid"|"tokenHash"|"refereeSeatsV1"/);
   const after=JSON.parse(rows.get('tournaments/'+code).data),afterPublic=JSON.parse(rows.get('publicTournaments/'+code).bracketView);
   assert.equal(signature(after),beforeSignature);assert.equal(signature(afterPublic),beforeSignature);
   assert.equal(after.bracketDraw.id,'draw-fixed');assert.equal(after.meta.stations,2);
   assert.equal(Object.keys(after.courtAssignments).length,2);
   assert.ok(after.matches.filter(m=>!m.isBye).every(m=>m.station>=1&&m.station<=2));
   assert.equal(rows.get('commerceTickets/'+id).status,'reserved');
   await resize({...resizeRequest,data:{...resizeRequest.data,operationId:'resize-draw-six',expectedUpdatedAt:rows.get('tournaments/'+code).updatedAt,stations:6}});
   assert.equal(rows.get('tournaments/'+code).refereeSeatsV1.courts[6].main,null);
   assert.equal(rows.get('tournaments/'+code).refereeSeatsV1.requests.old.status,'stale');
   // Live retirement is the same shared plan, but requires a consumed ticket
   // and the existing PTN manager/room fence. No real room is changed.
   const liveRoom=rows.get(roomPath),pubPath='publicTournaments/'+code,livePublic=rows.get(pubPath);
   const live=JSON.parse(liveRoom.data),liveMirror=JSON.parse(livePublic.bracketView);
   Object.assign(live,{startedAt:now,rosterLocked:true});
   createEngine(live,{uid},now,'live-fixture').rebuildCourtAssignments();
   Object.assign(liveMirror,{startedAt:now,matches:JSON.parse(JSON.stringify(live.matches)),courtAssignments:live.courtAssignments});
   const held=live.matches.find(m=>m.station>1&&live.courtAssignments['court'+m.station]?.currentMatchId===m.id&&!m.completed);
   assert.ok(held,'fixture has a live assigned court above one');
   const heldStation=held.station;
   liveRoom.refereeSeatsV1.courts[heldStation]={revision:1,main:{uid:'live-referee',name:'不必離席'},backup1:{uid:'live-backup',name:'備裁'},backup2:null};
   liveRoom.refereeSeatsV1.requests.live={id:'live',kind:'invite',station:heldStation,status:'pending',expiresAt:now+300000};
   rows.set(roomPath,{...liveRoom,tournamentPhase:'live',data:JSON.stringify(live)});
   rows.set(pubPath,{...livePublic,tournamentPhase:'live',bracketView:JSON.stringify(liveMirror)});
   const liveResize=createTicketStationsHandler({db,enabled:async()=>true,clock:()=>now+2000});
   const command=(op,fields)=>({auth:{uid},app:{},data:{action:'ticket-room-stations',code,roomId:first.roomId,operationId:op,expectedUpdatedAt:rows.get(roomPath).updatedAt,...fields}});
   await assert.rejects(liveResize(command('live-reserved',{stations:1})),/ticket-binding-invalid/);
   rows.set('commerceTickets/'+id,{...rows.get('commerceTickets/'+id),status:'consumed'});
   await assert.rejects(resize(command('live-disabled',{stations:1})),/court-room-not-live/);
   rows.set('users/unrelated-player',{active:true,role:'player'});
   await assert.rejects(liveResize({...command('live-unauthorized',{stations:1}),auth:{uid:'unrelated-player'}}),/permission-denied/);
   const score=require('../backend/lifecycle.cjs').createTicketScoreHandler({db,enabled:async()=>true,clock:()=>now+2000});
   const scoreReq=(op,match,kind='score')=>({auth:{uid},app:{},data:{action:'ticket-room-score',code,roomId:first.roomId,operationId:op,matchId:match.id,matchUpdatedAt:match.updatedAt||0,command:kind,...(kind==='score'?{side:'A',finish:'knockout'}:{})}});
   rows.set('systemConfig/refereeSeatsV1',{enabled:true,perCourtScoringVerified:true,ticketSeatsEnabled:true});
   rows.set('users/live-referee',{active:true,role:'player'});rows.set('users/live-backup',{active:true,role:'player'});
   const scopedScore={...scoreReq('live-scoped-first',held),auth:{uid:'live-referee'}};
   Object.assign(scopedScore.data,{station:heldStation,expectedCourtRevision:1});
   await assert.rejects(score({...scopedScore,auth:{uid:'live-backup'}}),/permission-denied/);
   await assert.rejects(score({...scopedScore,data:{...scopedScore.data,expectedCourtRevision:0}}),/seat-stale/);
   assert.equal((await score(scopedScore)).scoreA,2);assert.equal((await score(scopedScore)).replayed,true);
   // Exercise the same standard individual controls as official/general rooms
   // without changing the baseline score/retirement fixture below.
   const standardCheckpoint=JSON.parse(JSON.stringify([...rows]));
   const currentMatch=()=>JSON.parse(rows.get(roomPath).data).matches.find(m=>m.id===held.id);
   const standardReq=(op,kind,extra={})=>({auth:{uid:'live-referee'},app:{},data:{...scoreReq(op,currentMatch(),kind).data,station:heldStation,expectedCourtRevision:1,...extra}});
   const fault=standardReq('live-fault-one','fault',{side:'A'});
   assert.equal((await score(fault)).scoreB,0);assert.equal((await score(fault)).replayed,true);
   assert.equal(currentMatch().faultActions.length,1);
   assert.equal((await score(standardReq('live-fault-two','fault',{side:'A'}))).scoreB,1);
   assert.equal(currentMatch().log.at(-1).type,'fault');
   await score(standardReq('live-fault-undo','undo'));assert.equal(currentMatch().scoreB,0);assert.equal(currentMatch().faultActions.length,1);
   await score(standardReq('live-pending-undo','undo'));assert.equal(currentMatch().faultActions.length,0);assert.equal(currentMatch().scoreA,2);
   await score(standardReq('live-pause','pause'));assert.equal(currentMatch().status,'paused');
   await assert.rejects(score(standardReq('live-pause-repeat','pause')),/invalid-status/);
   await score(standardReq('live-resume','resume'));assert.equal(currentMatch().status,'in_progress');
   await score(standardReq('live-rematch','rematch'));assert.equal(currentMatch().scoreA,0);assert.equal(currentMatch().log.length,0);assert.equal(currentMatch().faultActions.length,0);
   assert.equal(JSON.parse(rows.get(pubPath).bracketView).matches.find(m=>m.id===held.id).scoreA,0);
   assert.equal(rows.get('commerceTickets/'+id).status,'consumed');
   rows.clear();for(const [key,value] of standardCheckpoint)rows.set(key,value);
   const passCheckpoint=JSON.parse(JSON.stringify([...rows]));
   assert.equal(require('../backend/lifecycle.cjs').ticketCanSkip(JSON.parse(rows.get(roomPath).data),currentMatch()),true);
   await score(standardReq('live-pass-skip','skip'));
   assert.equal(currentMatch().scoreA,2);assert.equal(currentMatch().log.length,1);assert.ok(currentMatch().skippedAt);
   assert.ok(currentMatch().passReturn.waitFor.length>0);
   assert.equal(JSON.parse(rows.get(pubPath).bracketView).matches.find(m=>m.id===held.id).skippedAt,currentMatch().skippedAt);
   await assert.rejects(score(standardReq('live-pass-score','score',{side:'A',finish:'spin'})),/score-match-stale/);
   const deferredCheckpoint=JSON.parse(JSON.stringify([...rows]));
   const readPass=()=>createTicketRoomStateHandler({db,enabled:async()=>true,clock:()=>now})({auth:{uid},app:{},data:{action:'ticket-room-state',code}});
   assert.ok((await readPass()).courtControl.deferred.includes(held.id));
   // Natural dependency completion must return the same match and ledger via
   // the existing PTN confirm path, not a synthetic engine-only completion.
   for(const dep of currentMatch().passReturn.waitFor.slice()){
    const lookup=()=>JSON.parse(rows.get(roomPath).data).matches.find(m=>m.id===dep);
    await score(scoreReq('pass-dep-first-'+dep,lookup()));
    await score(scoreReq('pass-dep-second-'+dep,lookup()));
    await score(scoreReq('pass-dep-confirm-'+dep,lookup(),'confirm'));
   }
   assert.equal(currentMatch().skippedAt,null);assert.equal(currentMatch().passReturn.status,'playing');
   assert.equal(currentMatch().scoreA,2);assert.equal(currentMatch().log.length,1);
   assert.equal(JSON.parse(rows.get(pubPath).bracketView).matches.find(m=>m.id===held.id).skippedAt,null);
   rows.clear();for(const [key,value] of deferredCheckpoint)rows.set(key,value);
   const manual=command('live-pass-manual',{command:'claim-skipped',station:6,matchId:held.id});
   await liveResize(manual);assert.equal((await liveResize(manual)).replayed,true);
   assert.equal(currentMatch().station,6);assert.equal(currentMatch().skippedAt,null);assert.equal(currentMatch().scoreA,2);assert.equal(currentMatch().log.length,1);
   assert.equal(JSON.parse(rows.get(pubPath).bracketView).matches.find(m=>m.id===held.id).station,6);
   assert.equal(JSON.parse(rows.get(pubPath).bracketView).matches.find(m=>m.id===held.id).skippedAt,null);
   assert.ok(!((await readPass()).courtControl.deferred.includes(held.id)));
   rows.clear();for(const [key,value] of passCheckpoint)rows.set(key,value);


   const shrink=command('live-shrink',{stations:1});
   await liveResize(shrink);assert.equal((await liveResize(shrink)).replayed,true);
   const getState=()=>JSON.parse(rows.get(roomPath).data);
   const getMirror=()=>JSON.parse(rows.get(pubPath).bracketView);
   assert.equal(getState().courtRetirementPlan.targetCount,1);
   assert.ok(getState().meta.stations>=heldStation);
   assert.equal(getState().matches.find(m=>m.id===held.id).scoreA,2);
   assert.equal(rows.get(roomPath).refereeSeatsV1.courts[heldStation].main.uid,'live-referee');
   await assert.rejects(liveResize({...command('live-stale',{stations:2}),data:{...command('live-stale',{stations:2}).data,expectedUpdatedAt:shrink.data.expectedUpdatedAt}}),/version-conflict/);
   const readControl=()=>createTicketRoomStateHandler({db,enabled:async()=>true,clock:()=>now})({auth:{uid},app:{},data:{action:'ticket-room-state',code}});
   const control=await readControl();assert.equal(control.courtControl.targetCount,1);
   assert.equal(control.courtControl.courts.find(c=>c.station===heldStation).draining,true);
   assert.equal(control.courtControl.courts.find(c=>c.station===heldStation).currentMatchId,held.id);
   assert.doesNotMatch(JSON.stringify(control.courtControl),/live-referee|tokenHash/);
   // Alternate path: natural completion releases draining work with unchanged score rules.
   const checkpoint=JSON.parse(JSON.stringify([...rows]));
   await score(scoreReq('live-second-score',getState().matches.find(m=>m.id===held.id)));
   await score(scoreReq('live-confirm',getState().matches.find(m=>m.id===held.id),'confirm'));
   assert.equal(getState().matches.find(m=>m.id===held.id).completed,true);
   assert.equal(getMirror().matches.find(m=>m.id===held.id).scoreA,4);
   assert.ok(!getState().courtRetirementPlan.courts[heldStation].holdIds.includes(held.id));
   assert.equal(getState().meta.stations,getMirror().meta.stations);
   rows.clear();for(const [key,value] of checkpoint)rows.set(key,value);
   await assert.rejects(liveResize(command('live-wrong-match',{command:'exit',station:heldStation,matchId:'wrong'})),/current-match-changed/);
   for(const [key,court] of Object.entries(getState().courtAssignments)){
    const station=Number(key.slice(5));if(station>1&&court.currentMatchId)await liveResize(command('live-exit-'+station,{command:'exit',station,matchId:court.currentMatchId}));
   }
   assert.equal(getState().meta.stations,1);assert.equal(getMirror().meta.stations,1);
   const detached=getState().matches.find(m=>m.id===held.id);
   assert.equal(detached.station,0);assert.equal(detached.scoreA,2);assert.equal(detached.log.length,1);
   assert.equal(rows.get(roomPath).refereeSeatsV1.courts[heldStation].main,null);
   assert.equal(rows.get(roomPath).refereeSeatsV1.requests.live.status,'stale');
   assert.equal(getMirror().matches.find(m=>m.id===held.id).station,0);
   await assert.rejects(score(scoreReq('live-detached-score',detached)),/score-match-stale/);
   const read=await createTicketRoomStateHandler({db,clock:()=>now})({auth:{uid},app:{},data:{action:'ticket-room-state',code}});
   assert.equal(read.bracket.find(m=>m.id===held.id).canScore,false);
   assert.ok((await readControl()).courtControl.detached.includes(held.id));
   await liveResize(command('live-claim',{command:'claim',station:1,matchId:held.id}));
   const claimed=getState().matches.find(m=>m.id===held.id);
   assert.equal(claimed.station,1);assert.equal(claimed.scoreA,2);assert.equal(claimed.log.length,1);assert.equal(claimed.forceDetached,undefined);
   await liveResize(command('live-expand',{stations:6}));
   assert.equal(getState().meta.stations,6);assert.equal(getMirror().meta.stations,6);
   assert.equal(rows.get(roomPath).refereeSeatsV1.courts[heldStation].main,null);
   assert.equal(rows.get(roomPath).refereeSeatsV1.requests.live.status,'stale');
   assert.equal(rows.get('commerceTickets/'+id).status,'consumed');
   await liveResize(command('live-reopen',{command:'reopen',station:heldStation}));
   assert.equal(getState().forcedCourtExits[heldStation].closed,false);
   assert.doesNotMatch(JSON.stringify(getMirror().meta),/live-referee|refereeSeatsV1/);
   state.players=[{id:'a',name:'甲',source:'online',registrationId:'private-a'},
    {id:'b',name:'乙',source:'online',registrationId:'private-b'}];
   state.startedAt=now;state.championId='a';state.runnerUpId='b';state.archiveStatus='completed';
   state.matches=[{id:'final',seq:0,round:0,bracket:'SE',completed:true,scoreA:4,scoreB:2,
    a:{playerId:'a'},b:{playerId:'b'},winnerId:'a',loserId:'b'}];
   rows.set('tournaments/'+code,{...existing,tournamentPhase:'done',confirmedCount:2,data:JSON.stringify(state)});
   rows.set('commerceTickets/'+id,{...rows.get('commerceTickets/'+id),status:'consumed'});
   const result=await createTicketRoomStateHandler({db,clock:()=>now})(
    {auth:{uid},app:{},data:{action:'ticket-room-state',code}});
   assert.equal(result.phase,'done');
   assert.equal(result.stations,6);
   assert.deepEqual(result.participants,[{name:'甲'},{name:'乙'}]);
   assert.equal(result.bracket.length,1);
   assert.equal(result.bracket[0].completed,true);
   assert.equal(result.bracket[0].canScore,false);
   assert.deepEqual(result.matches,[]);
  }
 }
});
