'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {assignRole,canManage,populationState,canDissolve,selectFrame,DAY}=require('./team-policy.cjs');
const {summarizeActivity,presenceView}=require('./activity.cjs');
const team=()=>({captainUid:'c',memberUids:['c','a','b','d','e','f','g'],totalXp:0});
test('deputy and elite limits, captain-only appointment, no XP multiplier',()=>{
 let t=assignRole(team(),'c','a','deputy');t=assignRole(t,'c','b','deputy');assert.throws(()=>assignRole(t,'c','d','deputy'),/role-full/);
 for(const uid of ['d','e','f'])t=assignRole(t,'c',uid,'elite');assert.throws(()=>assignRole(t,'c','g','elite'),/role-full/);
 assert.throws(()=>assignRole(t,'a','g','elite'),/captain-required/);assert.equal(t.totalXp,0);
 assert.equal(canManage(t,'a','remove','g'),true);assert.equal(canManage(t,'a','remove','b'),false);assert.equal(canManage(t,'a','remove','d'),false);
 assert.equal(canManage(t,'d','review'),false);
});
test('24h timer starts only when understaffed, resets after recovery, no mass dissolve',()=>{
 const t={captainUid:'c',memberUids:['c'],totalXp:0};const p=populationState(t,100);assert.equal(p.dissolveAt,100+DAY);
 const s={...t,...p};assert.equal(canDissolve(s,null,99+DAY,{automatic:true}),false);assert.equal(canDissolve(s,null,100+DAY,{automatic:true}),true);
 assert.equal(canDissolve(s,'c',101),true);assert.equal(canDissolve(s,'a',101),false);
 const recovered={...s,memberUids:['c','a']};assert.deepEqual(populationState(recovered,200),{understaffedSince:null,dissolveAt:null});assert.equal(canDissolve(recovered,'c',200),false);
 assert.equal(populationState({...t,...populationState(recovered,200)},300).understaffedSince,300);
});
test('frame rewards require unlock and captain',()=>{
 assert.throws(()=>selectFrame(team(),'c',4),/frame-locked/);assert.equal(selectFrame({...team(),totalXp:12},'c',4).selectedFrame,4);
 assert.throws(()=>selectFrame({...team(),totalXp:63},'a',10),/captain-required/);
});
test('archive receipts deduplicate, retain departed contribution and isolate teams',()=>{
 const now=40*DAY;const r={eventId:'e',uid:'a',teamId:'t',archived:true,ranked:true,completed:true,archivedAt:now};
 const s=summarizeActivity({teamId:'t',members:['c'],receipts:[r,r,{...r,eventId:'old',archivedAt:DAY}],now});
 assert.equal(s.totalContribution,2);assert.equal(s.recentParticipations,1);assert.equal(s.activeMemberCount,0);
 assert.throws(()=>summarizeActivity({teamId:'t',members:['a'],receipts:[{...r,archived:false}],now}),/invalid-archive/);
 assert.throws(()=>summarizeActivity({teamId:'t',members:['a'],receipts:[r,{...r,archivedAt:now-1}],now}),/conflicting/);
});
test('presence is private and stale timestamps never claim online',()=>{
 assert.equal(presenceView({viewerIsMember:false,lastSeenAt:100,now:200}),null);
 assert.equal(presenceView({viewerIsMember:true,lastSeenAt:null,now:200}).label,'尚無紀錄');
 assert.equal(presenceView({viewerIsMember:true,lastSeenAt:100,now:200}).state,'last-seen');
 assert.equal(presenceView({viewerIsMember:true,lastSeenAt:200,now:100}).state,'unknown');
});
