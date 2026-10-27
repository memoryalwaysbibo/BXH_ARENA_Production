'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {createMembershipService}=require('./membership.cjs');
function fixture(){
 const data=new Map();
 const db={doc:p=>p,runTransaction:async fn=>{
  const staged=[];let writing=false;
  const tx={get:async p=>{assert.equal(writing,false,'all reads before writes');return {exists:data.has(p),data:()=>structuredClone(data.get(p))};}};
  for(const op of ['create','set','update','delete'])tx[op]=(p,v)=>{writing=true;staged.push([op,p,v]);};
  const result=await fn(tx);
  for(const [op,p,v]of staged){if(op==='delete')data.delete(p);else data.set(p,op==='update'?{...data.get(p),...v}:v);}
  return result;
 }};
 return {data,run:createMembershipService({db,clock:()=>100})};
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
