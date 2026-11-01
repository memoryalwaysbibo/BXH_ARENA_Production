'use strict';

const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const api=require('../modules/main-app/bracket-commit.js');
const clone=x=>JSON.parse(JSON.stringify(x));
const tick=()=>new Promise(r=>setImmediate(r));
const deferred=()=>{let resolve;return {promise:new Promise(r=>resolve=r),resolve:x=>resolve(x)};};
const rosterRebase=(()=>{
 const source=fs.readFileSync('modules/main-app/core.js','utf8');
 const start=source.indexOf('function rebaseOrdinaryBracketRosterFence('),end=source.indexOf('\nfunction bracketCommitController()',start);
 assert(start>=0&&end>start);
 return vm.runInNewContext(source.slice(start,end)+'\nrebaseOrdinaryBracketRosterFence',{cloneStateForSave:clone});
})();
function room(){return {id:'r',cloudCode:'ROOM',updatedAt:1,meta:{formatType:'single'},players:[{id:'a'},{id:'b'}],matches:[],archiveStatus:'ongoing'};}
function fixture(){
 let local=room(),remote=clone(local),pub=clone(local),count=0,success=0,applied=0,active=true,writes=[];
 const storage=new Map(),ctx={minimumFeedbackMs:0,confirmationDelayMs:0,key:'u:ROOM',actorUid:'u',storage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},current:()=>active,state:()=>local,cloud:()=>true,operationId:()=> 'op'+count,
 generate:()=>({...clone(local),drawnAt:100+count++,bracketSize:2,matches:[{id:'m'+count,bracket:'SE',round:0,indexInRound:0,a:{playerId:'a'},b:{playerId:'b'}}]}),
 read:async()=>({ok:true,data:clone(remote),publicData:clone(pub)}),
 write:async(s,o)=>{writes.push(clone(s));api.assertWrite(remote,s,o);remote=clone(s);pub=clone(s);return true;},
 apply:s=>{local=clone(s);applied++;},local:async()=>true,changed(){},success:()=>success++};
 return {ctx,make:()=>api.create(ctx),get local(){return local;},get remote(){return remote;},set remote(v){remote=v;},set pub(v){pub=v;},get count(){return count;},get success(){return success;},get applied(){return applied;},writes,storage,leave:()=>active=false};
}
test('delayed write blocks start/re-draw and never reports success before readback',async()=>{
 const h=fixture(),wait=deferred(),write=h.ctx.write;h.ctx.write=async(...args)=>{await wait.promise;return write(...args);};
 const c=h.make(),promise=c.begin();await tick();assert(c.blocked());assert.equal(h.success,0);assert.equal(h.local.matches.length,0);assert.equal(await c.begin(),false);assert.equal(await c.verify(h.local),false);
 wait.resolve();assert.equal(await promise,true);assert.equal(h.success,1);assert.equal(h.local.matches.length,1);assert(!c.blocked());assert.equal(h.local.bracketDrawHistory.length,1);assert(h.local.updatedAt>1);
});
test('failed save survives controller recreation and retries identical draw exactly once',async()=>{
 const h=fixture(),write=h.ctx.write;h.ctx.write=async()=>false;
 const c=h.make();assert.equal(await c.begin(),false);assert(c.blocked());const saved=[...h.storage.values()][0];assert(saved);h.ctx.write=write;const recovered=h.make();assert(recovered.blocked());assert.equal(await recovered.retry(),true);assert.equal(h.count,1);assert.equal(h.writes.length,1);assert.equal(h.writes[0].bracketDraw.id,JSON.parse(saved).snapshot.bracketDraw.id);assert.equal(h.storage.size,0);
});
test('commit with lost acknowledgement is recovered by readback without re-draw/write',async()=>{
 const h=fixture(),write=h.ctx.write;h.ctx.write=async(...args)=>{await write(...args);return false;};const c=h.make();
 assert.equal(await c.begin(),true);assert.equal(c.status().result,'success');assert(!c.blocked());assert.equal(h.count,1);assert.equal(h.writes.length,1);assert.equal(h.success,1);
});
test('mismatching public projection keeps the draw unconfirmed',async()=>{
 const h=fixture(),write=h.ctx.write;h.ctx.write=async(...args)=>{const ok=await write(...args);h.pub=room();return ok;};const c=h.make();
 assert.equal(await c.begin(),false);assert.equal(h.success,0);assert(c.blocked());assert.equal(h.applied,0);
});
test('account/room switch discards late UI replies',async()=>{
 const h=fixture(),wait=deferred(),write=h.ctx.write;h.ctx.write=async(...args)=>{await wait.promise;return write(...args);};const c=h.make(),p=c.begin();await tick();h.leave();wait.resolve();await p;assert.equal(h.applied,0);assert.equal(h.success,0);assert.equal(h.storage.size,1);
});
test('timeout keeps the same recoverable candidate and no success',async()=>{
 const h=fixture();h.ctx.timeoutMs=5;h.ctx.write=()=>new Promise(()=>{});const c=h.make();assert.equal(await c.begin(),false);assert(c.blocked());assert.equal(h.success,0);assert.equal(h.count,1);
});
test('start verification rejects a cloud draw with identical roster but different pairing ID',async()=>{
 const h=fixture(),c=h.make();await c.begin();assert.equal(await c.verify(h.local),true);const changed=clone(h.remote);changed.matches[0].id='new-draw';h.remote=changed;h.pub=clone(changed);assert.equal(await c.verify(h.local),false);
});
test('cloud read/discard restores authoritative state only after successful server read',async()=>{
 const h=fixture();h.ctx.write=async()=>false;const c=h.make();await c.begin();h.ctx.read=async()=>({ok:false});await c.discard();assert(c.blocked());h.ctx.read=async()=>({ok:true,data:room(),publicData:room()});await c.discard();assert(!c.blocked());assert.equal(h.local.matches.length,0);assert.equal(h.writes.length,0);
});
test('transaction fence rejects competing draw, stale start, old client and start rollback',()=>{
 const base=room(),candidate={...clone(base),drawnAt:1,bracketSize:2,matches:[{id:'m'}],bracketDraw:{id:'one'}},options={bracketCommit:{baseSignature:api.signature(base)}};
 assert.equal(api.assertWrite(base,candidate,options),'write');assert.equal(api.assertWrite(candidate,candidate,options),'already-committed');
 const second={...clone(candidate),bracketDraw:{id:'two'}};assert.throws(()=>api.assertWrite(candidate,second,options),/version-conflict/);
 assert.throws(()=>api.assertWrite(candidate,base),/version-conflict/);
 assert.throws(()=>api.assertWrite(candidate,{...candidate,startedAt:2},{bracketStartSignature:api.signature(base)}),/version-conflict/);
 assert.equal(api.assertWrite(candidate,{...candidate,startedAt:2},{bracketStartSignature:api.signature(candidate)}),'write');
 assert.throws(()=>api.assertWrite({...candidate,startedAt:2},candidate),/bracket-started/);
});
test('actual cloud transaction and server-only private/public readback enforce version',async()=>{
 // Reuse the existing cloud transaction fixture with the actual production methods.
 let fixtureSource=fs.readFileSync('tests/assignment-cloud-confirmation.test.cjs','utf8').split("\ntest('staff save")[0];
 fixtureSource=fixtureSource.replace('window:{},console:','window:{BXHBracketCommit:bracketApi},console:').replace("['pushUpdate','saveStaffAssignments','saveRefereeStationAssignments']","['pushUpdate','readBracketFromServer','saveStaffAssignments','saveRefereeStationAssignments']").replace("return {api:context.api,docs,reads,stale,logs,","return {context,api:context.api,docs,reads,stale,logs,");
 const outer={require,bracketApi:api};vm.createContext(outer);vm.runInContext(fixtureSource+'\nglobalThis.h=harness();globalThis.initial=room();',outer);
 const h=outer.h;h.context.buildPublicMirrorFields=s=>clone(s);
 const old=clone(outer.initial),future=Date.now()+60000;h.docs.get('tournaments/ROOM').data=JSON.stringify({...old,updatedAt:future});
 const candidate={...clone(old),drawnAt:1,bracketSize:2,matches:[{id:'new',bracket:'SE',round:0,indexInRound:0,a:{playerId:'a'},b:{playerId:'b'}}],bracketDraw:{id:'draw-one'}};
 assert.equal(await h.api.pushUpdate('ROOM',candidate,{bracketCommit:{baseSignature:api.signature(old)}}),true);
 const read=await h.api.readBracketFromServer('ROOM');assert.equal(read.ok,true);assert(read.data.updatedAt>future);assert.equal(api.signature(read.data),api.signature(read.publicData));assert.deepEqual(Array.from(h.reads).slice(-2),['tournaments/ROOM','publicTournaments/ROOM']);
 assert.equal(await h.api.pushUpdate('ROOM',old),false);assert.equal(JSON.parse(h.docs.get('tournaments/ROOM').data).bracketDraw.id,'draw-one');
 assert.equal(await h.api.pushUpdate('ROOM',{...clone(candidate),startedAt:2},{bracketStartSignature:api.signature(old)}),false);
 assert.equal(await h.api.pushUpdate('ROOM',{...clone(candidate),startedAt:2},{bracketStartSignature:api.signature(candidate)}),true);
});

