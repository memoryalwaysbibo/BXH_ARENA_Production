'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');const {createPublicPlayerReader}=require('./player-reader.cjs');
function fixture(){const gen='g1793095800000-abcdefabcdef',docs=new Map([
 ['ladderSystem/current',{currentSeason:'S1'}],['ladderPlayers/a',{currentSeason:'S1',seasonPoints:100}],['ladderPlayers/b',{currentSeason:'S1',seasonPoints:200}],
 ['publicPlayers/a',{publicName:'玩家甲',email:'secret'}],['publicPlayers/b',{publicName:'玩家乙'}],['hunterLeaderboardMeta/current',{generation:gen}],
 ['hunterLeaderboardSnapshots/'+gen,{generation:gen,version:'hunter-leaderboard-v1',promotionPolicy:'medium-or-larger-v1',rows:[{uid:'a',tier:'b',private:'secret'}]}]]);
 const db={doc:p=>p},tx={get:async p=>({exists:docs.has(p),data:()=>docs.get(p)})};return {read:createPublicPlayerReader({db}),tx,docs,gen};}
test('reads canonical ladder, public name and one consistent verified board generation',async()=>{
 const f=fixture(),r=await f.read({tx:f.tx,uids:['a','b']});assert.equal(r.hunterGeneration,f.gen);assert.equal(r.players[0].hunterTier,'b');assert.equal(r.players[1].hunterTier,null);assert.equal(r.players[1].ladderPoints,200);assert.ok(!JSON.stringify(r).includes('secret'));
});
test('unavailable snapshot or name fails closed instead of overwriting projection',async()=>{
 for(const key of ['hunterLeaderboardMeta/current','publicPlayers/a']){const f=fixture();f.docs.delete(key);await assert.rejects(f.read({tx:f.tx,uids:['a']}));}
});
test('missing ladder data stays unknown and malformed duplicate hunter entries rejected',async()=>{
 const f=fixture();f.docs.delete('ladderPlayers/a');assert.equal((await f.read({tx:f.tx,uids:['a']})).players[0].ladderPoints,null);
 f.docs.get('hunterLeaderboardSnapshots/'+f.gen).rows.push({uid:'a',tier:'b'});await assert.rejects(f.read({tx:f.tx,uids:['a']}),/snapshot-invalid/);
});
