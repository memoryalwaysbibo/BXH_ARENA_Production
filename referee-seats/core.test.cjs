'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const C=require('./functions/core.cjs');
const clone=x=>JSON.parse(JSON.stringify(x));
function fixture(){
 const room={createdBy:'host',eventAuthority:'official',assignedStaffUids:['main','b1','b2','other'],refereeStationAssignments:{}},state={meta:{eventAuthority:'official',stations:2},players:[{id:'p'}],matches:[{id:'m',scoreA:2,faultActions:[{side:'A'}]}]};
 const users=Object.fromEntries(['host','main','b1','b2','other','outside'].map(uid=>[uid,{active:true,role:'staff',realName:uid}]));users.admin={active:true,role:'admin'};users.super={active:true,role:'super_admin'};
 let now=1000,seq=0;
 function run(uid,action,args={}){const d={action,...args};const out=C.transition({room,state,user:users[uid],uid,d,now,id:'r'+(++seq),targetUser:users[room.refereeSeatsV1?.courts?.[d.station]?.[d.slot]?.uid],requesterUser:users[room.refereeSeatsV1?.requests?.[d.requestId]?.fromUid]});room.refereeSeatsV1=out.model;Object.assign(room,out.projection);return out;}
 run('host','enable');
 const op=(uid,action,slot,args={})=>{const court=room.refereeSeatsV1.courts['1'];return run(uid,action,{station:1,slot,expectedCourtRevision:court.revision,expectedUid:court[slot]?.uid,...args});};
 return {room,state,users,run,op,time:n=>now=n};
}
test('activation creates exactly three empty seats per physical court and denies outsiders',()=>{const f=fixture();assert.deepEqual(Object.keys(f.room.refereeSeatsV1.courts['1']),['revision',...C.SLOTS]);assert.throws(()=>f.op('outside','claim','main'),/not-event-staff/);});
test('main and two backups coexist with three distinct UIDs',()=>{const f=fixture();f.op('main','claim','main');f.op('b1','claim','backup1');f.op('b2','claim','backup2');assert.deepEqual(f.room.refereeStationAssignments['1'],['main','b1','b2']);});
test('same person cannot occupy two seats on the same court',()=>{const f=fixture();f.op('main','claim','main');assert.throws(()=>f.op('main','claim','backup1'),/already-seated/);});
test('concurrent claim uses the court revision: second claimant is rejected',()=>{const f=fixture();f.op('main','claim','main');assert.throws(()=>f.run('other','claim',{station:1,slot:'main',expectedCourtRevision:0}),/seat-stale/);});
test('cannot replace an occupied seat directly',()=>{const f=fixture();f.op('main','claim','main');assert.throws(()=>f.op('other','claim','main'),/seat-occupied/);});
test('leave preserves score, faults and every other seat',()=>{const f=fixture(),before=clone(f.state);f.op('main','claim','main');f.op('b1','claim','backup1');f.op('b1','leave','backup1');assert.equal(f.room.refereeSeatsV1.courts['1'].main.uid,'main');assert.equal(f.room.refereeSeatsV1.courts['1'].backup1,null);assert.deepEqual(f.state,before);});
test('main can revoke a backup, backup cannot revoke main or other backup',()=>{const f=fixture();f.op('main','claim','main');f.op('b1','claim','backup1');f.op('b2','claim','backup2');assert.throws(()=>f.op('b1','revoke','main'),/permission-denied/);assert.throws(()=>f.op('b1','revoke','backup2'),/permission-denied/);f.op('main','revoke','backup1');assert.equal(f.room.refereeSeatsV1.courts['1'].backup1,null);});
for(const role of ['host','admin','super'])test(role+' can revoke any role',()=>{const f=fixture();f.op('main','claim','main');f.op('b1','claim','backup1');f.op(role,'revoke','main');f.op(role,'revoke','backup1');assert.deepEqual(f.room.refereeStationAssignments['1'],[]);});
test('only holder may leave own seat and only target may answer a request',()=>{const f=fixture();f.op('main','claim','main');assert.throws(()=>f.op('other','leave','main'),/permission-denied/);const r=f.op('other','request','main');assert.throws(()=>f.op('b1','respond','main',{requestId:r.result.requestId,response:'accept'}),/request-unavailable/);});
test('accept swaps main and backup atomically and preserves other backup',()=>{const f=fixture();f.op('main','claim','main');f.op('b1','claim','backup1');f.op('b2','claim','backup2');const req=f.op('b1','request','main');f.op('main','respond','main',{requestId:req.result.requestId,response:'accept'});const c=f.room.refereeSeatsV1.courts['1'];assert.equal(c.main.uid,'b1');assert.equal(c.backup1.uid,'main');assert.equal(c.backup2.uid,'b2');assert.equal(f.room.refereeSeatsV1.requests[req.result.requestId].status,'accepted');});
test('unseated requester replaces holder who exits; no phantom backup is created',()=>{const f=fixture();f.op('main','claim','main');const r=f.op('other','request','main');f.op('main','respond','main',{requestId:r.result.requestId,response:'accept'});assert.deepEqual(f.room.refereeStationAssignments['1'],['other']);});
test('reject changes no seat and records rejected status',()=>{const f=fixture();f.op('main','claim','main');const before=clone(f.room.refereeSeatsV1.courts);const r=f.op('other','request','main');f.op('main','respond','main',{requestId:r.result.requestId,response:'reject'});assert.deepEqual(f.room.refereeSeatsV1.courts,before);assert.equal(f.room.refereeSeatsV1.requests[r.result.requestId].status,'rejected');});
test('seat change invalidates requests and stale acceptance cannot exchange wrong users',()=>{const f=fixture();f.op('main','claim','main');const r=f.op('other','request','main');f.op('host','revoke','main');f.op('b1','claim','main');assert.throws(()=>f.op('main','respond','main',{requestId:r.result.requestId,response:'accept'}),/request-unavailable/);assert.equal(f.room.refereeSeatsV1.courts['1'].main.uid,'b1');});
test('request expires after two minutes and inactive requester cannot receive a seat',()=>{const f=fixture();f.op('main','claim','main');const r=f.op('other','request','main');f.time(121000);assert.throws(()=>f.op('main','respond','main',{requestId:r.result.requestId,response:'accept'}),/request-stale/);f.time(2000);f.users.other.active=false;assert.throws(()=>f.op('main','respond','main',{requestId:r.result.requestId,response:'accept'}),/requester-ineligible/);});
test('duplicate pending request rejected and applicant can cancel',()=>{const f=fixture();f.op('main','claim','main');const r=f.op('other','request','main');assert.throws(()=>f.op('b1','request','main'),/request-pending/);assert.throws(()=>f.op('b1','cancel','main',{requestId:r.result.requestId}),/request-unavailable/);f.op('other','cancel','main',{requestId:r.result.requestId});assert.equal(f.room.refereeSeatsV1.requests[r.result.requestId].status,'cancelled');});
test('closed court, finished room and removed roster member cannot claim',()=>{const f=fixture();f.state.forcedCourtExits={1:{closed:true}};assert.throws(()=>f.op('main','claim','main'),/invalid-seat/);f.state.forcedCourtExits={};f.room.assignedStaffUids=[];assert.throws(()=>f.op('main','claim','main'),/not-event-staff/);f.state.archiveStatus='completed';assert.throws(()=>f.op('host','claim','main'),/room-read-only/);});
test('retired extra court or unknown slot cannot be invented',()=>{const f=fixture();assert.throws(()=>f.run('main','claim',{station:3,slot:'main',expectedCourtRevision:0}),/invalid-seat/);assert.throws(()=>f.op('main','claim','backup3'),/invalid-seat/);});
test('new physical court can be claimed without reassigning old courts',()=>{const f=fixture();f.state.meta.stations=3;f.run('main','claim',{station:3,slot:'main',expectedCourtRevision:0});assert.equal(f.room.refereeSeatsV1.courts['3'].main.uid,'main');});
test('public projection contains names without UIDs or request data',()=>{const f=fixture();f.op('main','claim','main');assert.deepEqual(f.room.refereeSeatNames['1'],{main:{name:'main'},backup1:null,backup2:null});assert(!JSON.stringify(f.room.refereeSeatNames).includes('"uid"'));});
test('activation cannot silently convert legacy assignees or team scoring',()=>{const f=fixture();delete f.room.refereeSeatsV1;f.room.refereeStationAssignments={'1':['main']};assert.throws(()=>f.run('host','enable'),/legacy-assignments-exist/);f.room.refereeStationAssignments={};f.state.meta.battleMode='team';assert.throws(()=>f.run('host','enable'),/team-not-supported/);});

