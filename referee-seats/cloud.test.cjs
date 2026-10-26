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
test('backup can score alongside main; per-match revision increments once',async()=>{for(const uid of ['main','backup']){const h=harness(uid),r=await h.score();assert.equal(r.ok,true);assert.equal(r.state.matches[0].scoreA,2);assert.equal(r.state.matches[0].refereeSeatScoreRevision,1);}});
test('revoked seat is denied even when old legacy assignment and JSON remain stale',async()=>{const h=harness();h.room.refereeSeatsV1.courts['1'].main=null;const r=await h.score();assert.equal(r.reason,'station-not-assigned');assert.equal(h.writes(),0);});
test('seat on another court cannot mutate this court',async()=>{const h=harness('outside');h.room.refereeSeatsV1.courts['2']={main:{uid:'outside'}};assert.equal((await h.score()).reason,'station-not-assigned');});
test('host can intervene without occupying a seat',async()=>{const h=harness('host');assert.equal((await h.score()).ok,true);});
test('second stale score fails instead of adding the same point twice',async()=>{const h=harness();assert.equal((await h.score()).ok,true);assert.equal((await h.score()).reason,'score-stale');assert.equal(JSON.parse(h.docs.get('tournaments/BXH-TEST').data).matches[0].scoreA,2);});
test('revoked referee cannot confirm result or replay an offline result',async()=>{const h=harness();h.room.refereeSeatsV1.courts['1'].main=null;let invoked=false;const r=await h.c.api.confirmMatchTransaction('BXH-TEST',()=>{invoked=true;return {ok:true};},{station:1,matchId:'m',expectedSeatScoreRevision:0});assert.equal(r.reason,'station-not-assigned');assert.equal(invoked,false);assert.equal(h.writes(),0);});
test('confirmation rejects a changed score version before applying result',async()=>{const h=harness();const st=JSON.parse(h.room.data);st.matches[0].refereeSeatScoreRevision=2;h.room.data=JSON.stringify(st);const r=await h.c.api.confirmMatchTransaction('BXH-TEST',()=>{throw new Error('should not run');},{station:1,matchId:'m',expectedSeatScoreRevision:0});assert.equal(r.reason,'score-stale');});
