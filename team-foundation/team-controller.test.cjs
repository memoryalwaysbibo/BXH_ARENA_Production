'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {createTeamController}=require('./team-controller.js');
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
function setup(overrides={}){return createTeamController({newRequestId:()=> 'test-operation-00000001',api:{list:async()=>({items:[],total:0}),members:async()=>({name:'Alpha',members:[]}),mine:async()=>({team:null}),applications:async()=>({items:[],hasMore:false}),history:async()=>({items:[]}),command:async()=>({ok:true}),...overrides}});}
test('slow search cannot overwrite newer results or member view',async()=>{
 const d=deferred();const c=setup({list:async q=>q.query==='old'?d.promise:{items:[{id:'new'}],total:1}});
 const old=c.search({query:'old'});await c.search({query:'new'});d.resolve({items:[{id:'old'}],total:1});await old;assert.equal(c.snapshot().items[0].id,'new');
 await c.view('a');assert.equal(c.snapshot().screen,'members');assert.equal(c.snapshot().team.name,'Alpha');
});
test('mutation is single-flight; rejects forged identity and refreshes after success',async()=>{
 const d=deferred();let calls=0,payload;const c=setup({command:async p=>{calls++;payload=p;return d.promise;}});
 const first=c.operate('join','a',{actorUid:'forged',points:99999});assert.equal((await c.operate('join','a')).reason,'busy');
 d.resolve({ok:true});await first;assert.equal(calls,1);assert.deepEqual(payload,{action:'apply',teamId:'a',requestId:'test-operation-00000001'});assert.equal(c.snapshot().busy,false);
});
test('uncertain writes are not automatically retried or shown as success',async()=>{
 let calls=0;const c=setup({command:async()=>{calls++;throw Error('network');}});
 assert.equal((await c.operate('apply','a')).reason,'unconfirmed');assert.equal(calls,1);assert.ok(c.snapshot().error.includes('尚未確認'));
});
test('dispose ignores pending loads; search failures clear stale results',async()=>{
 const d=deferred();const c=setup({list:async()=>d.promise});const pending=c.search();c.dispose();d.resolve({items:[{}],total:1});await pending;assert.deepEqual(c.snapshot().items,[]);
 const bad=setup({list:async()=>{throw Error('private');}});await bad.search();assert.equal(bad.snapshot().loading,false);assert.equal(bad.snapshot().error.includes('private'),false);
});
test('settings submission passes only selected policy and refreshes current team',async()=>{
 let payload,reads=0;const c=setup({mine:async()=>{reads++;return {team:{id:'t',role:'captain'}};},command:async p=>{payload=p;return {ok:true};}});
 await c.mine();const policy={mode:'auto',minLadderTier:'黃金',minTier:'b'};await c.operate('admission','t',{policy,actorUid:'spoof'});
 assert.deepEqual(payload,{action:'admission',teamId:'t',requestId:'test-operation-00000001',policy});assert.equal(reads,2);assert.equal(c.snapshot().screen,'mine');
});
test('create uses authenticated server command, then reloads own team',async()=>{
 let payload,hasTeam=false;const c=setup({mine:async()=>({team:hasTeam?{id:'new',name:'新戰隊',role:'captain'}:null}),command:async p=>{payload=p;hasTeam=true;return {ok:true};}});
 await c.create();assert.equal(c.snapshot().screen,'create');assert.equal(c.snapshot().team,null);
 await c.operate('create','new',{name:'新戰隊',actorUid:'forged'});assert.deepEqual(payload,{action:'create',teamId:'new',requestId:'test-operation-00000001',name:'新戰隊'});assert.equal(c.snapshot().screen,'mine');assert.equal(c.snapshot().team.name,'新戰隊');
});

test('explicit retry reuses the exact request and blocks new mutations while outcome is uncertain',async()=>{
 let calls=[];const c=setup({command:async p=>{calls.push(structuredClone(p));if(calls.length===1)throw Error('lost response');return {ok:true};}});
 assert.equal((await c.operate('create','team-1',{name:'新戰隊'})).reason,'unconfirmed');
 assert.equal(c.snapshot().pending,true);assert.equal((await c.operate('create','team-2',{name:'其他'})).reason,'pending-confirmation');
 assert.equal((await c.retryPending()).ok,true);assert.deepEqual(calls[0],calls[1]);assert.equal(c.snapshot().pending,false);
});

test('definitive server rejection permits another operation and shows the reason',async()=>{
 let count=0;const c=setup({command:async()=>{count++;if(count===1)throw Object.assign(Error('team-full'),{code:'functions/failed-precondition'});return {ok:true};}});
 assert.equal((await c.operate('apply','full')).reason,'rejected');assert.equal(c.snapshot().pending,false);assert.match(c.snapshot().error,/滿員/);
 assert.equal((await c.operate('apply','available')).ok,true);assert.equal(count,2);
});
test('unknown and network errors remain uncertain even when they resemble rejections',async()=>{
 const c=setup({command:async()=>{throw Object.assign(Error('unknown-server-message'),{code:'functions/failed-precondition'});}});
 assert.equal((await c.operate('apply','t')).reason,'unconfirmed');assert.equal(c.snapshot().pending,true);
});

