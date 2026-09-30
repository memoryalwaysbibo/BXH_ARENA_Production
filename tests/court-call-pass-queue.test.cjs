const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');

const ui=fs.readFileSync(path.join(__dirname,'..','court-call-ui.js'),'utf8');
const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');

function extract(name,next){
  const start=ui.indexOf('function '+name+'(');
  assert(start>=0,'missing '+name);
  const end=next?ui.indexOf('\n'+next,start):ui.length;
  assert(end>start,'missing end for '+name);
  return ui.slice(start,end);
}

const sandbox={String,Number,Array,Object,Set,Map,Date,Math};
vm.createContext(sandbox);
vm.runInContext(
  extract('callPassProtected','function courtCallUserKey')+'\n'+
  extract('courtCallPublicQueue','/* Load ranked registration'),
  sandbox
);

const base=()=>({
  matches:[
    {id:'pass',station:1,seq:0,isBye:false,completed:false,status:'pending',a:{},b:{},skippedAt:100,resumeQueuedAt:null,skipManualOnly:false,skipWaitFor:['m1'],callPass:{waitFor:['m1']}},
    {id:'m1',station:1,seq:1,isBye:false,completed:false,status:'ready',a:{},b:{}},
    {id:'m2',station:1,seq:2,isBye:false,completed:false,status:'ready',a:{},b:{}},
    {id:'other',station:2,seq:1,isBye:false,completed:false,status:'ready',a:{},b:{}}
  ]
});

{
  const st=base();
  assert.equal(sandbox.callPassProtected(st,st.matches[0]),true,'PASS match itself must be protected');
  assert.equal(sandbox.callPassProtected(st,st.matches[1]),true,'PASS predecessor must be protected');
  assert.equal(sandbox.callPassProtected(st,st.matches[2]),false,'unrelated match must remain operable');

  const order=Array.from(sandbox.courtCallPublicQueue(st,1),m=>m.id);
  assert.deepEqual(order,['m1','pass','m2'],'PASS must sit immediately after its required predecessor');
}

{
  const st=base();
  st.matches.find(m=>m.id==='m1').completed=true;
  const order=Array.from(sandbox.courtCallPublicQueue(st,1),m=>m.id);
  assert.deepEqual(order,['pass','m2'],'PASS must return to the front once required predecessor completes');
}

{
  const st=base();
  const pass=st.matches.find(m=>m.id==='pass');
  pass.completed=true;
  assert.equal(sandbox.callPassProtected(st,st.matches.find(m=>m.id==='m1')),false,'completed PASS must release predecessor protection');
}

assert.match(ui,/\['coming','pass','ready'\]\.includes\(api\).*response=api;requestedResponse=response;api='respond'/s,
  'PASS button must map to respond/pass callable contract');
assert.match(ui,/if\(response==='pass'\)reason='其他'/,
  'PASS response reason contract missing');
assert.match(ui,/if\(r\.state&&typeof state!=='undefined'&&state\.cloudCode===code\)applyRemoteState\(r\.state,true\)/,
  'PASS authoritative state must be applied after callable response');

assert.match(html,/if\(callPassProtected\(state,m\)\)\{showToast\("PASS 回補及其前置場次不可再次跳過或移台"/,
  'PASS protected matches must reject ordinary skip/move');
assert.match(html,/state\.matches\.some\(m=>m\.callPass&&!m\.completed&&m\.skippedAt\)/,
  'station-count changes must be blocked while PASS is pending');
assert.match(html,/!m\.resumeQueuedAt&&!m\.callPass&&canOperateCurrentTournament\(\)/,
  'PASS rows must not expose manual claim controls');

console.log('PASS court-call PASS defer / protection / requeue / callable contract');