test('failed transaction cannot mutate the saved candidate fences before retry',async()=>{
 const h=fixture(),write=h.ctx.write;let first=true;h.ctx.write=async(s,o)=>{if(first){first=false;s.qrCheckinRevision=999;s.matches[0].id='mutated';return false;}return write(s,o);};
 const c=h.make();assert.equal(await c.begin(),true);assert.equal(h.local.matches[0].id,'m1');assert.equal(h.local.qrCheckinRevision,undefined);assert.equal(h.count,1);
});
test('storage failure prevents the candidate from being sent',async()=>{
 const h=fixture();h.ctx.storage.setItem=()=>{throw Error('quota');};const c=h.make();assert.equal(await c.begin(),false);assert.equal(await c.retry(),false);assert.equal(h.writes.length,0);assert.equal(h.success,0);
});

test('account switch during server preflight never sends a write',async()=>{
 const h=fixture(),read=h.ctx.read,wait=deferred();h.ctx.read=async()=>{await wait.promise;return read();};const c=h.make(),p=c.begin();await tick();h.leave();wait.resolve();await p;assert.equal(h.writes.length,0);assert.equal(h.applied,0);
});

test('a redraw started during start verification keeps start blocked',async()=>{
 const h=fixture(),c=h.make();await c.begin();const read=h.ctx.read,wait=deferred();h.ctx.read=async()=>{await wait.promise;return read();};
 const verify=c.verify(h.local),draw=c.begin();wait.resolve();assert.equal(await verify,false);await draw;
});

