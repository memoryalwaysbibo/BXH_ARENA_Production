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
