'use strict';
const {test,before,after}=require('node:test'),assert=require('node:assert/strict');
const {initializeApp,deleteApp}=require('firebase-admin/app'),{getFirestore}=require('firebase-admin/firestore');
const {createHandler}=require('./functions/service.cjs');
let app,db,handle,seq=0;
const code='BXH-SEATTEST',ref=()=>db.doc('tournaments/'+code);
const request=(uid,action,args={})=>({auth:{uid},data:{code,operationId:'emulator-operation-'+(++seq),action,...args}});
before(async()=>{
 assert(process.env.FIRESTORE_EMULATOR_HOST,'emulator required; never run against Production');
 app=initializeApp({projectId:'demo-referee-seat-service'},'seats');db=getFirestore(app);handle=createHandler(db);
 const state={id:'seat-room',meta:{eventAuthority:'official',stations:1},matches:[{id:'m',scoreA:2,scoreB:1,faultActions:[{offender:'A'}]}]};
 await Promise.all([
 ref().set({createdBy:'host',eventAuthority:'official',assignedStaffUids:['a','b','c'],refereeStationAssignments:{},data:JSON.stringify(state),updatedAt:1}),
 db.doc('publicTournaments/'+code).set({bracketView:JSON.stringify({meta:{},matches:state.matches})}),
 db.doc('systemConfig/refereeSeatsV1').set({enabled:true,perCourtScoringVerified:true}),
 ...['host','a','b','c'].map(uid=>db.doc('users/'+uid).set({active:true,role:'staff',realName:uid}))]);
 await handle(request('host','enable'));
});
after(async()=>{await deleteApp(app);});
test('real Firestore retries produce one claim and atomic swap with immutable match data',async()=>{
 const results=await Promise.allSettled(['a','b'].map(uid=>handle(request(uid,'claim',{station:1,slot:'main',expectedCourtRevision:0}))));
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
 let room=(await ref().get()).data(),holder=room.refereeSeatsV1.courts['1'].main.uid,backup=holder==='a'?'b':'a';
 await handle(request(backup,'claim',{station:1,slot:'backup1',expectedCourtRevision:1}));
 const r=await handle(request(backup,'request',{station:1,slot:'main',expectedCourtRevision:2,expectedUid:holder}));
 const accept=request(holder,'respond',{station:1,slot:'main',requestId:r.requestId,response:'accept'});
 const first=await handle(accept),retry=await handle(accept);assert.deepEqual(first,retry);
 room=(await ref().get()).data();assert.equal(room.refereeSeatsV1.courts['1'].main.uid,backup);assert.equal(room.refereeSeatsV1.courts['1'].backup1.uid,holder);
 const state=JSON.parse(room.data);assert.equal(state.matches[0].scoreA,2);assert.equal(state.matches[0].faultActions.length,1);
 const mirror=JSON.parse((await db.doc('publicTournaments/'+code).get()).data().bracketView);assert.equal(mirror.meta.refereeSeatNames['1'].main.name,backup);assert(!JSON.stringify(mirror).includes('"uid"'));
 const audits=await ref().collection('refereeSeatAudit').get();assert.equal(audits.size,5);
});