test('single submit action retries the same persisted pairing after upload failure',async()=>{
 const h=fixture(),write=h.ctx.write;h.ctx.write=async()=>false;const c=h.make();
 assert.equal(await c.submit(),false);assert.equal(c.status().result,'failed');
 const saved=[...h.storage.values()][0];h.ctx.write=write;
 assert.equal(await c.submit(),true);assert.equal(h.count,1);assert.equal(h.writes.length,1);
 assert.equal(h.local.bracketDraw.id,JSON.parse(saved).snapshot.bracketDraw.id);assert.equal(c.status().result,'success');
});
test('single submit automatically adopts a competing cloud version without overwriting it',async()=>{
 const h=fixture();h.ctx.write=async()=>false;const c=h.make();await c.submit();
 const latest={...room(),drawnAt:200,bracketSize:2,matches:[{id:'other-draw'}],bracketDraw:{id:'other'}};h.remote=clone(latest);h.pub=clone(latest);
 assert.equal(await c.submit(),false);assert.equal(c.status().result,'failed');assert.equal(c.status().error,'bracket-version-conflict');
 assert(!c.blocked());assert.equal(h.local.bracketDraw.id,'other');assert.equal(h.count,1);assert.equal(h.writes.length,0);assert.equal(h.success,0);assert.equal(h.storage.size,0);
});
test('unreadable cloud state keeps pending pairing instead of treating a read error as a competing edit',async()=>{
 const h=fixture();h.ctx.write=async()=>false;const c=h.make();await c.submit();h.ctx.read=async()=>({ok:false});
 assert.equal(await c.submit(),false);assert(c.blocked());assert.equal(c.status().error,'cloud-readback-unconfirmed');assert.equal(h.count,1);assert.equal(h.applied,0);assert.equal(h.storage.size,1);
});

test('cloud draw visibly waits at least two seconds and completes without confirmation click',async()=>{
 const h=fixture();delete h.ctx.minimumFeedbackMs;const c=h.make(),at=Date.now(),p=c.submit();
 await tick();assert(c.busy());assert(c.blocked());assert.equal(h.success,0);
 await new Promise(r=>setTimeout(r,100));assert(c.busy());assert.equal(h.success,0);
 assert.equal(await p,true);assert(Date.now()-at>=1950);assert.equal(h.success,1);assert.equal(c.status().result,'success');assert(!c.busy());
});

