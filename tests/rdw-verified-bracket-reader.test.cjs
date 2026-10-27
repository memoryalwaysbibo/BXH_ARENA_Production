'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createVerifiedBracketReader}=require('../scripts/lib/rdw-verified-bracket-reader.cjs');
const code='BXH-ABC123';
const base={meta:{ladderMode:'ranked',battleMode:'individual'},registrationRosterRevision:3,
 bracketDraw:{id:'draw-1',revision:2},drawnAt:123,bracketSize:2,
 matches:[{id:'m1',bracket:'winner',round:1,indexInRound:0,a:{playerId:'a'},b:{playerId:'b'}}]};
function context(p=base,q=base){
 const docs={['tournaments/'+code]:{data:JSON.stringify(p)},['publicTournaments/'+code]:{bracketView:JSON.stringify(q)}};
 const db={doc:x=>x};const tx={get:async ref=>({exists:!!docs[ref],data:()=>docs[ref]})};
 return {verify:createVerifiedBracketReader({db}),tx};
}
const args={eventCode:code,drawRevision:2,expectedRosterRevision:3};
test('canonical mirror and revisions allow read-only proof',async()=>{const c=context();assert.equal(await c.verify({tx:c.tx,...args}),true);});
test('stale draw and roster are blocked',async()=>{const c=context();assert.equal(await c.verify({tx:c.tx,...args,drawRevision:1}),false);assert.equal(await c.verify({tx:c.tx,...args,expectedRosterRevision:4}),false);});
test('bracket tamper and started room are blocked',async()=>{let c=context(base,{...base,matches:[]});assert.equal(await c.verify({tx:c.tx,...args}),false);c=context({...base,startedAt:123},base);assert.equal(await c.verify({tx:c.tx,...args}),false);});
test('team ranked start excluded',async()=>{const c=context({...base,meta:{ladderMode:'ranked',battleMode:'team'}},base);assert.equal(await c.verify({tx:c.tx,...args}),false);});