test('trusted scoring commits once, rejects stale concurrent score and revoked/off-court referee',async()=>{
 const {createScoringHandler}=require('./functions/scoring-service.cjs'),C=require('./functions/core.cjs'),score=createScoringHandler(db);
 const scoreCode='BXH-SCORETEST',scoreRef=db.doc('tournaments/'+scoreCode);
 const model={version:1,revision:1,requests:{},courts:{'1':{revision:1,main:{uid:'a',name:'A'},backup1:{uid:'b',name:'B'},backup2:null}}};
 const st={id:'score-room',cloudCode:scoreCode,meta:{eventAuthority:'official',formatType:'single',stations:1,scoringMode:'standard'},bracketSize:2,startedAt:1,players:[{id:'p1',name:'P1'},{id:'p2',name:'P2'}],matches:[{id:'m',bracket:'SE',round:0,indexInRound:0,station:1,a:{playerId:'p1'},b:{playerId:'p2'},scoreA:0,scoreB:0,log:[],faultActions:[],completed:false,status:'in_progress'}]};
 await scoreRef.set({createdBy:'host',eventAuthority:'official',assignedStaffUids:['a','b','c'],refereeSeatsV1:model,...C.project(model),data:JSON.stringify(st),updatedAt:1});
 await db.doc('publicTournaments/'+scoreCode).set({bracketView:JSON.stringify({meta:{},matches:st.matches})});
 function cmd(uid,action,revision,args={}){return {auth:{uid},data:{code:scoreCode,operationId:'trusted-score-op-'+(++seq),action,station:1,matchId:'m',expectedCourtRevision:1,expectedScoreRevision:revision,expectedDispatchRevision:0,playerAId:'p1',playerBId:'p2',...args}};}
 const requests=['a','b'].map(uid=>cmd(uid,'score',0,{side:'A',finish:'spin'}));
 const race=await Promise.allSettled(requests.map(r=>score(r)));assert.equal(race.filter(r=>r.status==='fulfilled').length,1);
 const winnerIndex=race.findIndex(r=>r.status==='fulfilled');await score(requests[winnerIndex]);
 let data=(await scoreRef.get()).data(),parsed=JSON.parse(data.data);assert.equal(parsed.matches[0].scoreA,1);assert.equal((await scoreRef.collection('refereeScoreAudit').get()).size,1);
 await score(cmd('a','fault',1,{side:'A'}));await score(cmd('b','fault',2,{side:'A'}));
 parsed=JSON.parse((await scoreRef.get()).data().data);assert.equal(parsed.matches[0].scoreB,1);
 await assert.rejects(score(cmd('c','score',3,{side:'A',finish:'spin'})),/station-not-assigned/);
 await handle({auth:{uid:'host'},data:{code:scoreCode,operationId:'revoke-score-main-123',action:'revoke',station:1,slot:'main',expectedCourtRevision:1,expectedUid:'a'}});
 await assert.rejects(score(cmd('a','score',3,{side:'A',finish:'spin'})),/station-not-assigned/);
 const mirror=JSON.parse((await db.doc('publicTournaments/'+scoreCode).get()).data().bracketView);assert.equal(mirror.matches[0].scoreB,1);assert(!JSON.stringify(mirror).includes('confirmedByUid'));
});

test('pinned CALL/PASS service survives seat replacement and recalls after trusted predecessor confirmation',async()=>{
 const {loadWriter}=require('../qr-checkin/backend/writer-fixtures.cjs'),{createScoringHandler}=require('./functions/scoring-service.cjs'),C=require('./functions/core.cjs');
 let now=20000;const call=loadWriter('courtCallService','court-call-service.js',db).createCourtCallService(db,()=>now+=11000),score=createScoringHandler(db);
 const passCode='BXH-PASSTEST',tour=db.doc('tournaments/'+passCode),model={version:1,revision:1,requests:{},courts:{1:{revision:1,main:{uid:'a',name:'A'},backup1:null,backup2:null}}};
 const players=['p1','p2','p3','p4'].map(id=>({id,name:id,playerUid:id}));
 const matches=[['m1','p1','p2'],['m2','p3','p4']].map(([id,a,b],seq)=>({id,station:1,bracket:'RR',round:0,seq,a:{playerId:a},b:{playerId:b},scoreA:0,scoreB:0,log:[],faultActions:[],completed:false,status:seq?'pending':'in_progress'}));
 const state={id:'pass-room',cloudCode:passCode,createdBy:'host',meta:{eventAuthority:'official',formatType:'roundrobin',stations:1,scoringMode:'standard'},startedAt:1,players,matches,courtAssignments:{court1:{currentMatchId:'m1',nextMatchId:'m2',status:'in_progress'}}};
 await Promise.all([tour.set({createdBy:'host',eventAuthority:'official',assignedStaffUids:['a','b','c','host'],refereeSeatsV1:model,...C.project(model,'host',1),data:JSON.stringify(state)}),db.doc('publicTournaments/'+passCode).set({bracketView:JSON.stringify(state)}),...players.map(p=>db.doc('users/'+p.id).set({active:true,role:'player'}))]);
 const callReq=(uid,action,args={})=>({auth:{uid},data:{code:passCode,action,operationId:'pass-emulator-op-'+(++seq),matchId:'m1',...args}});
 await call(callReq('host','notify'));
 await call(callReq('p1','respond',{sequence:1,response:'pass',participantId:'p1',reason:'裝備處理'}));
 let saved=JSON.parse((await tour.get()).data().data);assert.deepEqual(saved.matches[0].callPass.waitFor,['m2']);assert.equal(saved.courtAssignments.court1.currentMatchId,'m2');
 const seats=(uid,action,args)=>handle({auth:{uid},data:{code:passCode,action,operationId:'pass-seat-operation-'+(++seq),station:1,slot:'main',...args}});
 const handoff=await seats('b','request',{expectedCourtRevision:1,expectedUid:'a'});await seats('a','respond',{requestId:handoff.requestId,response:'accept'});
 await assert.rejects(call(callReq('a','notify',{matchId:'m2'})),/permission-denied|referee-required/);
 await call(callReq('b','notify',{matchId:'m2'}));
 function scoreReq(matchId,action,rev,args={}){const pair=matchId==='m1'?['p1','p2']:['p3','p4'];return {auth:{uid:'b'},data:{code:passCode,operationId:'pass-score-op-'+(++seq),action,matchId,station:1,expectedCourtRevision:2,expectedScoreRevision:rev,expectedDispatchRevision:matchId==='m1'?1:0,playerAId:pair[0],playerBId:pair[1],...args}};}
 await assert.rejects(score(scoreReq('m1','score',0,{side:'A',finish:'spin'})),/pass-protected/);
 await score(scoreReq('m2','score',0,{side:'A',finish:'extreme'}));await score(scoreReq('m2','score',1,{side:'A',finish:'spin'}));await score(scoreReq('m2','confirm',2));
 const recalled=await call(callReq('b','list'));assert(recalled.rows.some(r=>r.matchId==='m1'&&r.sequence===2&&r.waitingFor.length===0));
 const record=(await db.doc('courtCalls/'+passCode).get()).data();assert(record.used.p1);assert.equal(record.calls.m1.pass.status,'approved');
 await score(scoreReq('m1','score',0,{side:'B',finish:'spin'}));saved=JSON.parse((await tour.get()).data().data);assert.equal(saved.matches[0].scoreB,1);assert.deepEqual(saved.matches[0].callPass.waitFor,['m2']);
});