test('lost write acknowledgement exception is automatically confirmed by matching private/public readback',async()=>{
 const h=fixture(),write=h.ctx.write;h.ctx.write=async(...args)=>{await write(...args);throw Error('ack-lost');};
 const c=h.make();assert.equal(await c.submit(),true);assert.equal(h.success,1);assert.equal(h.count,1);assert.equal(h.writes.length,1);assert(!c.blocked());
});

test('one click confirms after the first post-write server read is temporarily stale',async()=>{
 const h=fixture(),read=h.ctx.read,write=h.ctx.write;let stale=false,afterWrite=false;
 h.ctx.write=async(...args)=>{const ok=await write(...args);afterWrite=true;return ok;};
 h.ctx.read=async()=>{if(afterWrite&&!stale){stale=true;return {ok:true,data:clone(h.remote),publicData:room()};}return read();};
 const c=h.make();assert.equal(await c.submit(),true);assert.equal(h.success,1);assert.equal(h.count,1);assert.equal(h.writes.length,1);assert(!c.blocked());
});
test('one click recovers when the first server preflight fails transiently',async()=>{
 const h=fixture(),read=h.ctx.read;let first=true;h.ctx.read=async()=>{if(first){first=false;return {ok:false};}return read();};
 const c=h.make();assert.equal(await c.submit(),true);assert.equal(h.count,1);assert.equal(h.writes.length,1);
});
test('one click retries a rejected transient write with the identical operation and pairing',async()=>{
 const h=fixture(),write=h.ctx.write,sent=[];let first=true;h.ctx.write=async(s,o)=>{sent.push(clone(s));if(first){first=false;return false;}return write(s,o);};
 const c=h.make();assert.equal(await c.submit(),true);assert.equal(h.count,1);assert.equal(sent.length,2);assert.deepEqual(sent[0],sent[1]);assert.equal(h.success,1);
});

test('permission denial does not cause an automatic second write',async()=>{
 const h=fixture();let writes=0;h.ctx.write=async()=>{writes++;return false;};h.ctx.writeFailureCode=()=> 'permission-denied';
 const c=h.make();assert.equal(await c.submit(),false);assert.equal(writes,1);assert.equal(h.success,0);assert(c.blocked());
});
test('persistent unconfirmed public readback never rewrites a committed draw',async()=>{
 const h=fixture(),write=h.ctx.write;let reads=0;h.ctx.read=async()=>{reads++;return {ok:true,data:clone(h.remote),publicData:room()};};h.ctx.write=write;
 const c=h.make();assert.equal(await c.submit(),false);assert.equal(h.writes.length,1);assert.equal(reads,4);assert(c.blocked());
});
test('confirmation has an overall deadline instead of restarting a timeout for every retry',async()=>{
 const h=fixture();h.ctx.totalTimeoutMs=10;h.ctx.timeoutMs=1000;h.ctx.read=()=>new Promise(()=>{});
 const c=h.make(),at=Date.now();assert.equal(await c.submit(),false);assert(Date.now()-at<500);assert.equal(h.writes.length,0);assert.equal(c.status().error,'confirmation-timeout');
});


test('admin force confirmation survives a rejected write without generating a second pairing',async()=>{
 const h=fixture(),grant={id:'force-confirmation',operation:'draw-bracket'};let allowed=true,calls=0;
 h.ctx.authorizeOverride=()=>allowed;
 const normalWrite=h.ctx.write;
 h.ctx.writeFailureCode=()=> 'permission-denied';
 h.ctx.write=async(s,o)=>{calls++;assert.deepEqual(o.adminOperationalOverride,grant);if(calls===1)return false;s.adminOperationOverrides=[grant];return normalWrite(s,o);};
 const c=h.make();assert.equal(await c.begin({adminOperationalOverride:grant}),false);
 assert.equal(h.count,1);assert.equal(c.status().pending,true);assert.equal(h.success,0);
 allowed=false;assert.equal(await c.retry(),false);assert.equal(calls,1);
 allowed=true;assert.equal(await c.retry(),true);assert.equal(h.count,1);assert.equal(h.success,1);
 assert.equal(h.local.adminOperationOverrides[0].id,grant.id);
});
test('force draw cannot begin without current admin authorization',async()=>{
 const h=fixture(),c=h.make();assert.equal(await c.begin({adminOperationalOverride:{id:'force'}}),false);
 assert.equal(h.count,0);assert.equal(h.writes.length,0);
});

