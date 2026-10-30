'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const src=fs.readFileSync(require('node:path').join(__dirname,'../modules/main-app/core.js'),'utf8');
const start=src.indexOf('let staffCheckinBusy=false;'),end=src.indexOf('function renderStaffRegistrationRoster()',start);
function harness(){
 const payloads=[],toasts=[],modals=[],row={name:'同名兒童',status:'confirmed',checkedIn:false,playerId:'child-row'};
 const context={key:'room-user-tab',generation:1,code:'BXH-TEST12'};
 const c={staffRosterReadOnly:()=>true,peopleRosterBusy:false,captureRegistrationRosterContext:()=>context,
  registrationRosterContextKey:()=>context.key,adminRosterGeneration:1,
  staffRosterCache:{key:context.key,checkinEnabled:true,rows:[row,{name:'同名兒童',status:'confirmed',checkedIn:false,playerId:'sibling'}]},
  crypto:{randomUUID:()=> 'operation-123456789'},render:()=>{},showToast:(...x)=>toasts.push(x),openModal:x=>modals.push(x),
  adminRegistrationsError:null,window:{engagementService:{tournamentOperation:async(name,p)=>{payloads.push({name,...p});return {ok:true};}},
   cloudSync:{readStaffRegistrationRoster:async()=>({ok:true,code:'BXH-TEST12',checkinEnabled:true,rows:[{...row,checkedIn:true}]})}}};
 vm.createContext(c);vm.runInContext(src.slice(start,end),c);
 const target=checked=>({getAttribute:key=>({'data-player-id':'child-row','data-checked-in':String(checked)})[key]});
 return {c,payloads,toasts,modals,target};
}
test('exact child ID is sent to trusted check-in endpoint and confirmed by fresh roster',async()=>{
 const h=harness();await h.c.staffRosterCheckin(h.target(true));
 assert.equal(h.payloads.length,1);assert.equal(h.payloads[0].name,'tournamentCheckin');assert.equal(h.payloads[0].action,'manual');
 assert.equal(h.payloads[0].playerId,'child-row');assert.equal(h.toasts[0][0],'報到成功');
});
test('cancel check-in requires confirmation and uses revoke only',async()=>{
 const h=harness();h.c.staffRosterCache.rows[0].checkedIn=true;
 h.c.window.cloudSync.readStaffRegistrationRoster=async()=>({ok:true,code:'BXH-TEST12',checkinEnabled:true,rows:[{playerId:'child-row',status:'confirmed',checkedIn:false}]});
 await h.c.staffRosterCheckin(h.target(false));assert.equal(h.payloads.length,0);assert.equal(h.modals.length,1);
 await h.modals[0].onConfirm();await new Promise(r=>setImmediate(r));
 assert.equal(h.payloads[0].action,'revoke');assert.equal(h.toasts[0][0],'已取消報到');
});
test('off gate, revoked role and waitlist cannot initiate check-in',async()=>{
 for(const mutate of [h=>{h.c.staffRosterCache.checkinEnabled=false;},h=>{h.c.staffRosterReadOnly=()=>false;},h=>{h.c.staffRosterCache.rows[0].status='waitlist';}]){
  const h=harness();mutate(h);await h.c.staffRosterCheckin(h.target(true));assert.equal(h.payloads.length,0);
 }
});
test('switching room after confirmation or during response cannot change the new room cache',async()=>{
 const h=harness();h.c.staffRosterCache.rows[0].checkedIn=true;await h.c.staffRosterCheckin(h.target(false));
 h.c.registrationRosterContextKey=()=> 'other';h.modals[0].onConfirm();assert.equal(h.payloads.length,0);
 const j=harness();j.c.window.engagementService.tournamentOperation=async()=>{j.c.registrationRosterContextKey=()=> 'other';return {ok:true};};
 await j.c.staffRosterCheckin(j.target(true));assert.equal(j.c.staffRosterCache.rows[0].checkedIn,false);assert.equal(j.toasts.length,0);
});
test('failed response retries the same operation and never reports unverified success',async()=>{
 const h=harness();h.c.window.engagementService.tournamentOperation=async(name,p)=>{h.payloads.push(p);throw Error('network');};
 await h.c.staffRosterCheckin(h.target(true));await h.c.staffRosterCheckin(h.target(true));
 assert.equal(h.payloads[0].operationId,h.payloads[1].operationId);assert(h.toasts.every(x=>x[1]===true));
});
test('duplicate taps share one in-flight write and readback disagreement is not success',async()=>{
 const h=harness();let release;
 h.c.window.engagementService.tournamentOperation=async(name,p)=>{h.payloads.push(p);return new Promise(r=>{release=r;});};
 const first=h.c.staffRosterCheckin(h.target(true));await h.c.staffRosterCheckin(h.target(true));assert.equal(h.payloads.length,1);release({ok:true});await first;
 const j=harness();j.c.window.cloudSync.readStaffRegistrationRoster=async()=>({ok:true,code:'BXH-TEST12',checkinEnabled:true,rows:[{playerId:'child-row',status:'confirmed',checkedIn:false}]});
 await j.c.staffRosterCheckin(j.target(true));assert(j.toasts.every(x=>x[1]===true));
});
