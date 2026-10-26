'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(__dirname+'/../modules/cloud/cloud-runtime.js','utf8'),clone=v=>JSON.parse(JSON.stringify(v));
function method(name){const a=source.indexOf('    async '+name+'('),b=source.indexOf('\n    },',a);assert(a>=0&&b>a);return source.slice(a,b+6);}
function harness(actor='main'){
 const st={meta:{stations:2},matches:[{id:'m',station:1,scoreA:1,scoreB:0,refereeSeatScoreRevision:0}],updatedAt:1},court={main:{uid:'main'},backup1:{uid:'backup'},backup2:null};
 const room={createdBy:'host',data:JSON.stringify(st),updatedAt:1,refereeSeatsV1:{version:1,courts:{'1':court}},refereeStationRestrictionEnabled:true,refereeStationAssignments:{'1':['main','backup']}};
 const docs=new Map([['tournaments/BXH-TEST',room],['publicTournaments/BXH-TEST',{}],...['main','backup','host','outside'].map(uid=>['users/'+uid,{role:'staff',active:true}])]);
 let writes=0;
 const c={cloudEnabled:true,dbHandle:{},USERS_COLLECTION:'users',authHandle:{currentUser:{uid:actor}},window:{},console,advanceOnsiteWriteFence:()=>({}),courtLifecycleWritePatch:()=>({}),buildPublicMirrorFields:s=>({matches:s.matches}),computeTournamentPhase:()=> 'live',rebuildPropagationForState:()=>{},userProfile:{role:'staff'},fx:{doc:(_,...p)=>p.join('/'),runTransaction:async(_,fn)=>{const pending=[];const out=await fn({get:async path=>({exists:()=>docs.has(path),data:()=>clone(docs.get(path))}),set:(path,patch)=>pending.push(()=>{writes++;docs.set(path,{...docs.get(path),...clone(patch)});})});pending.forEach(f=>f());return out;}}};
 vm.createContext(c);vm.runInContext('api={'+['mutateMatchTransaction','confirmMatchTransaction'].map(method).join(',')+'}',c);
 const score=()=>c.api.mutateMatchTransaction('BXH-TEST','m',1,(s,m)=>{m.scoreA++;return {ok:true,state:s};},actor,{expectedSeatScoreRevision:0});
 return {c,docs,room,score,writes:()=>writes};
}
for(const actor of ['main','backup','host','outside'])test(actor+' cannot use legacy browser mutation in three-seat rooms',async()=>{const h=harness(actor);const r=await h.score();assert.equal(r.reason,'seat-command-required');assert.equal(h.writes(),0);});
test('legacy confirmation and queued offline snapshots are rejected before callback runs',async()=>{const h=harness();let called=false;const r=await h.c.api.confirmMatchTransaction('BXH-TEST',()=>{called=true;return {ok:true};},{station:1,matchId:'m'});assert.equal(r.reason,'seat-command-required');assert.equal(called,false);assert.equal(h.writes(),0);});
