const {test}=require('node:test'),assert=require('node:assert/strict'),{fixture}=require('./engine-fixture.cjs'),B=require('./bridge.cjs');
test('actual ARENA 96-player 6-court engine, undo, PASS and full advancement maintain public bridge parity',()=>{
 const f=fixture();assert.equal(f.state.players.length,96);assert.equal(f.current().length,6);
 let previous=f.projection(),rev=0,commands=0;const r=B.receiver();r.apply(B.checkpoint(previous,'engine',0));
 const run=(action,id,extra)=>{f.run(action,id,extra);commands++;const next=f.projection();assert(r.apply(B.delta(previous,next,'engine',rev++)).ok);assert.deepEqual(r.snapshot().view,next);previous=next;};
 const first=f.current()[0];run('score',first.id,{side:'A',finish:'spin'});assert.equal(first.scoreA,1);run('undo',first.id);assert.equal(first.scoreA,0);
 const passed=f.current()[1];run('skip',passed.id);assert(passed.skippedAt);let wins=0;
 for(let i=0;i<100&&!f.state.championId;i++){
  const m=f.current().find(m=>m.status==='in_progress');assert(m,'no playable match');
  run('score',m.id,{side:'A',finish:'extreme'});run('score',m.id,{side:'A',finish:'spin'});run('confirm',m.id);wins++;
 }
 assert(f.state.championId);assert.equal(wins,95);assert(passed.completed);assert.equal(passed.skippedAt,null);
 assert(!JSON.stringify(previous).includes('demo-ref'));console.log(JSON.stringify({actualEngine:true,players:96,courts:6,wins,commands,champion:!!f.state.championId,passCompleted:passed.completed}));
});