test('admin force rebases stale revisions while retaining the exact approved pairing',async()=>{
 const h=fixture(),grant={id:'force-confirmation',operation:'draw-bracket'};let writes=0;
 h.ctx.authorizeOverride=()=>true;h.ctx.writeFailureCode=()=> 'registration-roster-stale';
 h.ctx.rebaseOverride=(fresh,old)=>({...clone(fresh),matches:clone(old.matches),drawnAt:old.drawnAt,bracketSize:old.bracketSize,bracketDraw:old.bracketDraw});
 const normalWrite=h.ctx.write;
 h.ctx.write=async(s,o)=>{writes++;if(writes===1){h.remote={...h.remote,registrationRosterRevision:2};h.pub=clone(h.remote);return false;}assert.equal(s.registrationRosterRevision,2);s.adminOperationOverrides=[grant];return normalWrite(s,o);};
 const c=h.make();assert.equal(await c.begin({adminOperationalOverride:grant}),true);
 assert.equal(writes,2);assert.equal(h.count,1);assert.equal(h.local.matches[0].id,'m1');
});
test('ordinary redraw refreshes a stale QR fence only for identical checked-in entrants',async()=>{
 const h=fixture(),base={...room(),meta:{...room().meta,checkinRequired:true,refereeSeatsEnabled:true},players:[{id:'a',checkedIn:true},{id:'b',checkedIn:true}],qrCheckinRevision:5};
 h.remote=clone(base);h.pub=clone(base);h.ctx.state=()=>base;
 h.ctx.generate=()=>({...clone(base),drawnAt:100,bracketSize:2,matches:[{id:'one-pairing',bracket:'SE',round:0,indexInRound:0,a:{playerId:'a'},b:{playerId:'b'}}]});
 h.ctx.rebaseRosterFence=rosterRebase;h.ctx.writeFailureCode=()=> 'qr-checkin-state-stale';
 const write=h.ctx.write;let calls=0;
 h.ctx.write=async(s,o)=>{
  calls++;
  if(calls===1){h.remote={...h.remote,qrCheckinRevision:6,meta:{...h.remote.meta,refereeSeatsEnabled:false}};h.pub=clone(h.remote);return false;}
  assert.equal(s.qrCheckinRevision,6);assert.equal(s.meta.refereeSeatsEnabled,false);
  return write(s,o);
 };
 const c=h.make();assert.equal(await c.begin(),true);assert.equal(calls,2);
 assert.equal(h.count,0);assert.equal(h.remote.matches[0].id,'one-pairing');
 assert.equal(h.remote.bracketDraw.id,'op0');assert.equal(h.remote.players.length,2);
});
test('ordinary redraw refuses a fence refresh if checked-in membership changed',async()=>{
 const h=fixture(),base={...room(),meta:{...room().meta,checkinRequired:true},players:[{id:'a',checkedIn:true},{id:'b',checkedIn:true}],qrCheckinRevision:5};
 h.remote=clone(base);h.pub=clone(base);h.ctx.state=()=>base;
 h.ctx.generate=()=>({...clone(base),drawnAt:100,bracketSize:2,matches:[{id:'original',bracket:'SE',round:0,indexInRound:0,a:{playerId:'a'},b:{playerId:'b'}}]});
 h.ctx.rebaseRosterFence=rosterRebase;h.ctx.writeFailureCode=()=> 'qr-checkin-state-stale';
 let calls=0;h.ctx.write=async()=>{calls++;h.remote={...h.remote,qrCheckinRevision:6,players:[...h.remote.players,{id:'c',checkedIn:true}]};h.pub=clone(h.remote);return false;};
 const c=h.make();assert.equal(await c.begin(),false);assert.equal(c.status().error,'bracket-roster-changed');
 assert.equal(calls,1);assert(c.blocked());assert.equal(h.remote.matches.length,0);
});
test('cancelled ninth player stays out of an eight-player redraw while current room fields survive',()=>{
 const players=Array.from({length:9},(_,i)=>({id:'p'+(i+1),checkedIn:i!==0}));
 const snapshot={id:'room',meta:{battleMode:'individual',checkinRequired:true,refereeSeatsEnabled:true},players,
  matches:Array.from({length:4},(_,i)=>({id:'m'+i,a:{playerId:'p'+(2*i+2)},b:{playerId:'p'+(2*i+3)}})),
  bracketDraw:{id:'same-operation'},bracketSize:8,drawnAt:100,qrCheckinRevision:5};
 const fresh={...clone(snapshot),matches:[],drawnAt:null,bracketSize:0,qrCheckinRevision:6,meta:{...snapshot.meta,refereeSeatsEnabled:false}};
 const rebased=rosterRebase(fresh,snapshot);
 assert(rebased);assert.equal(rebased.qrCheckinRevision,6);assert.equal(rebased.meta.refereeSeatsEnabled,false);
 assert.equal(rebased.bracketDraw.id,'same-operation');assert.equal(rebased.matches.length,4);
 assert(!rebased.matches.some(m=>m.a?.playerId==='p1'||m.b?.playerId==='p1'));
 const changed=clone(fresh);changed.players[0].checkedIn=true;assert.equal(rosterRebase(changed,snapshot),null);
});
test('ordinary fence refresh retains generated round references and rejects changed layout settings',()=>{
 const snapshot={id:'room',meta:{checkinRequired:true,formatType:'double',stations:2,bronzeMatch:false},players:[{id:'a',checkedIn:true},{id:'b',checkedIn:true}],matches:[{id:'m',a:{playerId:'a'},b:{playerId:'b'}}],gfMatchId:'new-final',gfResetMatchId:null,bronzeMatchId:null,rrRounds:3,celebrationShown:false};
 const fresh={...clone(snapshot),gfMatchId:'old-final',gfResetMatchId:'old-reset',bronzeMatchId:'old-bronze',rrRounds:8,celebrationShown:true};
 const rebased=rosterRebase(fresh,snapshot);
 assert(rebased);assert.equal(rebased.gfMatchId,'new-final');assert.equal(rebased.gfResetMatchId,null);
 assert.equal(rebased.bronzeMatchId,null);assert.equal(rebased.rrRounds,3);assert.equal(rebased.celebrationShown,false);
 for(const [key,value] of [['formatType','roundrobin'],['stations',3],['bronzeMatch',true]]){
  const changed=clone(fresh);changed.meta[key]=value;assert.equal(rosterRebase(changed,snapshot),null,key);
 }
});

