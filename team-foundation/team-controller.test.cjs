'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {createTeamController}=require('./team-controller.js');
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
function setup(overrides={}){return createTeamController({api:{list:async()=>({items:[],total:0}),members:async()=>({name:'Alpha',members:[]}),mine:async()=>({team:null}),command:async()=>({ok:true}),...overrides}});}
test('slow search cannot overwrite newer results or member view',async()=>{
 const d=deferred();const c=setup({list:async q=>q.query==='old'?d.promise:{items:[{id:'new'}],total:1}});
 const old=c.search({query:'old'});await c.search({query:'new'});d.resolve({items:[{id:'old'}],total:1});await old;assert.equal(c.snapshot().items[0].id,'new');
 await c.view('a');assert.equal(c.snapshot().screen,'members');assert.equal(c.snapshot().team.name,'Alpha');
});
test('mutation is single-flight; rejects forged identity and refreshes after success',async()=>{
 const d=deferred();let calls=0,payload;const c=setup({command:async p=>{calls++;payload=p;return d.promise;}});
 const first=c.operate('join','a',{actorUid:'forged',points:99999});assert.equal((await c.operate('join','a')).reason,'busy');
 d.resolve({ok:true});await first;assert.equal(calls,1);assert.deepEqual(payload,{action:'apply',teamId:'a'});assert.equal(c.snapshot().busy,false);
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
 assert.deepEqual(payload,{action:'admission',teamId:'t',policy});assert.equal(reads,2);assert.equal(c.snapshot().screen,'mine');
});
test('create uses authenticated server command, then reloads own team',async()=>{
 let payload,hasTeam=false;const c=setup({mine:async()=>({team:hasTeam?{id:'new',name:'新戰隊',role:'captain'}:null}),command:async p=>{payload=p;hasTeam=true;return {ok:true};}});
 await c.create();assert.equal(c.snapshot().screen,'create');assert.equal(c.snapshot().team,null);
 await c.operate('create','new',{name:'新戰隊',actorUid:'forged'});assert.deepEqual(payload,{action:'create',teamId:'new',name:'新戰隊'});assert.equal(c.snapshot().screen,'mine');assert.equal(c.snapshot().team.name,'新戰隊');
});
