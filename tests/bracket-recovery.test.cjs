'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const api=require('../modules/main-app/bracket-commit.js');
const clone=x=>JSON.parse(JSON.stringify(x));
function fixture(){
 let remote={id:'r',cloudCode:'BXH-X',meta:{formatType:'single'},players:[{id:'a',name:'A',checkedIn:true},{id:'b',name:'B',checkedIn:true}],matches:[],registrationRosterRevision:1};
 const original=clone(remote),memory=new Map();let pub=clone(remote),active=true,authorized=true,accept=false,generations=0,writes=[];
 const ctx={key:'admin:BXH-X',actorUid:'admin',minimumFeedbackMs:0,confirmationDelayMs:0,
  storage:{getItem:k=>memory.get(k),setItem:(k,v)=>memory.set(k,v),removeItem:k=>memory.delete(k)},
  current:()=>active,state:()=>clone(original),cloud:()=>true,operationId:()=> 'original-draw',authorizeOverride:()=>authorized,
  read:async()=>({ok:true,data:clone(remote),publicData:clone(pub)}),
  generate:()=>{generations++;return {...clone(original),drawnAt:10,bracketSize:2,matches:[{id:'m1',a:{playerId:'a'},b:{playerId:'b'}}]};},
  writeFailureCode:()=> 'registration-roster-stale',
  write:async(snapshot,options)=>{writes.push({snapshot:clone(snapshot),options:clone(options)});if(!accept)return false;api.assertWrite(remote,snapshot,options);remote=clone(snapshot);remote.adminOperationOverrides=[{id:options.adminOperationalOverride.id}];pub=clone(remote);return true;},
  rebaseOverride:(fresh,snapshot)=>({...clone(fresh),matches:clone(snapshot.matches),bracketSize:snapshot.bracketSize,drawnAt:snapshot.drawnAt,bracketDraw:clone(snapshot.bracketDraw),bracketDrawHistory:clone(snapshot.bracketDrawHistory)}),
  changed(){},apply(){},success(){}
 };
 return {ctx,c:api.create(ctx),grant:{id:'confirmation-00001',operation:'draw-bracket',participantIds:['a','b'],at:Date.now()},
  get remote(){return remote;},set remote(x){remote=x;pub=clone(x);},set pub(x){pub=x;},get writes(){return writes;},get generations(){return generations;},
  accept:()=>accept=true,revoke:()=>authorized=false,leave:()=>active=false};
}
test('failed normal draw retains its cause, and force submits the same pairing using current revisions',async()=>{
 const h=fixture();assert.equal(await h.c.begin(),false);assert.equal(h.c.status().error,'registration-roster-stale');
 const prior=h.writes[0].snapshot;h.remote={...h.remote,registrationRosterRevision:2,callRevision:3,meta:{...h.remote.meta,refereeSeatsV1:{main:'ref'}}};h.accept();
 assert.equal(await h.c.forceSubmit(h.grant),true);assert.equal(h.generations,1);assert.equal(h.writes.length,2);
 const last=h.writes.at(-1);assert.deepEqual(last.snapshot.matches,prior.matches);assert.deepEqual(last.snapshot.bracketDraw,prior.bracketDraw);
 assert.equal(last.snapshot.registrationRosterRevision,2);assert.equal(last.snapshot.callRevision,3);assert.equal(last.snapshot.meta.refereeSeatsV1.main,'ref');
 assert.equal(last.options.adminOperationalOverride.id,h.grant.id);assert.equal(h.c.status().pending,false);
});
test('ordinary retry never silently grants an admin override',async()=>{
 const h=fixture();await h.c.begin();await h.c.retry();assert(h.writes.every(w=>!w.options.adminOperationalOverride));assert.equal(h.generations,1);
});
test('a refreshed controller restores the failed state and can force the stored original pairing',async()=>{
 const h=fixture();await h.c.begin();const restored=api.create(h.ctx);
 assert.equal(restored.status().pending,true);assert.equal(restored.status().result,'failed');
 h.accept();assert.equal(await restored.forceSubmit(h.grant),true);assert.equal(h.generations,1);
});
test('recovering an already committed draw performs no second write',async()=>{
 const h=fixture();await h.c.begin();h.remote=clone(h.writes[0].snapshot);const n=h.writes.length;
 assert.equal(await h.c.forceSubmit(h.grant),true);assert.equal(h.writes.length,n);assert.equal(h.generations,1);
});
test('private commit with an unconfirmed public mirror remains read-only',async()=>{
 const h=fixture();await h.c.begin();const old=clone(h.remote);h.remote=clone(h.writes[0].snapshot);h.pub=old;
 assert.equal(await h.c.forceSubmit(h.grant),false);assert.equal(h.writes.length,1);assert.equal(h.c.status().error,'cloud-readback-unconfirmed');assert(h.c.status().pending);
});
for(const scenario of ['started','completed','competing','removed','other-room','managed'])test('force recovery never overwrites '+scenario+' state',async()=>{
 const h=fixture();await h.c.begin();const fresh=clone(h.remote);
 if(scenario==='started')fresh.startedAt=5;
 if(scenario==='completed')fresh.archiveStatus='completed';
 if(scenario==='competing'){fresh.drawnAt=6;fresh.bracketDraw={id:'someone-else'};}
 if(scenario==='removed')fresh.players.pop();
 if(scenario==='other-room')fresh.id='other';
 if(scenario==='managed'){fresh.onsiteWaitlistServerOwned=true;fresh.onsiteWaitlistFinalized=false;}
 h.remote=fresh;h.accept();assert.equal(await h.c.forceSubmit(h.grant),false);assert.equal(h.writes.length,1);assert.equal(h.generations,1);
});
test('revoked authority, room switch, or altered approval cannot promote a pending draw',async()=>{
 for(const change of ['role','room','selection']){const h=fixture();await h.c.begin();h.accept();
  if(change==='role')h.revoke();if(change==='room')h.leave();if(change==='selection')h.grant.participantIds=['a','extra'];
  assert.equal(await h.c.forceSubmit(h.grant),false);assert.equal(h.writes.length,1);
 }
});
test('double force clicks serialize one recovery and do not generate another draw',async()=>{
 const h=fixture();await h.c.begin();h.accept();const results=await Promise.all([h.c.forceSubmit(h.grant),h.c.forceSubmit(h.grant)]);
 assert.deepEqual(results,[true,false]);assert.equal(h.writes.length,2);assert.equal(h.generations,1);
});
function uiFixture(){
 const core=fs.readFileSync('modules/main-app/core.js','utf8'),a=core.indexOf('// Bracket generation is detached'),b=core.indexOf('function currentRoundLabelForBoard(){',a);
 let status={busy:false,pending:false,result:''},dialog=null,forceCalls=0;
 const controller={status:()=>status,blocked:()=>status.busy||status.pending,selection:()=>[{id:'a',name:'A'},{id:'b',name:'B'}],forceSubmit:async()=>{forceCalls++;}};
 const s={state:{id:'r',cloudCode:'BXH-X',players:[],matches:[],meta:{battleMode:'individual'}},userProfile:{active:true,role:'admin'},currentAuthUid:()=> 'admin',
  window:{BXHAdminOverride:require('../modules/main-app/admin-override.js')},crypto:{randomUUID:()=> 'confirmation-00001'},esc:x=>String(x).replace(/</g,'&lt;'),
  render(){},openModal:m=>dialog=m,showToast(){},entryRosterValid:()=>true,eligiblePlayers:()=>[],currentBracketParticipantIds:()=>new Set()};
 vm.createContext(s);vm.runInContext(core.slice(a,b),s);s.bracketCommitController=()=>controller;
 return {s,set status(x){status=x;},get dialog(){return dialog;},get forceCalls(){return forceCalls;}};
}
test('force controls appear only after failure, and pending recovery is alongside retry',()=>{
 const h=uiFixture(),s=h.s;assert.equal(s.adminOverrideButtonsHtml(),'');assert(!s.bracketDrawButtonHtml().includes('admin-force'));
 h.status={busy:true,pending:true,result:''};assert(!s.bracketCommitStatusHtml().includes('admin-force-reconfirm'));
 h.status={busy:false,pending:true,result:'failed',error:'registration-roster-stale'};
 const html=s.bracketCommitStatusHtml();assert.match(html,/重試上傳/);assert.match(html,/管理員強制提交原配對/);assert.match(html,/registration-roster-stale/);
 assert(!html.includes('admin-force-start'));assert.equal(s.bracketDrawButtonHtml(),'');
 s.reconfirmPendingAdminOverride();assert.match(h.dialog.message,/A、B/);assert.equal(h.forceCalls,0,'Opening the modal must not write');
 h.dialog.onConfirm();assert.equal(h.forceCalls,1);
 s.userProfile.role='staff';assert(!s.bracketCommitStatusHtml().includes('admin-force-reconfirm'));
});
test('start failure exposes only forced start for the same room and actor',()=>{
 const h=uiFixture(),s=h.s;s.state.bracketSize=2;s.noteAdminOperationalFailure('start-tournament','cloud-readback-unconfirmed');
 assert.match(s.adminOverrideButtonsHtml(),/管理員強制開賽/);assert(!s.adminOverrideButtonsHtml().includes('admin-force-draw'));
 s.state.cloudCode='BXH-OTHER';assert.equal(s.adminOverrideButtonsHtml(),'');
});
