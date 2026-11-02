'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const src=fs.readFileSync(path.join(__dirname,'../modules/main-app/core.js'),'utf8');
const block=src.slice(src.indexOf('let staffPromotionBusy=false;'),src.indexOf('function renderStaffRegistrationRoster(){'));
function harness(){
 const payloads=[],toasts=[],modals=[];let generation=1,key='room-user';
 const row={name:'同名選手',status:'waitlist',promotionPlayerId:'local-1'};
 const c={staffRosterReadOnly:()=>true,staffCheckinBusy:false,peopleRosterBusy:false,
  captureRegistrationRosterContext:()=>({key,generation,code:'BXH-TEST12'}),registrationRosterContextKey:()=>key,
  adminRosterGeneration:1,staffRosterCache:{key,promotionEnabled:true,rows:[row,{name:'同名選手',status:'waitlist',promotionPlayerId:'local-2'}]},
  crypto:{randomUUID:()=> 'operation-123456789'},render:()=>{},showToast:(...x)=>toasts.push(x),openModal:x=>modals.push(x),
  adminRegistrationsError:null,window:{engagementService:{tournamentOperation:async(name,p)=>{payloads.push({name,...p});return {ok:true,verified:true};}},
   cloudSync:{readStaffRegistrationRoster:async()=>({ok:true,code:'BXH-TEST12',promotionEnabled:true,rows:[{...row,status:'confirmed'}]})}}};
 vm.createContext(c);vm.runInContext(block,c);
 const target=id=>({getAttribute:k=>({'data-player-id':id})[k]||null});
 return {c,payloads,toasts,modals,target,switchRoom:()=>{key='other';}};
}
test('confirmed local target sends only ID and no capacity expansion, then verifies fresh roster',async()=>{
 const h=harness();await h.c.staffRosterPromote(h.target('local-1'));assert.equal(h.payloads.length,0);
 await h.modals[0].onConfirm();assert.equal(h.payloads.length,1);assert.equal(h.payloads[0].name,'promoteSeatedRegistration');
 assert.equal(h.payloads[0].playerId,'local-1');assert.equal(h.payloads[0].expandBy,0);assert.equal(h.toasts[0][0],'已升為正取');
});
test('off flag, duplicate identity and changed room cannot start a promotion',async()=>{
 for(const mutate of [h=>h.c.staffRosterCache.promotionEnabled=false,h=>h.c.staffRosterCache.rows.push({...h.c.staffRosterCache.rows[0]}),h=>h.c.staffRosterReadOnly=()=>false]){
  const h=harness();mutate(h);await h.c.staffRosterPromote(h.target('local-1'));assert.equal(h.modals.length,0);
 }
 const h=harness();await h.c.staffRosterPromote(h.target('local-1'));h.switchRoom();await h.modals[0].onConfirm();assert.equal(h.payloads.length,0);
});
test('network uncertainty reuses operation ID; stale readback retires it for next explicit intent',async()=>{
 const h=harness();let counter=0;h.c.crypto.randomUUID=()=> 'operation-retry-'+String(++counter).padStart(5,'0');
 h.c.window.engagementService.tournamentOperation=async(n,p)=>{h.payloads.push(p);throw Error('network');};
 await h.c.staffRosterPromote(h.target('local-1'));await h.modals.pop().onConfirm();
 await h.c.staffRosterPromote(h.target('local-1'));await h.modals.pop().onConfirm();
 assert.equal(h.payloads[0].operationId,h.payloads[1].operationId);
 h.c.window.engagementService.tournamentOperation=async(n,p)=>{h.payloads.push(p);return {ok:true,verified:true};};
 h.c.window.cloudSync.readStaffRegistrationRoster=async()=>({ok:true,code:'BXH-TEST12',promotionEnabled:true,rows:[{name:'同名選手',status:'waitlist',promotionPlayerId:'local-1'}]});
 await h.c.staffRosterPromote(h.target('local-1'));await h.modals.pop().onConfirm();
 assert.equal(h.toasts.at(-1)[1],true);
 await h.c.staffRosterPromote(h.target('local-1'));await h.modals.pop().onConfirm();
 assert.notEqual(h.payloads.at(-1).operationId,h.payloads[2].operationId);
});
