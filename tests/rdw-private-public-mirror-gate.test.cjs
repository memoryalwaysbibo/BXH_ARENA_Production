const test=require('node:test'),assert=require('node:assert/strict');
const {compareMirrors,inspectMirrorsInTransaction}=require('../scripts/lib/rdw-private-public-mirror-gate.cjs');
const code='BXH-ABC123';
function fixture(){
 const state={cloudCode:code,registrationRosterRevision:4,startedAt:null,rosterLocked:false,drawnAt:100,players:[{id:'p1',uid:'private-id'},{id:'p2'}],matches:[{id:'m1',a:{playerId:'p1'},b:{playerId:'p2'},completed:false}]};
 const safe={cloudCode:code,registrationRosterRevision:4,startedAt:null,drawnAt:100,players:[{id:'p1',name:'Example'},{id:'p2'}],matches:[{id:'m1',a:{playerId:'p1'},b:{playerId:'p2'},completed:false}]};
 return {privateDoc:{code,data:JSON.stringify(state)},publicDoc:{bracketView:JSON.stringify(safe)},state,safe};
}
test('real ARENA private data and public bracketView agree without leaking UIDs',()=>{
 const f=fixture(),r=compareMirrors({...f,eventCode:code});
 assert.deepEqual(r,{ok:true,eventCode:code,rosterRevision:4,players:2,matches:1});
 assert.equal(JSON.stringify(r).includes('private-id'),false);
});
test('mismatched revision, roster, bracket and draw fail closed',()=>{
 for(const [patch,reason] of [
  [{registrationRosterRevision:3},'roster-revision-mismatch'],
  [{players:[{id:'p2'},{id:'p1'}]},'mirror-roster-mismatch'],
  [{matches:[{id:'m1',a:{playerId:'p2'},b:{playerId:'p1'}}]},'mirror-bracket-mismatch'],
  [{drawnAt:999},'mirror-draw-mismatch'],
  [{startedAt:123},'already-started']
 ]){
  const f=fixture();
  assert.equal(compareMirrors({privateDoc:f.privateDoc,publicDoc:{bracketView:JSON.stringify({...f.safe,...patch})},eventCode:code}).reason,reason);
 }
});
test('invalid JSON and already started private room do not pass',()=>{
 const f=fixture();
 assert.equal(compareMirrors({privateDoc:{data:'{invalid'},publicDoc:f.publicDoc,eventCode:code}).ok,false);
 assert.equal(compareMirrors({privateDoc:{data:JSON.stringify({...f.state,startedAt:555})},publicDoc:f.publicDoc,eventCode:code}).reason,'already-started');
});
test('both records are read within the caller transaction before any write',async()=>{
 const f=fixture(),reads=[];
 const p={id:'private'},q={id:'public'};
 const tx={get:async ref=>{reads.push(ref.id);return {exists:true,data:()=>ref===p?f.privateDoc:f.publicDoc};}};
 const r=await inspectMirrorsInTransaction({tx,privateRef:p,publicRef:q,eventCode:code});
 assert.equal(r.ok,true);assert.deepEqual(reads,['private','public']);
});
test('missing mirror must prevent server start transition',async()=>{
 const f=fixture();const tx={get:async ref=>ref.id==='public'?{exists:false}:{exists:true,data:()=>f.privateDoc}};
 const r=await inspectMirrorsInTransaction({tx,privateRef:{id:'private'},publicRef:{id:'public'},eventCode:code});
 assert.equal(r.reason,'mirror-document-missing');
});
