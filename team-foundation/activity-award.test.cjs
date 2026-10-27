'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');const {createActivityAwarder}=require('./activity-award.cjs');
const code='BXH-ABC123',uid='player',id=code+'_'+uid;
function fixture(){
 const docs=new Map([
 ['ladderTransactions/'+id,{type:'event',eventCode:code,playerUid:uid,seasonId:'S1',pointsEarned:12}],
 ['tournaments/'+code,{eventAuthority:'official',ladderMode:'ranked',archiveStatus:'completed',tournamentPhase:'done',ladderPointsAwarded:true,ladderSeasonId:'S1',ladderResults:[{eventCode:code,playerUid:uid,seasonId:'S1',pointsEarned:12}],data:JSON.stringify({archiveStatus:'completed',ladderPointsAwarded:true,archivedAt:200})}],
 ['teamMembershipsV1/'+uid,{teamId:'t',joinedAt:100}],['teamsV1/t',{status:'active',memberUids:[uid],totalXp:2}]
 ]);
 const db={doc:p=>p,runTransaction:async fn=>fn({get:async p=>({exists:docs.has(p),data:()=>docs.get(p)}),create:(p,v)=>{if(docs.has(p))throw Error('exists');docs.set(p,v);},update:(p,v)=>docs.set(p,{...docs.get(p),...v})})};
 return {docs,award:createActivityAwarder({db})};
}
test('completed official ledger awards once and records a deduplication receipt',async()=>{
 const f=fixture();assert.deepEqual(await f.award(id),{status:'awarded',teamId:'t'});assert.equal(f.docs.get('teamsV1/t').totalXp,3);assert.equal(f.docs.get('teamActivityReceiptsV1/'+id).uid,uid);
 assert.deepEqual(await f.award(id),{status:'already-awarded'});assert.equal(f.docs.get('teamsV1/t').totalXp,3);
});
test('unarchived, mismatched and late membership cannot add experience',async()=>{
 for(const change of [f=>{f.docs.get('tournaments/'+code).archiveStatus='ongoing';},f=>{f.docs.get('tournaments/'+code).ladderResults[0].pointsEarned=99;},f=>{f.docs.get('teamMembershipsV1/'+uid).joinedAt=201;},f=>{f.docs.get('tournaments/'+code).eventAuthority='community';},f=>{f.docs.get('tournaments/'+code).testMode=true;},f=>{f.docs.delete('teamMembershipsV1/'+uid);}]){
  const f=fixture();change(f);assert.deepEqual(await f.award(id),{status:'ineligible'});assert.equal(f.docs.get('teamsV1/t').totalXp,2);assert.equal(f.docs.has('teamActivityReceiptsV1/'+id),false);
 }
});
