'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {initialize}=require('./auto-init-core.cjs');
const release={enabled:true,perCourtScoringVerified:true};
const room=(stations=6,patch={})=>({meta:{eventAuthority:'official',battleMode:'individual',playMode:'standard',stations,assignedStaffUids:[],...patch}});
test('official individual room initializes exactly three empty seats per court without mutating input',()=>{
 const state=room(),before=JSON.stringify(state),r=initialize({state,ownerUid:'owner',release});
 assert.equal(r.ok,true);assert.equal(Object.keys(r.model.courts).length,6);
 for(let n=1;n<=6;n++){assert.deepEqual(r.model.courts[n],{revision:0,main:null,backup1:null,backup2:null});assert.deepEqual(r.privateFields.refereeStationAssignments[n],['owner']);}
 for(const k of ['assignedStaffUids','refereeSeatsV1','refereeStationAssignments','refereeStationUids'])assert.equal(Object.hasOwn(r.publicMeta,k),false);
 assert.equal(JSON.stringify(state),before);
});
test('release gate fails closed',()=>{for(const flags of [{enabled:false,perCourtScoringVerified:true},{enabled:true,perCourtScoringVerified:false},{}])assert.equal(initialize({state:room(),ownerUid:'owner',release:flags}).reason,'release-not-ready');});
test('unsupported rooms are untouched',()=>{for(const state of [room(2,{eventAuthority:'community'}),room(2,{battleMode:'team'}),room(2,{playMode:'enchantment'}),{...room(),testMode:true}])assert.equal(initialize({state,ownerUid:'owner',release}).reason,'unsupported-mode');});
test('invalid counts and legacy allocations are rejected',()=>{for(const n of [0,33,1.5,'6'])assert.equal(initialize({state:room(n),ownerUid:'owner',release}).reason,'invalid-stations');assert.equal(initialize({state:room(2,{refereeStationAssignments:{1:['legacy']}}),ownerUid:'owner',release}).reason,'legacy-assignments-exist');});
test('already enabled room cannot be reinitialized',()=>{const state=room(2,{refereeSeatsV1:{version:1,courts:{1:{main:{uid:'staff'}}}}});assert.equal(initialize({state,ownerUid:'owner',release}).reason,'already-enabled');assert.equal(state.meta.refereeSeatsV1.courts[1].main.uid,'staff');});
test('owner is included without replacing existing staff',()=>{const r=initialize({state:room(2,{assignedStaffUids:['staff']}),ownerUid:'owner',release});assert.deepEqual(r.privateFields.assignedStaffUids,['staff','owner']);});