test('command rejection preserves loaded page; failed page load never appears loaded',async()=>{
 const c=setup({mine:async()=>({team:{id:'t',role:'captain'}}),command:async()=>{throw Object.assign(Error('team-full'),{code:'functions/failed-precondition'});}});
 await c.mine();await c.operate('apply','t');assert.equal(c.snapshot().screen,'mine');assert.equal(c.snapshot().loaded,true);assert.equal(c.snapshot().team.id,'t');
 const bad=setup({mine:async()=>{throw Error('network');}});await bad.mine();assert.equal(bad.snapshot().loaded,false);assert.equal(bad.snapshot().team,null);
});

test('review commands send the selected applicant and reload the pending list',async()=>{
 let reads=0,payload;const c=setup({applications:async()=>{reads++;return {items:[],hasMore:false};},command:async p=>{payload=p;return {ok:true};}});
 await c.applications('team');await c.operate('approve','team',{targetUid:'person'});
 assert.deepEqual(payload,{action:'approve',teamId:'team',targetUid:'person',requestId:'test-operation-00000001'});assert.equal(reads,2);assert.equal(c.snapshot().screen,'applications');
});

test('review rejection identifies an applicant already in another team',async()=>{
 const c=setup({command:async()=>{throw Object.assign(Error('already-in-team'),{code:'functions/failed-precondition'});}});
 await c.applications('team');assert.equal((await c.operate('approve','team',{targetUid:'person'})).reason,'rejected');
 assert.match(c.snapshot().error,/申請者已有戰隊/);assert.equal(c.snapshot().pending,false);
});

test('history reads selected team and retains records separately from lobby',async()=>{
 let request;const c=setup({history:async p=>(request=p,{items:[{name:'小賈',date:'2026/10/27',time:'18:10',method:'自行退出'}]})});
 await c.history('team');assert.deepEqual(request,{teamId:'team'});assert.equal(c.snapshot().items[0].name,'小賈');assert.equal(c.snapshot().screen,'history');
});

test('history navigation returns to the previous page and refresh resets to newest',async()=>{
 const requests=[];const c=setup({history:async p=>{requests.push(p);return {items:[{name:p.cursor||'first'}],nextCursor:p.cursor?null:'next'};}});
 await c.history('team');await c.historyNext();assert.equal(c.snapshot().historyPage,2);assert.equal(c.snapshot().items[0].name,'next');
 await c.historyPrevious();assert.equal(c.snapshot().historyPage,1);assert.equal(c.snapshot().items[0].name,'first');
 await c.historyNext();await c.history('team');assert.equal(c.snapshot().historyPage,1);assert.deepEqual(requests.map(x=>x.cursor||null),[null,'next',null,'next',null]);
});
test('member management verifies own team and refreshes after removal',async()=>{
 let reads=0,payload;const c=setup({mine:async()=>({team:{id:'t',role:'captain'}}),members:async()=>{reads++;return {id:'t',members:[]};},command:async p=>(payload=p,{ok:true})});
 assert.equal((await c.manage('t')).ok,true);await c.operate('remove','t',{targetUid:'m',reasonCode:'other',reasonNote:'原因'});
 assert.equal(reads,2);assert.equal(payload.reasonNote,'原因');assert.equal(c.snapshot().screen,'manage');
 const no=setup({mine:async()=>({team:{id:'t',role:'member'}})});assert.equal((await no.manage('t')).reason,'load-failed');
});

test('role assignment sends selected target and reloads member management',async()=>{
 let reads=0,payload;const c=setup({mine:async()=>({team:{id:'t',role:'captain'}}),members:async()=>{reads++;return {id:'t',members:[]};},command:async p=>(payload=p,{ok:true})});
 await c.manage('t');await c.operate('assign','t',{targetUid:'m',role:'elite'});assert.equal(payload.targetUid,'m');assert.equal(payload.role,'elite');assert.equal(reads,2);
});

test('captain transfer sends the target and returns to updated my-team view',async()=>{
 let payload,role='captain';const c=setup({mine:async()=>({team:{id:'t',role}}),members:async()=>({id:'t',members:[]}),command:async p=>{payload=p;role='member';return {ok:true};}});
 await c.manage('t');await c.operate('transfer','t',{targetUid:'new'});assert.equal(payload.targetUid,'new');assert.equal(payload.action,'transfer');assert.equal(c.snapshot().screen,'mine');assert.equal(c.snapshot().team.role,'member');
});

test('successful leave and solo dissolution reload the no-team view',async()=>{
 for(const action of ['leave','dissolve']){let team={id:'t',role:action==='leave'?'member':'captain',memberCount:1};let payload;const c=setup({mine:async()=>({team}),command:async p=>{payload=p;team=null;return {ok:true};}});
 await c.mine();assert.equal((await c.operate(action,'t')).ok,true);assert.equal(payload.action,action);assert.equal(c.snapshot().screen,'mine');assert.equal(c.snapshot().team,null);}
});
