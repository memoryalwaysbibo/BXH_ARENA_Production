'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const override=require('../modules/main-app/admin-override.js');
const bracket=require('../modules/main-app/bracket-commit.js');
const clone=x=>JSON.parse(JSON.stringify(x));
const context={actorUid:'admin',code:'BXH-X',roomId:'room'};
const actor={role:'admin',active:true};
const before={id:'room',players:[{id:'a'},{id:'b'}],matches:[],meta:{},qrCheckinRevision:7};
const approval=()=>({id:'confirmation-00001',operation:'draw-bracket',...context,at:Date.now(),reason:'現場已核對參賽名單',participantIds:['a','b'],warnings:['線上名單讀回驗證失敗']});
const after={...before,bracketDraw:{id:'draw1'},bracketSize:2,matches:[{id:'m1',a:{playerId:'a'},b:{playerId:'b'}}]};
for(const role of ['player','staff','event_staff','partner_organizer','tester'])test(role+' cannot obtain an operational override',()=>{
 assert.equal(override.allowed({role,active:true}),false);
 assert.throws(()=>override.record(approval(),context,{role,active:true},before,after),/not-authorized/);
});
for(const role of ['admin','super_admin'])test(role+' receives one audited operation with canonical role and revisions',()=>{
 const history=override.record(approval(),context,{role,active:true},before,after);
 assert.equal(history[0].actorUid,'admin');assert.equal(history[0].actorRole,role);assert.equal(history[0].qrCheckinRevision,7);
 assert.deepEqual(history[0].participantIds,['a','b']);assert.equal(before.adminOperationOverrides,undefined);
});
for(const patch of [{active:false},{isTestAccount:true},{accountStatus:'frozen'},{deleted:true}])test('disabled or test identity is rejected '+JSON.stringify(patch),()=>{
 assert.equal(override.allowed({...actor,...patch}),false);
});
test('room and account switches invalidate confirmation',()=>{
 for(const ctx of [{...context,code:'BXH-Y'},{...context,roomId:'other'},{...context,actorUid:'other'}])assert.equal(override.current(approval(),ctx,actor),false);
});
test('confirmation expires, cannot be replayed and cannot silently acquire unknown players',()=>{
 const a=approval();assert.throws(()=>override.record(a,context,actor,before,after,a.at+300001),/expired/);
 const history=override.record(a,context,actor,before,after);
 assert.throws(()=>override.record(a,context,actor,{...before,adminOperationOverrides:history},after),/already-used/);
 assert.throws(()=>override.record({...a,participantIds:['a','missing']},context,actor,before,after),/roster-changed/);
});
test('unsupported actions and completed/live rooms require separate correction workflows',()=>{
 assert.equal(override.current({...approval(),operation:'delete-account'},context,actor),false);
 for(const extra of [{startedAt:1},{archiveStatus:'completed'}])assert.throws(()=>override.record(approval(),context,actor,{...before,...extra},after),/event-locked/);
});
function transactionHarness(){
 let source=fs.readFileSync('tests/assignment-cloud-confirmation.test.cjs','utf8').split("test('staff save retries")[0];
 source=source.replace('window:{},console:','window:{BXHAdminOverride:overrideApi,BXHBracketCommit:bracketApi},console:').replace('return {api:context.api,docs,reads,stale,logs,','return {context,api:context.api,docs,reads,stale,logs,');
 const s={require,overrideApi:override,bracketApi:bracket};vm.createContext(s);vm.runInContext(source+'\nglobalThis.h=harness();',s);
 const h=s.h;for(const key of [...h.docs.keys()])if(key.endsWith('/ROOM')){h.docs.set(key.replace('/ROOM','/BXH-X'),h.docs.get(key));h.docs.delete(key);}
 return h;
}
test('cloud transaction checks the server profile, records force once and ordinary saves retain audit',async()=>{
 const h=transactionHarness(),remote=JSON.parse(h.docs.get('tournaments/BXH-X').data);
 remote.players=clone(before.players);h.docs.get('tournaments/BXH-X').data=JSON.stringify(remote);
 const candidate={...clone(remote),bracketDraw:{id:'draw1'},bracketSize:2,drawnAt:1,matches:clone(after.matches)};
 const a=approval();
 assert.equal(await h.api.pushUpdate('BXH-X',candidate,{bracketCommit:{baseSignature:bracket.signature(remote)},adminOperationalOverride:a}),true);
 const committed=JSON.parse(h.docs.get('tournaments/BXH-X').data);assert.equal(committed.adminOperationOverrides[0].id,a.id);
 delete committed.adminOperationOverrides;
 assert.equal(await h.api.pushUpdate('BXH-X',committed),true);
 assert.equal(JSON.parse(h.docs.get('tournaments/BXH-X').data).adminOperationOverrides.length,1);
});
test('a locally cached admin cannot force after server demotion and rejection writes no data',async()=>{
 const h=transactionHarness();h.docs.get('users/admin').role='staff';
 const remote=JSON.parse(h.docs.get('tournaments/BXH-X').data),candidate={...clone(remote),bracketDraw:{id:'draw1'},bracketSize:2};
 const snapshot=JSON.stringify([...h.docs]);
 assert.equal(await h.api.pushUpdate('BXH-X',candidate,{bracketCommit:{baseSignature:bracket.signature(remote)},adminOperationalOverride:approval()}),false);
 assert.equal(JSON.stringify([...h.docs]),snapshot);
});
test('forced start records the bypass but retains the bracket identity fence',async()=>{
 const h=transactionHarness(),remote=JSON.parse(h.docs.get('tournaments/BXH-X').data);
 Object.assign(remote,{players:clone(before.players),bracketDraw:{id:'draw1'},bracketSize:2,matches:clone(after.matches)});h.docs.get('tournaments/BXH-X').data=JSON.stringify(remote);
 const a={...approval(),operation:'start-tournament'},candidate={...clone(remote),startedAt:123};
 assert.equal(await h.api.pushUpdate('BXH-X',candidate,{bracketStartSignature:'wrong',adminOperationalOverride:a}),false);
 assert.equal(await h.api.pushUpdate('BXH-X',candidate,{bracketStartSignature:bracket.signature(remote),adminOperationalOverride:a}),true);
 assert.equal(JSON.parse(h.docs.get('tournaments/BXH-X').data).adminOperationOverrides[0].operation,'start-tournament');
});

