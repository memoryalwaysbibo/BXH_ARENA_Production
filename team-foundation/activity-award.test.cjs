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
 const f=fixture();assert.deepEqual(await f.award(id),{status:'awarded',teamId:'t'});assert.equal(f.docs.get('teamsV1/t').totalXp,3);assert.equal(f.docs.get('teamMembershipsV1/'+uid).experienceContribution,1);assert.equal(f.docs.get('teamActivityReceiptsV1/'+id).uid,uid);
 assert.deepEqual(await f.award(id),{status:'already-awarded'});assert.equal(f.docs.get('teamsV1/t').totalXp,3);assert.equal(f.docs.get('teamMembershipsV1/'+uid).experienceContribution,1);
});
test('unarchived, mismatched and late membership cannot add experience',async()=>{
 for(const change of [f=>{f.docs.get('tournaments/'+code).archiveStatus='ongoing';},f=>{f.docs.get('tournaments/'+code).ladderResults[0].pointsEarned=99;},f=>{f.docs.get('teamMembershipsV1/'+uid).joinedAt=201;},f=>{f.docs.get('tournaments/'+code).eventAuthority='community';},f=>{f.docs.get('tournaments/'+code).testMode=true;},f=>{f.docs.delete('teamMembershipsV1/'+uid);}]){
  const f=fixture();change(f);assert.deepEqual(await f.award(id),{status:'ineligible'});assert.equal(f.docs.get('teamsV1/t').totalXp,2);assert.equal(f.docs.has('teamActivityReceiptsV1/'+id),false);
 }
});
test('two members in one event each contribute once, while duplicate results fail closed',async()=>{
 const f=fixture(),other='second',otherId=code+'_'+other;
 f.docs.set('ladderTransactions/'+otherId,{type:'event',eventCode:code,playerUid:other,seasonId:'S1',pointsEarned:0});
 f.docs.set('teamMembershipsV1/'+other,{teamId:'t',joinedAt:199});
 f.docs.get('teamsV1/t').memberUids.push(other);
 f.docs.get('tournaments/'+code).ladderResults.push({eventCode:code,playerUid:other,seasonId:'S1',pointsEarned:0});
 assert.equal((await f.award(id)).status,'awarded');assert.equal((await f.award(otherId)).status,'awarded');
 assert.equal(f.docs.get('teamsV1/t').totalXp,4);
 assert.equal((await f.award(otherId)).status,'already-awarded');assert.equal(f.docs.get('teamsV1/t').totalXp,4);
 const bad=fixture();bad.docs.get('tournaments/'+code).ladderResults.push(null,{eventCode:code,playerUid:uid,seasonId:'S1',pointsEarned:12});
 assert.equal((await bad.award(id)).status,'ineligible');assert.equal(bad.docs.get('teamsV1/t').totalXp,2);
});
test('cancelled events and invalid joining timestamps never award',async()=>{
 for(const change of [f=>{f.docs.get('tournaments/'+code).eventCancelled=true;},f=>{f.docs.get('teamMembershipsV1/'+uid).joinedAt=-1;}]){
  const f=fixture();change(f);assert.equal((await f.award(id)).status,'ineligible');assert.equal(f.docs.get('teamsV1/t').totalXp,2);
 }
});

test('existing contribution increments and invalid counters do not award',async()=>{
 const f=fixture();f.docs.get('teamMembershipsV1/'+uid).experienceContribution=7;await f.award(id);assert.equal(f.docs.get('teamMembershipsV1/'+uid).experienceContribution,8);
 const bad=fixture();bad.docs.get('teamMembershipsV1/'+uid).experienceContribution=-1;await assert.rejects(bad.award(id),/invalid-contribution/);assert.equal(bad.docs.has('teamActivityReceiptsV1/'+id),false);assert.equal(bad.docs.get('teamsV1/t').totalXp,2);
});

const {recentActivity,recordDailyActivity}=require('./activity.cjs');
test('Taiwan calendar window expires old days and counts only current active members',()=>{
 const now=Date.UTC(2026,9,28,2),day=86400000;
 let bins=recordDailyActivity({uid:'a',members:['a','b'],archivedAt:now-29*day,now});
 bins=recordDailyActivity({dailyActivity:bins,uid:'b',members:['a','b'],archivedAt:now,now});
 assert.deepEqual(recentActivity({dailyActivity:bins,members:['b'],now}),{participations:2,activeMemberCount:1,days:30});
 assert.deepEqual(recentActivity({dailyActivity:bins,members:['a','b'],now:now+day}),{participations:1,activeMemberCount:1,days:30});
 bins=recordDailyActivity({dailyActivity:bins,uid:'b',members:['b'],archivedAt:now,now});
 assert.ok(Object.values(bins).every(b=>!b.memberUids.includes('a')));
 assert.equal(recentActivity({dailyActivity:bins,members:['b'],now}).participations,3);
 assert.throws(()=>recordDailyActivity({uid:'b',members:['b'],archivedAt:now+1,now}),/future/);
});
test('Taiwan midnight starts a new day; late archives do not resurrect expired buckets',()=>{
 const now=Date.UTC(2026,9,27,16),day=86400000;
 let bins=recordDailyActivity({uid:'a',members:['a'],archivedAt:now-1,now});
 bins=recordDailyActivity({dailyActivity:bins,uid:'a',members:['a'],archivedAt:now,now});
 assert.equal(Object.keys(bins).length,2);
 bins=recordDailyActivity({dailyActivity:bins,uid:'a',members:['a'],archivedAt:now-31*day,now});
 assert.equal(recentActivity({dailyActivity:bins,members:['a'],now}).participations,2);
});
test('award updates activity and XP atomically without double counting',async()=>{
 const f=fixture();const award=createActivityAwarder({db:{doc:p=>p,runTransaction:async fn=>fn({get:async p=>({exists:f.docs.has(p),data:()=>f.docs.get(p)}),create:(p,v)=>f.docs.set(p,v),update:(p,v)=>f.docs.set(p,{...f.docs.get(p),...v})})},clock:()=>200});
 await award(id);await award(id);
 assert.deepEqual(recentActivity({dailyActivity:f.docs.get('teamsV1/t').dailyActivity,members:[uid],now:200}),{participations:1,activeMemberCount:1,days:30});
});

test('manual result IDs match only the canonical ledger; conflicting IDs and metadata fail closed',async()=>{
 const f=fixture();f.docs.get('tournaments/'+code).ladderResults=[{playerId:uid,pointsEarned:12}];assert.equal((await f.award(id)).status,'awarded');
 for(const row of [{playerId:uid,playerUid:'other',pointsEarned:12},{playerId:uid,pointsEarned:12,eventCode:'BXH-OTHER1'},{playerId:uid,pointsEarned:12,seasonId:'S2'}]){
 const bad=fixture();bad.docs.get('tournaments/'+code).ladderResults=[row];assert.equal((await bad.award(id)).status,'ineligible');assert.equal(bad.docs.has('teamActivityReceiptsV1/'+id),false);
 }
});
