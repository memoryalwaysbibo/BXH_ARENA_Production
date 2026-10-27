'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {createMembershipService}=require('./membership.cjs');
function fixture(readEligibility){
 const data=new Map();
 const db={doc:p=>p,runTransaction:async fn=>{
  const staged=[];let writing=false;
  const tx={get:async p=>{assert.equal(writing,false,'all reads before writes');return {exists:data.has(p),data:()=>structuredClone(data.get(p))};}};
  for(const op of ['create','set','update','delete'])tx[op]=(p,v)=>{writing=true;staged.push([op,p,v]);};
  const result=await fn(tx);
  for(const [op,p,v]of staged){if(op==='delete')data.delete(p);else data.set(p,op==='update'?{...data.get(p),...v}:v);}
  return result;
 }};
 return {data,run:createMembershipService({db,clock:()=>100,readEligibility})};
}
const cmd=(run,actorUid,action,extra={})=>run({actorUid,action,teamId:'alpha',...extra});
test('create, apply, approve, transfer, leave preserve membership and experience',async()=>{
 const {run,data}=fixture();await cmd(run,'captain','create',{name:'Alpha'});
 await cmd(run,'player','apply');assert.equal((await cmd(run,'player','apply')).duplicate,true);
 await cmd(run,'captain','approve',{targetUid:'player'});
 await cmd(run,'captain','transfer',{targetUid:'player'});await cmd(run,'captain','leave');
 assert.equal(data.get('teamsV1/alpha').captainUid,'player');assert.deepEqual(data.get('teamsV1/alpha').memberUids,['player']);
 assert.equal(data.get('teamsV1/alpha').totalXp,0);assert.equal(data.has('teamMembershipsV1/captain'),false);
});
test('unauthorized requests and duplicate membership never mutate data',async()=>{
 const {run,data}=fixture();await cmd(run,'captain','create',{name:'Alpha'});await cmd(run,'player','apply');
 for(const [actor,action,extra]of [['player','approve',{targetUid:'player'}],['captain','leave',{}],['captain','create',{name:'Again'}]]){
  const before=JSON.stringify([...data]);await assert.rejects(cmd(run,actor,action,extra));assert.equal(JSON.stringify([...data]),before);
 }
});
test('approval rechecks capacity and membership after application',async()=>{
 const {run,data}=fixture();await cmd(run,'captain','create',{name:'Alpha'});await cmd(run,'player','apply');
 data.get('teamsV1/alpha').memberUids.push(...Array.from({length:9},(_,i)=>'u'+i));
 await assert.rejects(cmd(run,'captain','approve',{targetUid:'player'}),/team-full/);
 data.get('teamsV1/alpha').memberUids.pop();data.set('teamMembershipsV1/player',{teamId:'other'});
 await assert.rejects(cmd(run,'captain','approve',{targetUid:'player'}),/already-in-team/);
});
test('cancel, reject and remove close applications or memberships',async()=>{
 const {run,data}=fixture();await cmd(run,'captain','create',{name:'Alpha'});await cmd(run,'player','apply');await cmd(run,'player','cancel');
 await assert.rejects(cmd(run,'captain','approve',{targetUid:'player'}),/not-pending/);
 await cmd(run,'player','apply');await cmd(run,'captain','reject',{targetUid:'player'});await cmd(run,'player','apply');
 await cmd(run,'captain','approve',{targetUid:'player'});await cmd(run,'captain','remove',{targetUid:'player'});
 assert.equal(data.has('teamMembershipsV1/player'),false);
});
test('deputy reviews applications; transfer clears old captain role',async()=>{
 const {run,data}=fixture();await cmd(run,'captain','create',{name:'Alpha'});
 for(const uid of ['a','b']){await cmd(run,uid,'apply');await cmd(run,'captain','approve',{targetUid:uid});}
 await cmd(run,'captain','assign',{targetUid:'a',role:'deputy'});
 await cmd(run,'new','apply');await cmd(run,'a','approve',{targetUid:'new'});
 await assert.rejects(cmd(run,'a','remove',{targetUid:'captain'}));
 await cmd(run,'a','remove',{targetUid:'new'});
 await cmd(run,'captain','transfer',{targetUid:'a'});
 assert.deepEqual(data.get('teamsV1/alpha').roles,{captain:'member',a:'captain',b:'member'});
});
test('membership transitions reset countdown; dissolve keeps tombstone and removes membership',async()=>{
 const {run,data}=fixture();await cmd(run,'captain','create',{name:'Alpha'});
 assert.equal(data.get('teamsV1/alpha').understaffedSince,100);
 await cmd(run,'a','apply');await cmd(run,'captain','approve',{targetUid:'a'});
 assert.equal(data.get('teamsV1/alpha').understaffedSince,null);
 await assert.rejects(cmd(run,'captain','dissolve'),/solo/);
 await cmd(run,'a','leave');assert.equal(data.get('teamsV1/alpha').understaffedSince,100);
 assert.deepEqual(data.get('teamsV1/alpha').roles,{captain:'captain'});
 await cmd(run,'captain','dissolve');assert.equal(data.get('teamsV1/alpha').status,'dissolved');assert.equal(data.has('teamMembershipsV1/captain'),false);
 await assert.rejects(cmd(run,'a','apply'),/dissolved/);
});
test('role limit failures leave transaction unchanged and frame command rejects locked frames',async()=>{
 const {run,data}=fixture();await cmd(run,'captain','create',{name:'Alpha'});
 for(const uid of ['a','b','c']){await cmd(run,uid,'apply');await cmd(run,'captain','approve',{targetUid:uid});}
 for(const uid of ['a','b'])await cmd(run,'captain','assign',{targetUid:uid,role:'deputy'});
 const before=JSON.stringify([...data]);await assert.rejects(cmd(run,'captain','assign',{targetUid:'c',role:'deputy'}),/role-full/);assert.equal(JSON.stringify([...data]),before);
 await assert.rejects(cmd(run,'captain','frame',{frame:4}),/frame-locked/);
 data.get('teamsV1/alpha').totalXp=12;await cmd(run,'captain','frame',{frame:4});assert.equal(data.get('teamsV1/alpha').selectedFrame,4);
});
test('leadership can configure AND thresholds; auto admission joins without review',async()=>{
 const {run,data}=fixture(async({uid})=>({uid,points:500,tier:'b'}));await cmd(run,'captain','create',{name:'Alpha'});
 await cmd(run,'captain','admission',{policy:{mode:'auto',minPoints:500,minTier:'b'}});
 const r=await cmd(run,'a','apply');assert.equal(r.joined,true);assert.equal(data.get('teamMembershipsV1/a').teamId,'alpha');
 assert.equal(data.get('teamsV1/alpha').understaffedSince,null);
 await assert.rejects(cmd(run,'a','admission',{policy:{mode:'review'}}),/leadership/);
 await cmd(run,'captain','assign',{targetUid:'a',role:'deputy'});
 await cmd(run,'a','admission',{policy:{mode:'review',minPoints:100,minTier:'c'}});
 await cmd(run,'b','apply');assert.equal(data.has('teamMembershipsV1/b'),false);await cmd(run,'a','approve',{targetUid:'b'});
});
test('review admits below thresholds; automatic admission rejects client spoofed qualification',async()=>{
 let points=500;const {run,data}=fixture(async({uid})=>({uid,points,tier:'b'}));await cmd(run,'captain','create',{name:'Alpha'});
 await cmd(run,'captain','admission',{policy:{mode:'review',minPoints:400,minTier:'c'}});await cmd(run,'a','apply');
 points=100;await cmd(run,'captain','approve',{targetUid:'a'});assert.equal(data.has('teamMembershipsV1/a'),true);
 await cmd(run,'captain','admission',{policy:{mode:'auto',minTier:'s'}});
 await assert.rejects(cmd(run,'b','apply',{tier:'national'}),/tier-below/);
});
test('configured thresholds fail closed without trusted reader; auto still enforces capacity',async()=>{
 const {run,data}=fixture();await cmd(run,'captain','create',{name:'Alpha'});
 await cmd(run,'captain','admission',{policy:{mode:'auto',minPoints:1}});await assert.rejects(cmd(run,'a','apply'),/reader-required/);
 await cmd(run,'captain','admission',{policy:{mode:'auto'}});
 data.get('teamsV1/alpha').memberUids.push(...Array.from({length:9},(_,i)=>'u'+i));await assert.rejects(cmd(run,'a','apply'),/team-full/);
 await assert.rejects(cmd(run,'captain','admission',{policy:{mode:'auto',minTier:'fake'}}),/invalid-min-tier/);
});
