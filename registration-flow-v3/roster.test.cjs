'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {project} = require('./roster.cjs');
const empty = {meta:{checkinRequired:true},players:[],matches:[]};
const room = {data:JSON.stringify(empty)};
const publicRoom = {bracketView:JSON.stringify(empty)};
const candidate = {registrationId:'playerA',uid:'playerA',displayName:'選手 A',phone:'private',status:'pending_review'};
test('holds never appear in either formal roster, approval does',()=>{
 const held = project(room,publicRoom,[candidate],1);
 assert.equal(JSON.parse(held.privatePatch.data).players.length,0);
 assert.equal(JSON.parse(held.publicPatch.bracketView).players.length,0);
 const approved = project(room,publicRoom,[{...candidate,status:'confirmed'}],2);
 const privatePlayer = JSON.parse(approved.privatePatch.data).players[0];
 assert.equal(privatePlayer.registrationId,'playerA');
 const publicPlayer = JSON.parse(approved.publicPatch.bracketView).players[0];
 assert.deepEqual(publicPlayer,{id:'online_playerA',name:'選手 A',checkedIn:false});
});
test('a cancelled confirmation is removed from both rosters',()=>{
 const approved = project(room,publicRoom,[{...candidate,status:'confirmed'}],2);
 const cancelled = project(approved.privatePatch,approved.publicPatch,[{...candidate,status:'cancelled'}],3);
 assert.deepEqual(JSON.parse(cancelled.privatePatch.data).players,[]);
 assert.deepEqual(JSON.parse(cancelled.publicPatch.bracketView).players,[]);
});
test('existing brackets and unsupported roster types are not overwritten',()=>{
 assert.throws(()=>project({...room,data:JSON.stringify({...empty,matches:[{}]})},publicRoom,[],1),/bracket-locked/);
 assert.throws(()=>project({...room,data:JSON.stringify({...empty,players:[{source:'onsite'}]})},publicRoom,[],1),/registration-mode-not-supported/);
});