test('actual dispatch exit, retry, reopen and detached recovery preserve scores and faults',async()=>{
 const {createScoringHandler}=require('./functions/scoring-service.cjs'),C=require('./functions/core.cjs'),dispatch=createScoringHandler(db),dispatchCode='BXH-DISPATCH',tour=db.doc('tournaments/'+dispatchCode);
 const model={version:1,revision:1,requests:{},courts:{1:{revision:1,main:{uid:'a',name:'A'},backup1:null,backup2:null}}};
 const state={id:'dispatch-room',cloudCode:dispatchCode,meta:{eventAuthority:'official',formatType:'roundrobin',stations:1},startedAt:1,players:[{id:'p1',name:'P1'},{id:'p2',name:'P2'}],matches:[{id:'m',station:1,bracket:'RR',round:0,seq:0,a:{playerId:'p1'},b:{playerId:'p2'},scoreA:2,scoreB:1,log:[{test:'preserve'}],faultActions:[{offender:'A'}],completed:false,status:'in_progress'}],courtAssignments:{court1:{currentMatchId:'m',nextMatchId:null}}};
 await Promise.all([tour.set({createdBy:'host',eventAuthority:'official',assignedStaffUids:['a','host'],refereeSeatsV1:model,...C.project(model,'host',1),data:JSON.stringify(state)}),db.doc('publicTournaments/'+dispatchCode).set({bracketView:JSON.stringify(state)})]);
 const req=(uid,action,args={})=>({auth:{uid},data:{code:dispatchCode,operationId:'dispatch-emulator-op-'+(++seq),action,station:1,matchId:'m',expectedCourtRevisions:{1:1},expectedScoreRevision:0,expectedDispatchRevision:0,playerAId:'p1',playerBId:'p2',expectedExitRevision:0,...args}});
 const exit=req('a','force-exit');await dispatch(exit);await dispatch(exit);
 let saved=(await tour.get()).data(),s=JSON.parse(saved.data);assert.equal(saved.courtLifecycleWriteSeq,1);assert.equal(s.matches[0].station,0);assert.equal(s.matches[0].scoreA,2);assert.equal(s.matches[0].faultActions.length,1);
 await dispatch(req('host','reopen',{matchId:null,expectedExitRevision:1}));
 await dispatch(req('host','claim-detached',{station:0,targetStation:1,expectedScoreRevision:1,expectedDispatchRevision:1}));
 s=JSON.parse((await tour.get()).data().data);assert.equal(s.matches[0].station,1);assert.equal(s.matches[0].scoreA,2);assert.equal(s.matches[0].scoreB,1);assert.equal(s.matches[0].faultActions.length,1);assert.deepEqual(s.matches[0].log,[{test:'preserve'}]);
});