test('UI offers an explicit confirmation and a revoked role cannot execute it',async()=>{
 const source=fs.readFileSync('modules/main-app/core.js','utf8');
 const a=source.indexOf('let adminOperationalOverrideBusy=false;'),b=source.indexOf('let bracketCommitContext=null;',a);
 let dialog=null,reads=0;
 const state={id:'room',cloudCode:'BXH-X',meta:{battleMode:'individual'},players:[{id:'a',name:'A'},{id:'b',name:'B'}],matches:[]};
 const s={window:{BXHAdminOverride:override,BXHBracketCommit:bracket,cloudSync:{readBracketFromServer:async()=>{reads++;throw Error('unexpected read');}}},
  state,userProfile:{...actor},currentAuthUid:()=> 'admin',eligiblePlayers:()=>state.players,currentBracketParticipantIds:()=>new Set(['a','b']),
  bracketCommitBlocked:()=>false,bracketCommitController:()=>({blocked:()=>false}),crypto:{randomUUID:()=> 'confirmation-00001'},
  openModal:cfg=>{dialog=cfg;},showToast(){},render(){},console};
 vm.createContext(s);vm.runInContext(source.slice(a,b),s);
 assert.equal(s.offerAdminOperationalOverride('draw-bracket','名單未確認'),true);
 assert.equal(dialog.confirmLabel,'我已核對，強制執行');assert.equal(reads,0);
 s.userProfile.role='staff';dialog.onConfirm();await new Promise(r=>setImmediate(r));assert.equal(reads,0);
 assert.equal(s.offerAdminOperationalOverride('draw-bracket','名單未確認'),false);
});

test('forced start retries a stale public confirmation without repeating the write',async()=>{
 const source=fs.readFileSync('modules/main-app/core.js','utf8');
 const a=source.indexOf('let adminOperationalOverrideBusy=false;'),b=source.indexOf('let bracketCommitContext=null;',a);
 const initial={...clone(before),cloudCode:'BXH-X',meta:{battleMode:'individual'},bracketSize:2,matches:clone(after.matches)};
 let remote=clone(initial),reads=0,writes=0,toasts=[];
 const grant={...approval(),operation:'start-tournament'};
 const s={state:clone(initial),userProfile:actor,currentAuthUid:()=> 'admin',window:{BXHAdminOverride:override,BXHBracketCommit:bracket,cloudSync:{readBracketFromServer:async()=>{
  reads++;return {ok:true,data:clone(remote),publicData:reads===2?clone(initial):clone(remote)};
 }}},cloneStateForSave:clone,render(){},saveRecord:async()=>true,showToast:m=>toasts.push(m),console,setTimeout:fn=>{fn();},
 enqueueCloudStateWrite:async(code,snapshot)=>{writes++;remote={...clone(snapshot),adminOperationOverrides:[{id:grant.id}]};return true;}};
 vm.createContext(s);vm.runInContext(source.slice(a,b),s);
 await s.executeAdminOperationalOverride(grant,bracket.signature(initial));
 assert.equal(writes,1);assert.equal(reads,3);assert(s.state.startedAt);assert.match(toasts.at(-1),/強制開賽已完成/);
});