test('expired force confirmation can be renewed without a new operation or pairing',async()=>{
 const h=fixture(),grant={id:'force-confirmation',operation:'draw-bracket',participantIds:['a','b'],at:1};let accepted=false;
 h.ctx.authorizeOverride=()=>true;const normalWrite=h.ctx.write;
 h.ctx.writeFailureCode=()=> 'permission-denied';
 h.ctx.write=async(s,o)=>{if(!accepted)return false;s.adminOperationOverrides=[{id:o.adminOperationalOverride.id}];return normalWrite(s,o);};
 const c=h.make();assert.equal(await c.begin({adminOperationalOverride:grant}),false);
 assert.equal(await c.renewOverride({...grant,id:'new-operation',at:2}),false);
 assert.equal(await c.renewOverride({...grant,participantIds:['other'],at:2}),false);
 accepted=true;assert.equal(await c.renewOverride({...grant,at:2}),true);
 assert.equal(h.count,1);assert.equal(h.local.bracketDraw.id,'op1');assert.equal(h.local.adminOperationOverrides[0].id,grant.id);
});


const productionCore=fs.readFileSync('modules/main-app/core.js','utf8');
function coreFunction(name){
 const start=productionCore.indexOf('function '+name+'(');
 assert(start>=0,name);
 const end=productionCore.indexOf('\nfunction ',start+1);
 return productionCore.slice(start,end<0?undefined:end);
}
function rosterFixture(){
 const c={state:{id:'r',meta:{checkinRequired:true,stations:2,refereeSeatsV1:{version:1,courts:{1:{revision:3,main:{uid:'ref'},backup1:{uid:'backup'}}}}},players:['a','b','c','d'].map(id=>({id,checkedIn:true})),bracketSize:4,matches:[{id:'old',a:{playerId:'a'},b:{playerId:'b'}},{id:'old2',a:{playerId:'c'},b:{playerId:'d'}}]},
  window:{},canOperateCurrentTournament:()=>true,bracketCommitBlocked:()=>false,
  bracketCommitController:()=>({status:()=>({result:'success',pending:false,busy:false})}),
  sameStringSet:(a,b)=>a.size===b.size&&[...a].every(id=>b.has(id)),
  shuffle:xs=>[...xs].reverse(),nextPow2:n=>2**Math.ceil(Math.log2(n)),seedOrder:n=>Array.from({length:n},(_,i)=>i+1),
  uid:()=>String(Math.random()),applyChallongeSingleElimOrder:()=>{},rebuildPropagationSingle:()=>{},syncMatchStatuses:()=>{},showToast:()=>{}};
 c.orderedMatches=()=>c.state.matches;
 vm.createContext(c);
 for(const name of ['tournamentEligiblePlayers','eligiblePlayers','currentBracketParticipantIds','eligibleRosterIds','bracketRosterIsCurrent','bracketRosterUpdateHtml','bracketCommitStatusHtml','generateSingleElim'])vm.runInContext(coreFunction(name),c);
 return c;
}
test('check-in cancellation replaces saved-success with stale warning until the new roster is drawn',()=>{
 const c=rosterFixture();assert.match(c.bracketCommitStatusHtml(),/儲存成功/);
 const prior=JSON.stringify(c.state.matches);c.state.players[0].checkedIn=false;
 const html=c.bracketCommitStatusHtml();assert.match(html,/對戰表待更新/);assert.match(html,/依最新名單重新抽籤/);
 assert(!html.includes('儲存成功'));assert.equal(JSON.stringify(c.state.matches),prior,'Rendering must not redraw or hide the persisted pairing');
 assert.equal(c.generateSingleElim(),true);assert(!c.currentBracketParticipantIds().has('a'));assert(c.bracketRosterIsCurrent());
 assert(!c.bracketCommitStatusHtml().includes('對戰表待更新'));
 c.state.players[0].checkedIn=true;assert.match(c.bracketCommitStatusHtml(),/對戰表待更新/);
 assert.equal(c.generateSingleElim(),true);assert(c.currentBracketParticipantIds().has('a'));assert(c.bracketRosterIsCurrent());
});
test('all check-ins revoked before start never resurrect the saved bracket roster',()=>{
 const c=rosterFixture();c.state.players.forEach(p=>p.checkedIn=false);
 assert.equal(c.eligiblePlayers().length,0);assert(!c.bracketRosterIsCurrent());assert.match(c.bracketCommitStatusHtml(),/對戰表待更新/);
 const prior=JSON.stringify(c.state.matches);assert.equal(c.generateSingleElim(),false);assert.equal(JSON.stringify(c.state.matches),prior);
 c.state.startedAt=123;assert.equal(c.eligiblePlayers().length,4,'Keep legacy history fallback after start');assert.equal(c.bracketRosterUpdateHtml(),'');
});
test('stale warning survives a refresh without an upload controller and gives observers no redraw action',()=>{
 const c=rosterFixture();c.state.players.push({id:'late',checkedIn:true});c.bracketCommitController=()=>null;
 assert.match(c.bracketCommitStatusHtml(),/對戰表待更新/);
 c.canOperateCurrentTournament=()=>false;const html=c.bracketCommitStatusHtml();assert.match(html,/請主辦更新對戰表/);assert(!html.includes('data-action="draw-bracket"'));
 c.canOperateCurrentTournament=()=>true;c.bracketCommitBlocked=()=>true;assert.match(c.bracketCommitStatusHtml(),/data-action="draw-bracket" disabled/);
 c.state.archiveStatus='completed';assert.equal(c.bracketCommitStatusHtml(),'');
});
test('cancel, redraw, late check-in and redraw retain existing referee main and backup seats',()=>{
 const c=rosterFixture(),before=JSON.stringify(c.state.meta);
 c.state.players[0].checkedIn=false;assert(c.generateSingleElim());assert.equal(JSON.stringify(c.state.meta),before);
 c.state.players.push({id:'late',checkedIn:true});assert(c.generateSingleElim());assert(c.currentBracketParticipantIds().has('late'));
 assert.equal(JSON.stringify(c.state.meta),before);assert.equal(c.state.meta.refereeSeatsV1.courts[1].main.uid,'ref');
});
test('draw controller rejects any new draw after start without writing or replacing matches',async()=>{
 const h=fixture();h.ctx.state=()=>({...room(),startedAt:123,bracketSize:2,matches:[{id:'locked'}]});
 const c=h.make();assert.equal(await c.begin(),false);assert.equal(h.count,0);assert.equal(h.writes.length,0);
});