test('unsupported enchantment cannot enable seats and strand its scoring',()=>{const f=fixture();delete f.room.refereeSeatsV1;f.state.meta.playMode='enchantment';assert.throws(()=>f.run('host','enable'),/enchantment-not-supported/);assert.equal(f.room.refereeSeatsV1,undefined);});

function cancellationUi(f,beforeCommand=()=>{}){
 const state=clone(f.state),calls=[],toasts=[];
 state.cloudCode='BXH-TEST';state.meta.refereeSeatsV1=clone(f.room.refereeSeatsV1);
 const context={
  // Notification timers are unrelated to the click response under test.
  setTimeout:()=>0,clearTimeout:()=>{},
  cloudSync:{async manageRefereeSeats(data){calls.push(data);beforeCommand();return f.run('other',data.action,data).result;}}
 };
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../modules/main-app/referee-seats.js'),'utf8'),context);
 context.BXHRefereeSeats.bind({state:()=>state,uid:()=>'other',eligible:()=>true,operator:()=>true,manager:()=>false,render:()=>{},toast:(message,error)=>toasts.push({message,error:error===true})});
 return {ui:context.BXHRefereeSeats,calls,toasts};
}
test('requester cancel UI sends the court revision and confirms cancellation without changing seats',async()=>{
 const f=fixture();f.op('main','claim','main');f.op('b1','claim','backup1');
 const requestId=f.op('other','request','main').result.requestId,courts=clone(f.room.refereeSeatsV1.courts),before=clone(f.state);
 const {ui,calls,toasts}=cancellationUi(f);
 await ui.click('cancel',1,'main',requestId);
 assert.equal(f.room.refereeSeatsV1.requests[requestId].status,'cancelled');
 assert.equal(calls.length,1);assert.equal(calls[0].expectedCourtRevision,courts['1'].revision);
 assert.deepEqual(f.room.refereeSeatsV1.courts,courts);assert.deepEqual(f.state,before);
 assert.deepEqual(toasts,[{message:'已取消交接申請',error:false}]);
});
test('requester cancel UI preserves newer seats and reports a concurrent seat change',async()=>{
 const f=fixture();f.op('main','claim','main');const requestId=f.op('other','request','main').result.requestId;
 const {ui,toasts}=cancellationUi(f,()=>{f.op('host','revoke','main');f.op('b1','claim','main');});
 await ui.click('cancel',1,'main',requestId);
 assert.equal(f.room.refereeSeatsV1.courts['1'].main.uid,'b1');
 assert.equal(f.room.refereeSeatsV1.requests[requestId].status,'stale');
 assert.deepEqual(toasts,[{message:'席位已變更，請重新操作。',error:true}]);
});
