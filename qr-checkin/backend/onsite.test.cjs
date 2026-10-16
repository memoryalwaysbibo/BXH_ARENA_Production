'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const O=require('./onsite/core.cjs');
const {transition,signToken}=require('./core.cjs');
const code='BXH-ONSITE',now=1800000000000;
function fixture(){
 const players=[{id:'p1',name:'甲',registrationId:'r1',registrationUid:'u1',source:'online',checkedIn:false}];
 const waiting=[{id:'p2',name:'乙',registrationId:'r2',registrationUid:'u2',source:'online',checkedIn:false}];
 const state={players,waitlistPlayers:waiting,meta:{checkinRequired:true,registrationCapacity:2},onsiteWaitlistServerOwned:true,onsiteWaitlistRuntimeRevision:1};
 const fields={capacity:2,confirmedCount:1,waitlistCount:1,onsiteWaitlistServerOwned:true,onsiteWaitlistRuntimeRevision:1,onsiteWaitlistDrawEnabled:true};
 return {user:{active:true,role:'player'},tournament:{...fields,data:JSON.stringify(state),onsiteWaitlistDraw:{enabled:true,status:'open',revision:1,roundNumber:0}},publicTournament:{...fields,bracketView:JSON.stringify(state)},
  registrations:[{registrationId:'r1',uid:'u1',status:'confirmed',displayName:'甲'},{registrationId:'r2',uid:'u2',status:'waitlist',displayName:'乙'}],operations:{},rounds:[],withdrawals:[],replacements:[]};
}
const request=()=>({uid:'u1',data:{code,action:'checkIn',playerId:'p1',checkedIn:true,expectedRevision:1,operationId:'qr-unit-operation-001'}});
test('delegated confirmed check-in uses the original draw revisions without promoting anyone',()=>{
 const a=fixture();assert.throws(()=>O.transition(a,request(),{now}),/permission-denied/);
 const r=O.transition(a,request(),{now,authorizedCheckin:true});
 assert.equal(r.result.canonicalState.players[0].checkedIn,true);assert.equal(r.result.canonicalState.waitlistPlayers.length,1);
 assert.equal(r.commit.tournamentPatch.onsiteWaitlistDraw.revision,2);assert.equal(r.commit.tournamentPatch.onsiteWaitlistRuntimeRevision,2);
 assert.deepEqual(r.commit.registrationChanges,[]);assert.equal(r.commit.round,null);
});
test('internal check-in delegation grants no configure, draw or promotion authority',()=>{
 for(const action of ['configure','draw','increaseCapacity','close','finalize','reopen']){
  const req=request();req.data.action=action;assert.throws(()=>O.transition(fixture(),req,{now,authorizedCheckin:true}),/permission-denied/);
 }
});
test('a client cannot pass the internal delegation option through the callable payload',()=>{
 assert.throws(()=>O.normalizeRequest({auth:{uid:'u1'},data:{...request().data,authorizedCheckin:true}}),/invalid-operation/);
});
test('delegated waitlist check-in is still rejected by the original accepted pool',()=>{
 const req=request();req.data.playerId='p2';assert.throws(()=>O.transition(fixture(),req,{now,authorizedCheckin:true}),/accepted-player-required/);
});
test('delegated check-in still requires an active account, open event and matching mirror',()=>{
 let a=fixture();a.user.active=false;assert.throws(()=>O.transition(a,request(),{now,authorizedCheckin:true}),/auth-required/);
 a=fixture();a.publicTournament.onsiteWaitlistRuntimeRevision=2;assert.throws(()=>O.transition(a,request(),{now,authorizedCheckin:true}),/registration-state-conflict/);
 a=fixture();const state=JSON.parse(a.tournament.data);state.startedAt=1;a.tournament.data=JSON.stringify(state);assert.throws(()=>O.transition(a,request(),{now,authorizedCheckin:true}),/bracket-locked/);
});
test('QR onsite rollout requires both the server switch and internal adapter context',()=>{
 const a=fixture(),secret='unit-only',base={code,uid:'u1',user:a.user,room:{...a.tournament,qrCheckin:{enabled:true,session:'s'}},state:JSON.parse(a.tournament.data),registration:a.registrations[0],config:{enabled:true,writerGuardsVerified:true,roomCodes:[code]},d:{action:'scan',token:signToken(code,'s',now,secret),onsiteReady:true},now,secret};
 assert.throws(()=>transition({...base,onsiteReady:true}),/onsite-integration-required/);
 base.config.onsiteIntegrationVerified=true;
 assert.throws(()=>transition(base),/onsite-integration-required/);
 assert.equal(transition({...base,onsiteReady:true}).receipt.checkedIn,true);
});
