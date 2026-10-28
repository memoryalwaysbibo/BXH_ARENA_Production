'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {createProjectionWriter,createSeasonLadderReader}=require('./projection.cjs');
function fixture(players){
 const docs=new Map([['teamsV1/t',{status:'active',name:'戰隊',captainUid:'a',memberUids:['a','b'],roles:{a:'captain',b:'member'},totalXp:0,createdAt:100,admission:{mode:'review'}}],['ladderSystem/current',{currentSeason:'S1'}],['ladderPlayers/a',{currentSeason:'S1',seasonPoints:300,careerPoints:900}],['ladderPlayers/b',{currentSeason:'S1',seasonPoints:200}]]);const writes=[];
 const tx={get:async ref=>({exists:docs.has(ref),data:()=>docs.get(ref)}),set:(r,v)=>writes.push(['set',r,v]),delete:r=>writes.push(['delete',r])};
 const db={doc:p=>p,runTransaction:fn=>fn(tx)};
 const ladder=createSeasonLadderReader({db});
 const readPlayers=players||async function({tx,uids}){const values=await ladder({tx,uids});return {complete:true,players:uids.map(uid=>({uid,name:uid,ladderPoints:values.get(uid).points,hunterTier:null,secret:'private'}))};};
 return {docs,writes,refresh:createProjectionWriter({db,readPlayers,clock:()=>123})};
}
test('refresh produces allowlisted atomic team projection from current-season source',async()=>{
 const f=fixture();assert.deepEqual(await f.refresh('t'),{status:'updated',strengthComplete:true});const p=f.writes[0][2];assert.equal(p.strength,500);assert.equal(p.memberCount,2);assert.equal(p.members[0].role,'captain');assert.ok(!JSON.stringify(p).includes('private'));
});
test('missing or stale season score is unknown rather than zero',async()=>{
 const f=fixture();f.docs.set('ladderPlayers/b',{currentSeason:'S0',seasonPoints:20,careerPoints:400});await f.refresh('t');assert.equal(f.writes[0][2].strength,null);assert.equal(f.writes[0][2].strengthComplete,false);
});
test('incomplete or duplicated inputs fail without writing over previous data',async()=>{
 for(const players of [async()=>({complete:false,players:[]}),async()=>({complete:true,players:[{uid:'a'},{uid:'a'}]})]){const f=fixture(players);await assert.rejects(f.refresh('t'));assert.equal(f.writes.length,0);}
});
test('dissolved team projection is removed without accessing player records',async()=>{
 const f=fixture(async()=>{throw Error('must-not-read')});f.docs.get('teamsV1/t').status='dissolved';assert.deepEqual(await f.refresh('t'),{status:'removed'});assert.deepEqual(f.writes,[['delete','teamsPublicV1/t']]);
});
