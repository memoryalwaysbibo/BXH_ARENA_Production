const test=require('node:test'),assert=require('node:assert/strict');
const {evaluate}=require('../scripts/lib/rdw-shadow-comparison.cjs');
const snap=(self,opp)=>({source:'server',verified:true,capturedAt:100,matchStartedAt:101,selfTierBefore:self,opponentTierBefore:opp});
test('shadow comparison weighs only trusted prematch snapshots and leaves input unchanged',()=>{
 const rows=[{isWin:true,snapshot:snap('c','b')},{isWin:true,snapshot:snap('c','e')},{isWin:false,snapshot:snap('ungraded','national')},{isWin:true,snapshot:{...snap('c','b'),verified:false}}];
 const before=JSON.stringify(rows),result=evaluate(rows);
 assert.equal(result.eligible,3);assert.equal(result.excluded,1);assert.equal(result.neutral,1);
 assert.equal(result.rawWins,2);assert.equal(result.weightedWins,1.99);assert.equal(result.weightedLosses,1);
 assert.equal(JSON.stringify(rows),before);
 assert.ok(!('highestTier' in result));assert.ok(!('currentTier' in result));
});
test('empty data does not fabricate score or grants',()=>{const result=evaluate([]);assert.equal(result.eligible,0);assert.equal(result.weightedWins,0);assert.equal(result.excluded,0);assert.throws(()=>evaluate(null),/records-required/);});
