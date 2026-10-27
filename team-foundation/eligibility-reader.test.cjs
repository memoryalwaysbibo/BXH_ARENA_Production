'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {createEligibilityReader,createDisplayNameReader}=require('./eligibility-reader.cjs');
const {requireEligible}=require('./admission.cjs');
function fixture(){const generation='g1793095800000-abcdefabcdef',docs=new Map([
 ['ladderSystem/current',{currentSeason:'S1'}],['ladderPlayers/u',{currentSeason:'S1',seasonPoints:600}],['publicPlayers/u',{publicName:'黑爸'}],
 ['hunterLeaderboardMeta/current',{generation}],['hunterLeaderboardSnapshots/'+generation,{generation,version:'hunter-leaderboard-v1',promotionPolicy:'medium-or-larger-v1',rows:[{uid:'u',tier:'b'}]}]]);
 const db={doc:p=>p},tx={get:async p=>({exists:docs.has(p),data:()=>docs.get(p)})};return {tx,db,docs};}
test('actual reader combines current season and hunter snapshot inside the eligibility gate',async()=>{
 const f=fixture(),reader=createEligibilityReader({db:f.db}),policy={mode:'auto',minLadderTier:'白金',minTier:'b'};
 await requireEligible({policy,tx:f.tx,uid:'u',readEligibility:reader});assert.equal(await createDisplayNameReader({db:f.db})({tx:f.tx,uid:'u'}),'黑爸');
 f.docs.get('ladderPlayers/u').currentSeason='S0';await assert.rejects(requireEligible({policy,tx:f.tx,uid:'u',readEligibility:reader}),/eligibility-unavailable/);
});
