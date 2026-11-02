'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const source=fs.readFileSync('modules/main-app/qr-checkin.js','utf8');
const core=fs.readFileSync('modules/main-app/core.js','utf8');
const flush=()=>new Promise(r=>setImmediate(r));
function harness(){
 let room={cloudCode:'BXH-TEST12',players:[{id:'p1',checkedIn:false},{id:'p2',checkedIn:false}]},serial=0,uid='admin';
 const calls=[],reads=[],toasts=[],applied=[],storage=new Map(),timers=new Map();let timerId=0;
 const env={URL,Date,location:{href:'https://arena.bxh.com.tw/'},crypto:{randomUUID:()=> 'checkin-operation-'+(++serial)},
  document:{getElementById(){return null;},addEventListener(){}},
  sessionStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},
  setTimeout:(fn,ms)=>{timers.set(++timerId,{fn,ms});return timerId;},clearTimeout:id=>timers.delete(id),
  window:{engagementService:{tournamentOperation:async(name,p)=>{calls.push(p);return {ok:true};}},
   cloudSync:{joinRoom:async(code,options)=>{reads.push({code,options});return {ok:true,data:structuredClone(room)};}}}};
 vm.createContext(env);vm.runInContext(source,env);const ui=env.window.BXHQrCheckin;
 const bind=()=>ui.bind({state:()=>room,uid:()=>uid,render(){},toast:(...args)=>toasts.push(args),applyRemote:data=>{applied.push(data);room=data;bind();}});
 bind();
 return {ui,env,calls,reads,toasts,applied,storage,timers,get room(){return room;},switchRoom(code){room={...room,cloudCode:code};bind();},switchUid(next){uid=next;bind();},
  expire(ms){const match=[...timers.values()].find(t=>t.ms===ms);assert(match);match.fn();},
  async manual(id='p1',checkedIn=true){return ui.manual({id},checkedIn);}};
}
test('pending manual check-in disables real roster buttons and explains a second click',async()=>{
 const h=harness();let release;h.env.window.engagementService.tournamentOperation=async(name,p)=>{h.calls.push(p);return new Promise(r=>release=r);};
 const pending=h.manual();assert(h.ui.busy());assert.match(h.ui.button(),/正在處理報到/);
 const lines=core.split('\n'),render=vm.runInNewContext(lines.find(l=>l.includes('const checkinProcessing='))+lines.find(l=>l.includes('const checkinActionLocked='))+lines.find(l=>l.includes('const checkinToggle='))+';checkinToggle',
  {window:h.env.window,peopleRosterBusy:false,state:{},checkinClosed:false,needsCheckin:true});
 assert.match(render({id:'p2',checkedIn:false}),/disabled/);assert.match(render({id:'p2',checkedIn:false}),/處理中/);
 await h.manual('p2');assert.equal(h.calls.length,1);assert.match(h.toasts[0][0],/上一筆/);
 h.room.players[0].checkedIn=true;release({ok:true});await pending;assert(!h.ui.busy());assert.equal(h.toasts.at(-1)[0],'報到成功');
});
test('success requires exact player state from a server-only read',async()=>{
 const h=harness();h.room.players[0].checkedIn=true;await h.manual();
 assert.equal(h.reads[0].options.serverOnly,true);assert.equal(h.toasts.at(-1)[0],'報到成功');assert.equal(h.storage.size,0);
});
test('acknowledgement with unchanged, missing, duplicate or wrong-room readback never reports success',async()=>{
 for(const mutate of [h=>{},h=>h.room.players=[],h=>h.room.players=[{id:'p1',checkedIn:true},{id:'p1',checkedIn:true}],h=>{
  h.env.window.cloudSync.joinRoom=async()=>({ok:true,data:{cloudCode:'BXH-OTHER',players:[{id:'p1',checkedIn:true}]}});
 }]){const h=harness();mutate(h);await h.manual();assert(h.toasts.every(t=>t[1]===true));assert(!h.ui.busy());assert.match(h.ui.button(),/狀態|尚未確認/);}
});
test('revoke requires explicit false rather than a missing check-in field',async()=>{
 const h=harness();h.room.players[0].checkedIn=true;await h.manual('p1',false);assert(h.toasts.at(-1)[1]);
 h.room.players[0].checkedIn=false;await h.manual('p1',false);assert.equal(h.calls.at(-1).action,'revoke');assert.equal(h.toasts.at(-1)[0],'已撤銷報到');
});
test('lost acknowledgement is reconciled without another write when server attendance matches',async()=>{
 const h=harness();h.env.window.engagementService.tournamentOperation=async(name,p)=>{h.calls.push(p);h.room.players[0].checkedIn=true;throw Error('network');};
 await h.manual();assert.equal(h.calls.length,1);assert.equal(h.toasts.at(-1)[0],'報到成功');
});
test('unknown outcome retains its operation id for an explicit retry and never resends automatically',async()=>{
 const h=harness();h.env.window.engagementService.tournamentOperation=async(name,p)=>{h.calls.push(p);throw Error('network');};
 await h.manual();assert.equal(h.calls.length,1);assert(h.toasts.at(-1)[1]);await h.manual();assert.equal(h.calls.length,2);assert.equal(h.calls[0].operationId,h.calls[1].operationId);
});
test('verified competing state retires an old receipt so the next explicit operation can take effect',async()=>{
 const h=harness();await h.manual();h.room.players[0].checkedIn=true;await h.manual();
 assert.notEqual(h.calls[0].operationId,h.calls[1].operationId);assert.equal(h.toasts.at(-1)[0],'報到成功');
});
test('App Check denial releases controls, persists its explanation and does not read or resend',async()=>{
 const h=harness();h.env.window.engagementService.tournamentOperation=async(name,p)=>{h.calls.push(p);throw Object.assign(Error('permission-denied'),{details:{reason:'app-check-unavailable'}});};
 await h.manual();assert.equal(h.calls.length,1);assert.equal(h.reads.length,0);assert(!h.ui.busy());assert.match(h.ui.button(),/網站驗證未完成/);assert(h.toasts.at(-1)[1]);
});
test('request deadline reconciles once and ignores a late result',async()=>{
 const h=harness();let release;h.env.window.engagementService.tournamentOperation=()=>new Promise(r=>release=r);
 const pending=h.manual();h.expire(45000);await pending;assert(!h.ui.busy());assert(h.toasts.at(-1)[1]);const before=h.toasts.length;
 release({ok:true});await flush();assert.equal(h.toasts.length,before);assert.equal(h.applied[0].players[0].checkedIn,false);
});
test('server read deadline releases controls and never applies a late snapshot',async()=>{
 const h=harness();let release;h.env.window.cloudSync.joinRoom=()=>new Promise(r=>release=r);
 const pending=h.manual();await flush();h.expire(10000);await pending;assert(!h.ui.busy());assert(h.toasts.at(-1)[1]);
 release({ok:true,data:{cloudCode:'BXH-TEST12',players:[{id:'p1',checkedIn:true}]}});await flush();assert.equal(h.applied.length,0);
});
test('room or account changes discard old replies without unlocking a newer operation',async()=>{
 for(const switchContext of [h=>h.switchRoom('BXH-OTHER'),h=>h.switchUid('other-admin')]){
  const h=harness(),releases=[];h.env.window.engagementService.tournamentOperation=()=>new Promise(r=>releases.push(r));
  const old=h.manual();switchContext(h);const next=h.manual();releases[0]({ok:true});await old;assert(h.ui.busy());assert.equal(h.reads.length,0);
  h.room.players[0].checkedIn=true;releases[1]({ok:true});await next;assert(!h.ui.busy());assert.equal(h.toasts.length,1);
 }
});
