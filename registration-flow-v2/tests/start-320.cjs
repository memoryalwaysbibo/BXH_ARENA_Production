'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {randomUUID}=require('node:crypto');
const {db,FieldValue,handlers,service,seed}=require('./harness.cjs');
const bracket=require('../../modules/main-app/bracket-commit.js');
const {createQueuedPromotion}=require('../backend/management.cjs');
const {createPromotionHandler}=require('../../registration-promotion/functions/service.cjs');
const {createCheckinHandler}=require('../../qr-checkin/backend/firebase-callable.cjs');
const {createStartHandler}=require('../backend/start.cjs');

const root=path.resolve(__dirname,'../..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const core=read('modules/main-app/core.js'), cloud=read('modules/cloud/cloud-runtime.js');
const clone=value=>JSON.parse(JSON.stringify(value));
function block(source,start,end){
 const from=source.indexOf(start),to=source.indexOf(end,from+start.length);
 assert(from>=0&&to>from,start);
 return source.slice(from,to);
}
const round=Math.round;
const elapsed=since=>round(performance.now()-since);

async function run(){
 const {code,ids}=await seed(321,320,8);
 const entrants=ids.slice(0,320), admin=ids[320], promoted=entrants.at(-1);
 const tr=db.doc('tournaments/'+code), pr=db.doc('publicTournaments/'+code);
 const reg=id=>tr.collection('registrations').doc(id);
 const now=Date.now(), players=entrants.slice(0,319).map((id,index)=>({
  id:'reg_'+id,name:'Fixture '+index,source:'online',registrationUid:id,registrationId:id,checkedIn:index<318
 }));
 const runtime={id:'start-320',cloudCode:code,updatedAt:now,meta:{
  name:'Start fixture',formatType:'single',battleMode:'individual',stations:12,registrationEnabled:true,
  registrationCapacity:320,registrationAutoFillEnabled:false,checkinRequired:true
 },players,waitlistPlayers:[],matches:[],archiveStatus:'ongoing',registrationRosterRevision:0};
 const publicMirror=vm.runInNewContext(block(cloud,'  function buildPublicMirrorFields(state){','\n  function currentUserUidForWrites()')+'\nbuildPublicMirrorFields',{buildPublicEventInfo:()=>({})});
 const common={eventAuthority:'official',confirmedCount:319,waitlistCount:1};
 const batch=db.batch();
 batch.update(tr,{...common,data:JSON.stringify(runtime),ownerUid:admin,registrationQueueVersion:2});
 batch.update(pr,{...common,bracketView:JSON.stringify(publicMirror(runtime))});
 batch.update(db.doc('users/'+admin),{role:'admin'});
 batch.set(db.doc('systemConfig/qrCheckin'),{enabled:true,writerGuardsVerified:true,roomCodes:[code]});
 entrants.forEach((id,index)=>batch.set(reg(id),{uid:id,displayName:'Fixture '+index,status:index<319?'confirmed':'waitlist',createdAt:now}));
 await batch.commit();

 const checkIn=createCheckinHandler(db,()=> 'start-320-emulator-only-secret');
 const qr=(uid,data)=>checkIn({auth:{uid},data:{code,...data}});
 assert.equal((await qr(admin,{action:'configure',enabled:true})).enabled,true);

 let clock=now, failOnce=true;
 const worker=service({
  requireRoomOwnership:true,
  clock:()=>clock,
  beforeExecute:async job=>{if(job.payload.action==='configure'&&failOnce){failOnce=false;throw Error('fixture-transient-error');}},
  handlers:{...handlers,promotion:createQueuedPromotion({
   roster:handlers.roster,promote:store=>createPromotionHandler(store,{timestamp:()=>FieldValue.serverTimestamp(),allowUnseatedOfficial:true})
  })}
 });
 const configure={code,route:'roster',operationId:'start320-retry-config',payload:{code,action:'configure',intent:'admin',enabled:true,operationId:'start320-retry-config'}};
 const promotion={code,route:'promotion',operationId:'start320-late-promotion',payload:{code,action:'promote',intent:'admin',registrationId:promoted,expandBy:0,operationId:'start320-late-promotion'}};

 const timings=[],notices=[],storage=new Map();
 let startWrites=0, drawn=0, next=0, modal, controller, eventResolve, startRequest;
 const start=createStartHandler({db,enabled:async requested=>requested===code});
 const startData=snapshot=>({code,roomId:snapshot.id,drawId:snapshot.bracketDraw.id,
  rosterRevision:snapshot.registrationRosterRevision,operationId:'start-320-operation'});
 const observed=()=>new Promise(resolve=>{eventResolve=resolve;});
 const emit=value=>eventResolve?.(value);
 const measure=async(label,fn)=>{
  const at=performance.now();
  try{return await fn();}finally{timings.push({label,ms:elapsed(at)});}
 };
 const rosterReadCount=()=>timings.filter(x=>x.label==='roster-readback').length;
 const readBracket=()=>measure('bracket-read',async()=>{
  const [a,b]=await db.getAll(tr,pr);
  return {ok:true,data:JSON.parse(a.data().data),publicData:JSON.parse(b.data().bracketView)};
 });
 async function write(snapshot,options,label){
  return measure(label,()=>db.runTransaction(async tx=>{
   const current=JSON.parse((await tx.get(tr)).data().data);
   if(options){
    if(bracket.assertWrite(current,snapshot,options)==='already-committed')return true;
   }
   if(Number(current.registrationRosterRevision||0)!==Number(snapshot.registrationRosterRevision||0))throw Error('registration-roster-stale');
   const publicData=publicMirror(snapshot), phase=snapshot.startedAt?'live':'waiting';
   tx.update(tr,{data:JSON.stringify(snapshot),tournamentPhase:phase});
   tx.update(pr,{bracketView:JSON.stringify(publicData),tournamentPhase:phase});
   return {ok:true,committed:true,data:snapshot,publicData};
  }));
 }
 const c=vm.createContext({
  state:clone(runtime),window:{BXHBracketCommit:bracket,cloudSync:{
   getPublicTournamentFull:()=>measure('roster-room-read',async()=> (await pr.get()).data()),
   listRegistrationsForAdmin:()=>measure('roster-registrations-read',async()=> (await tr.collection('registrations').get()).docs.map(d=>({...d.data(),registrationId:d.id}))),
   joinRoom:()=>measure('roster-readback',async()=>({ok:true,data:JSON.parse((await tr.get()).data().data)}))
  }},
  activeTab:'people',console,adminRegistrationsCache:null,publicTournamentsCache:null,myRegistrationsCache:null,peopleRosterBusy:false,
  BATTLE_MODE_LABELS:{individual:'個人戰'},FORMAT_LABELS:{single:'單淘汰'},PLAY_MODE_LABELS:{},Date,
  cloneStateForSave:clone,captureRegistrationRosterContext:()=>({code,roomId:runtime.id}),requireRegistrationRosterContext(){},
  registrationRosterContextIsCurrent:()=>true,peopleOnsiteWaitlistManaged:()=>false,isCommunityQuickRegistration:()=>false,
  computeRegistrationStatus:()=> 'open',touchCommunityActivity(){},cloudAvailable:()=>true,uid:prefix=>prefix+'_'+(++next),
  enqueueCloudStateWrite:(room,snapshot)=>write(snapshot,null,'roster-write').then(r=>r.ok),
  applyRemoteState:snapshot=>{c.state=snapshot;},
  scheduledTournamentStartMs:()=>null,offerAdminOperationalOverride:()=>false,mapRegistrationError:e=>e.message,
  noteAdminOperationalFailure(){},resetAdminRegistrationsCache(){},render(){},saveRecord:async()=>true,
  openModal(value){modal=value;emit({kind:'modal',title:value.title});},
  showToast(message,error){notices.push({message,error:!!error});emit({kind:'toast',message,error:!!error});},
  bracketCommitController:()=>controller,
  rebuildCourtAssignments(){},rebuildPropagationSingle(){},syncMatchStatuses(){},
  saveState:async()=>{
   startWrites++;
   const snapshot=clone(c.state);
   try{
    startRequest={auth:{uid:admin},data:startData(snapshot)};
    const results=await measure('start-write-and-concurrent-retry',()=>Promise.all([start(startRequest),start(startRequest)]));
    assert.equal(results.filter(result=>result.replayed===true).length,1);
    assert.equal(results[0].startedAt,results[1].startedAt);
    c.state=(await readBracket()).data;
    return results.every(result=>result.ok);
   }
   catch(e){c.window.__BXH_LAST_CLOUD_ERROR_CODE=e.message;return false;}
  }
 });
 const family=read('family-ui.js'), utilities=read('modules/main-app/match-utils.js');
 vm.runInContext([
  block(utilities,'function nextPow2(','\nfunction sameStringSet('),
  utilities.split('\n').find(line=>line.startsWith('function sameStringSet(')),
  block(family,'function mergeFamilyOnlineRoster(','async function chooseFamilyRegistrationToCancel('),
  block(core,'function currentBracketParticipantIds(','/* ==== render helpers ==== */'),
  block(core,'function singleElimScheduleTier(','function singleElimBronzeGatePhase('),
  block(core,'function eligiblePlayers(','function rebuildPropagationSingle('),
  'const shuffle=items=>items.slice(), orderedMatches=()=>state.matches.slice().sort((a,b)=>a.seq-b.seq);',
  block(core,'async function verifyBracketBeforeStart(','function currentRoundLabelForBoard('),
  'function clickStart(){const action="start-tournament";'+block(core,'  if(action==="start-tournament"){','  if(action==="reset-bracket"){')+'}'
 ].join('\n'),c);
 controller=bracket.create({key:code,actorUid:admin,storage:{
  getItem:key=>storage.get(key),setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)
 },current:()=>true,state:()=>c.state,cloud:()=>true,operationId:randomUUID,generate:()=>{
  const prior=c.state;c.state=clone(prior);
  try{return c.generateSingleElim()?clone(c.state):null;}finally{c.state=prior;}
 },read:readBracket,waitForWrites:async()=>true,write:(snapshot,options)=>write(snapshot,options,'draw-write'),
 apply:snapshot=>{c.state=clone(snapshot);},changed(){},success(){drawn++;}});
 // The production promotion handler owns the last waitlist seat before drawing.
 await worker.enqueue(admin,promotion);
 await measure('promotion-before-draw',()=>worker.drain(code));
 const promotedResult=(await worker.status(admin,code,promotion.operationId)).operation;
 assert.equal(promotedResult.state,'completed',JSON.stringify(promotedResult));
 c.state=(await readBracket()).data;
 await measure('initial-draw',()=>controller.begin());
 assert.equal(c.currentBracketParticipantIds().size,318);

 const tooLate={...promotion,operationId:'start320-locked-promotion',payload:{...promotion.payload,operationId:'start320-locked-promotion'}};
 await worker.enqueue(admin,configure);
 await worker.enqueue(admin,tooLate);
 await measure('queue-first-attempt',()=>worker.drain(code));
 const [blocked,behind]=await Promise.all([worker.status(admin,code,configure.operationId),worker.status(admin,code,tooLate.operationId)]);
 assert.equal(blocked.operation.state,'queued');
 assert.equal(behind.operation.state,'queued');
 assert.equal((await worker.drain(code)).processed,0);
 const staleStart={auth:{uid:admin},data:startData(c.state)};
 await assert.rejects(start(staleStart),/registration-queue-pending/);

 let event=observed();
 await measure('first-start-click-to-confirmation',async()=>{c.clickStart();assert.equal((await event).title,'確認開始賽事');});
 const firstConfirm=modal.onConfirm;
 clock+=1001;
 await measure('queue-retry-after-draw',()=>worker.drain(code));
 const refused=(await worker.status(admin,code,tooLate.operationId)).operation;
 assert.equal(refused.reason,'bracket-locked');
 const {token}=await qr(admin,{action:'status'});
 assert.ok(token);
 const late=entrants.slice(-2);
 const receipts=await measure('late-qr-check-in',()=>Promise.all(late.map(uid=>qr(uid,{action:'scan',token}))));
 assert.ok(receipts.every(receipt=>receipt.checkedIn===true&&!receipt.already));
 assert.equal((await qr(late[0],{action:'scan',token})).already,true);
 const audits=(await tr.collection('checkinAudit').where('action','==','scan').get()).docs.map(doc=>doc.data());
 assert.deepEqual(audits.map(audit=>audit.registrationId).sort(),late.slice().sort());
 const [afterQr,publicAfterQr]=await db.getAll(tr,pr);
 assert.equal(afterQr.data().registrationQueueVersion,2);
 assert.equal(afterQr.data().qrCheckinRevision,publicAfterQr.data().qrCheckinRevision);
 assert.equal(JSON.parse(publicAfterQr.data().bracketView).players.filter(player=>player.checkedIn).length,320);
 await assert.rejects(start(staleStart),/registration-roster-stale/);
 event=observed();
 await measure('confirm-with-stale-pairing',async()=>{firstConfirm();assert.match((await event).message,/名單又有異動/);});
 assert.equal(startWrites,0);
 assert.equal(c.eligibleRosterIds().size,320);

 await measure('redraw',()=>controller.begin());
 assert.equal(drawn,2);
 assert.equal(c.currentBracketParticipantIds().size,320);
 const validStart={auth:{uid:admin},data:startData(c.state)};
 await assert.rejects(start({...validStart,auth:{uid:late[0]}}),/permission-denied/);
 await assert.rejects(start({...validStart,data:{...validStart.data,drawId:'another-draw'}}),/bracket-version-conflict/);
 await assert.rejects(createStartHandler({db})(validStart),/registration-queue-disabled/);
 await reg(late[0]).update({status:'waitlist'});
 await assert.rejects(start(validStart),/registration-roster-stale/);
 await reg(late[0]).update({status:'confirmed'});
 await tr.update({eventDate:'2099-01-01',startAt:'14:00'});
 await assert.rejects(start(validStart),/early-start-confirmation-required/);
 await tr.update({eventDate:FieldValue.delete(),startAt:FieldValue.delete()});
 event=observed();
 const beforeStartReads=rosterReadCount();
 await measure('start-click-to-confirmation',async()=>{c.clickStart();assert.equal((await event).title,'確認開始賽事');});
 assert.equal(rosterReadCount()-beforeStartReads,1,'unchanged QR roster should require only one server snapshot');
 event=observed();
 const beforeConfirmReads=rosterReadCount();
 await measure('confirm-to-referee-tab-state',async()=>{modal.onConfirm();assert.match((await event).message,/賽事正式開始/);});
 assert.equal(rosterReadCount()-beforeConfirmReads,1);
 assert.equal(c.activeTab,'referee');assert.equal(startWrites,1);
 const [room,mirror]=await db.getAll(tr,pr);
 assert.equal(room.data().tournamentPhase,'live');
 assert.equal(mirror.data().tournamentPhase,'live');
 assert.equal(room.data().confirmedCount,320);
 const started=JSON.parse(room.data().data),publicStarted=JSON.parse(mirror.data().bracketView);
 assert.equal(started.rosterLocked,true);
 assert.equal(started.startedAt,publicStarted.startedAt);
 assert.equal(room.data().qrCheckinRevision,mirror.data().qrCheckinRevision);
 assert.equal(Object.values(started.courtAssignments).filter(court=>court.status==='in_progress').length,12);
 assert.deepEqual(Object.values(publicStarted.courtAssignments).map(court=>court.currentMatchId),
  Object.values(started.courtAssignments).map(court=>court.currentMatchId));
 const replay=await createStartHandler({db})(startRequest);
 assert.deepEqual(replay,{ok:true,startedAt:started.startedAt,drawId:started.bracketDraw.id,replayed:true});
 await assert.rejects(start({...startRequest,data:{...startRequest.data,drawId:'modified-draw'}}),/operation-conflict/);
 await assert.rejects(start({...startRequest,data:{...startRequest.data,operationId:'another-start-operation'}}),/bracket-started/);
 assert.equal((await tr.collection('operationLog').get()).size,1);
 await assert.rejects(worker.enqueue(admin,{...configure,operationId:'after-start-config',payload:{...configure.payload,operationId:'after-start-config'}}),/tournament-started/);
 assert.equal(notices.filter(x=>x.error).length,1);
 return {scope:'Firestore Emulator with V2 ownership, QR and trusted start handlers; draw writes and UI state simulated by the test, no browser Auth, App Check, production Rules or referee DOM',
  players:320,courtsConfigured:12,matchedEntrants:c.currentBracketParticipantIds().size,draws:drawn,startWrites,lateQrAudits:audits.length,
  pendingOperationsDuringFirstClick:2,postDrawPromotion:refused.reason,staleStartMessage:notices.find(x=>x.error).message,timings};
}

const watchdog=setTimeout(()=>{console.error('start-320-test-timeout');process.exit(1);},90000);
run().then(result=>{
 console.log(JSON.stringify(result,null,2));
 if(process.env.BXH_START_320_REPORT)fs.writeFileSync(process.env.BXH_START_320_REPORT,JSON.stringify(result,null,2)+'\n');
}).catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{clearTimeout(watchdog);await db.terminate();});
